// Keep bridge stdout and process-exit lifecycle isolated from the runner.
import { createInterface } from "node:readline";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { experimental_providerBridge: bridge } = await import(
  process.env.AGY_TEST_BUNDLE === "1" ? "../dist/host.js" : "../host.ts"
);
const dataDir = mkdtempSync(join(tmpdir(), "bb-agy-bridge-"));
bridge.start?.({ pluginId: "antigravity-native", dataDir, tempDir: dataDir });
process.once("exit", () => rmSync(dataDir, { recursive: true, force: true }));
createInterface({ input: process.stdin })
  .on("line", (line) => bridge.handleLine(line))
  .on("close", () => bridge.onClose?.());
process.on("SIGTERM", () => bridge.onSigterm?.());
