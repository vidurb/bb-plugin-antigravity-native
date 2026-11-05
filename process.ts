import type { ChildProcess } from "node:child_process";
import {
  experimental_spawnPortableProcess as spawn,
  experimental_killPortableProcess as kill,
  withoutBridgeRuntimeEnv,
} from "@get-bb/plugin-sdk/provider-bridge";

// A descendant can inherit stdout and hold "close" open after the CLI exits.
const EXIT_DRAIN_MS = 500;
const VERSION_TIMEOUT_MS = 4000;

const children = new Set<ChildProcess>();
export function startProcess(spec: CommandSpec) {
  const child = spawn({
    ...spec,
    env: { ...withoutBridgeRuntimeEnv(process.env), ...spec.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);
  child.once("close", () => children.delete(child));
  return child;
}
export function terminateProcess(child: ChildProcess) {
  kill(child, "SIGTERM");
  const force = setTimeout(() => kill(child, "SIGKILL"), 1000);
  force.unref();
  child.once("exit", () => clearTimeout(force));
}
export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}
export interface CommandSpec {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}
export type Runner = (
  spec: CommandSpec,
  timeoutMs?: number,
  /** Stop the command and return its output once this text appears. */
  stopOn?: RegExp,
) => Promise<CommandResult>;
export const run: Runner = (spec, timeoutMs = 25000, stopOn) =>
  new Promise((resolve, reject) => {
    const child = startProcess(spec);
    let stdout = "",
      stderr = "",
      size = 0,
      stopped = false,
      settled = false,
      failure: Error | undefined,
      drain: ReturnType<typeof setTimeout> | undefined;
    const terminate = () => terminateProcess(child);
    const timer = setTimeout(() => {
      failure = new Error("Antigravity command timed out.");
      terminate();
    }, timeoutMs);
    const settle = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(drain);
      children.delete(child);
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (failure) reject(failure);
      else resolve({ code, stdout, stderr });
    };
    const append = (chunk: Buffer, lane: "stdout" | "stderr") => {
      if (failure || stopped) return;
      size += chunk.length;
      if (size > 1024 * 1024) {
        failure = new Error("Antigravity output exceeded 1 MiB.");
        terminate();
        return;
      }
      const text = chunk.toString();
      if (lane === "stdout") stdout += text;
      else stderr += text;
      if (stopOn?.test(text)) {
        stopped = true;
        terminate();
      }
    };
    child.stdout?.on("data", (chunk) => append(chunk, "stdout"));
    child.stderr?.on("data", (chunk) => append(chunk, "stderr"));
    child.once("error", (error) => {
      failure ??= error;
      settle(null);
    });
    child.once("exit", (code) => {
      drain = setTimeout(() => settle(code), EXIT_DRAIN_MS);
    });
    child.once("close", (code) => settle(code));
    child.stdin?.on("error", () => {});
    child.stdin?.end();
  });
export async function readCliVersion(
  runner: Runner,
  command: string,
  env: Record<string, string> = {},
): Promise<string | null> {
  try {
    const version = await runner(
      { command, args: ["--version"], env },
      VERSION_TIMEOUT_MS,
    );
    return (
      version.stdout.trim().match(/\b\d+\.\d+\.\d+(?:-[\w.-]+)?\b/)?.[0] ?? null
    );
  } catch {
    return null;
  }
}
export function stopMaintenanceProcesses() {
  for (const child of children) kill(child, "SIGKILL");
  children.clear();
}
