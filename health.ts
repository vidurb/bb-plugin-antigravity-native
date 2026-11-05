import { createInterface } from "node:readline";
import { z } from "zod";
import {
  experimental_resolveExecutablePath as resolveExecutable,
  providerHealthResultSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import { run, startProcess, terminateProcess, type Runner } from "./process.ts";
type Status = "ready" | "unauthenticated" | "expired" | "unknown";
export type HealthResult = z.infer<typeof providerHealthResultSchema>;
const responseSchema = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});
export type AuthProbe = (
  command: string,
  env: Record<string, string>,
  cwd?: string,
) => Promise<Status>;
export const probeAuthentication: AuthProbe = (command, env, cwd) =>
  new Promise((resolve) => {
    let settled = false,
      size = 0;
    const child = startProcess({
      command,
      args: ["acp", "--process-per-session"],
      env,
      cwd,
    });
    const finish = (status: Status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      terminateProcess(child);
      resolve(status);
    };
    const timer = setTimeout(() => finish("unknown"), 15000);
    const lines = createInterface({ input: child.stdout! });
    child.on("error", () => finish("unknown"));
    child.stdin?.on("error", () => finish("unknown"));
    child.on("close", () => finish("unknown"));
    const count = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) finish("unknown");
    };
    child.stdout?.on("data", count);
    child.stderr?.on("data", count);
    const send = (id: number, method: string, params: unknown) =>
      child.stdin?.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    lines.on("line", (line) => {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        return;
      }
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.error) {
        const text = message.error.message ?? "";
        finish(
          /expired|invalid_grant/i.test(text)
            ? "expired"
            : /auth|login|sign.in/i.test(text)
              ? "unauthenticated"
              : "unknown",
        );
        return;
      }
      if (message.id === 1) {
        send(2, "session/new", { cwd: cwd ?? process.cwd(), mcpServers: [] });
      } else if (message.id === 2) {
        finish(
          z.object({ sessionId: z.string().min(1) }).safeParse(message.result)
            .success
            ? "ready"
            : "unknown",
        );
      }
    });
    send(1, "initialize", {
      protocolVersion: 1,
      clientInfo: { name: "bb-antigravity-health", version: "0.1.0" },
      clientCapabilities: {},
    });
  });
export function createHealthChecker(
  runner: Runner = run,
  probe: AuthProbe = probeAuthentication,
  resolve = resolveExecutable,
  now = Date.now,
) {
  const cache = new Map<string, { at: number; result: HealthResult }>();
  const pending = new Map<string, Promise<HealthResult>>();
  return async (
    command: string,
    env: Record<string, string> = {},
    cwd?: string,
  ): Promise<HealthResult> => {
    const key = JSON.stringify([command, Object.entries(env).sort(), cwd]);
    const cached = cache.get(key);
    if (cached && now() - cached.at >= 0 && now() - cached.at < 30000)
      return cached.result;
    const existing = pending.get(key);
    if (existing) return existing;
    const promise = (async () => {
      let installedVersion: string | null = null;
      const result = (
        status: "not_installed" | "unsupported_version" | Status,
        statusMessage: string | null = null,
      ): HealthResult => ({
        supported: true,
        health: {
          status,
          statusMessage,
          installedVersion,
          minimumSupportedVersion: null,
          canInstall: false,
          canUpdate: false,
          accountEmail: null,
          planLabel: null,
          loginCommand: `${command} acp --login`,
        },
      });
      try {
        if ((await resolve(command)) === null)
          return result(
            "not_installed",
            "Install Antigravity CLI on this machine.",
          );
        const version = await runner(
          { command, args: ["--version"], env },
          4000,
        );
        installedVersion =
          version.stdout.trim().match(/\b\d+\.\d+\.\d+(?:-[\w.-]+)?\b/)?.[0] ??
          null;
        const help = await runner(
          { command, args: ["acp", "--help"], env },
          4000,
        );
        if (
          help.code !== 0 ||
          !/Agent Client Protocol|ACP.*stdio/i.test(help.stdout + help.stderr)
        )
          return result(
            "unsupported_version",
            "This CLI does not expose native ACP. Update Antigravity CLI.",
          );
        const status = await probe(command, env, cwd);
        return result(
          status,
          status === "ready"
            ? null
            : status === "unknown"
              ? "Could not verify a native ACP session. Check the CLI logs."
              : "Run agy acp --login on this machine.",
        );
      } catch {
        return result(
          "unknown",
          "Could not check Antigravity CLI. Check its executable path and retry.",
        );
      }
    })();
    pending.set(key, promise);
    try {
      const result = await promise;
      cache.set(key, { at: now(), result });
      return result;
    } finally {
      pending.delete(key);
    }
  };
}
