import type { z } from "zod";
import {
  experimental_resolveExecutablePath as resolveExecutable,
  providerHealthResultSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import { readCliVersion, run, type Runner } from "./process.ts";
import type { UsageResult } from "./usage.ts";

type Status = "ready" | "unauthenticated" | "expired" | "unknown";
export type HealthResult = z.infer<typeof providerHealthResultSchema>;
export type AuthProbe = (
  command: string,
  env: Record<string, string>,
) => Promise<Status>;

// ACP session/new leaves a permanent native conversation on disk, and ACP
// initialize reports the same state signed in or out, so the session-free quota
// read is the sign-in check.
export function authStatusFromUsage(result: UsageResult): Status {
  if (!result.supported) return "unknown";
  switch (result.usage.status) {
    case "ok":
      return "ready";
    case "unauthenticated":
    case "expired":
      return result.usage.status;
    default:
      return "unknown";
  }
}
export function createHealthChecker(
  probe: AuthProbe,
  runner: Runner = run,
  resolve = resolveExecutable,
  now = Date.now,
) {
  const cache = new Map<string, { at: number; result: HealthResult }>();
  const pending = new Map<string, Promise<HealthResult>>();
  return async (
    command: string,
    env: Record<string, string> = {},
  ): Promise<HealthResult> => {
    const key = JSON.stringify([command, Object.entries(env).sort()]);
    const cached = cache.get(key);
    if (cached && now() - cached.at >= 0 && now() - cached.at < 30000)
      return cached.result;
    const existing = pending.get(key);
    if (existing) return existing;
    const promise = (async () => {
      let installedVersion: string | null = null;
      const loginCommand = `${command} acp --login`;
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
          loginCommand,
        },
      });
      try {
        if ((await resolve(command)) === null)
          return result(
            "not_installed",
            "Install Antigravity CLI on this machine.",
          );
        installedVersion = await readCliVersion(runner, command, env);
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
        const status = await probe(command, env);
        return result(
          status,
          status === "ready"
            ? null
            : status === "unknown"
              ? "Could not verify the Antigravity sign-in. Check the CLI logs."
              : `Run ${loginCommand} on this machine.`,
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
