import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { BridgeConformanceTransport } from "@get-bb/plugin-sdk/provider-bridge/testing";

export function createTransport(): BridgeConformanceTransport {
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      fileURLToPath(new URL("../test/bridge-process.mjs", import.meta.url)),
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  let messages: unknown[] = [];
  let failure: Error | undefined;
  child.on("error", (error) => {
    failure = error;
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      messages.push(JSON.parse(line));
    } catch {
      failure = new Error(`Non-JSON bridge stdout: ${line.slice(0, 200)}`);
    }
  });
  return {
    send(line) {
      if (failure) throw failure;
      child.stdin.write(line + "\n");
    },
    takeMessages() {
      if (failure) throw failure;
      const result = messages;
      messages = [];
      return result;
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.stdin.end();
      });
    },
  };
}
