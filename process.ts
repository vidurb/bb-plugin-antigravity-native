import type { ChildProcess } from "node:child_process";
import {
  experimental_spawnPortableProcess as spawn,
  experimental_killPortableProcess as kill,
  withoutBridgeRuntimeEnv,
} from "@get-bb/plugin-sdk/provider-bridge";

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
  child.once("close", () => clearTimeout(force));
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
) => Promise<CommandResult>;
export const run: Runner = (spec, timeoutMs = 25000) =>
  new Promise((resolve, reject) => {
    const child = startProcess(spec);
    let stdout = "",
      stderr = "",
      size = 0,
      failure: Error | undefined;
    const terminate = () => terminateProcess(child);
    const timer = setTimeout(() => {
      failure = new Error("Antigravity command timed out.");
      terminate();
    }, timeoutMs);
    const append = (chunk: Buffer, lane: "stdout" | "stderr") => {
      if (failure) return;
      size += chunk.length;
      if (size > 1024 * 1024) {
        failure = new Error("Antigravity output exceeded 1 MiB.");
        terminate();
        return;
      }
      if (lane === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    child.stdout?.on("data", (chunk) => append(chunk, "stdout"));
    child.stderr?.on("data", (chunk) => append(chunk, "stderr"));
    child.once("error", (error) => {
      clearTimeout(timer);
      children.delete(child);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      children.delete(child);
      if (failure) reject(failure);
      else resolve({ code, stdout, stderr });
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end();
  });
export function stopMaintenanceProcesses() {
  for (const child of children) kill(child, "SIGKILL");
  children.clear();
}
