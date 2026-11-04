// Keep the bridge's stdout and process-exit lifecycle isolated from the runner.
import { createInterface } from "node:readline";
import { experimental_providerBridge as bridge } from "../host.ts";
createInterface({ input: process.stdin })
  .on("line", (line) => bridge.handleLine(line))
  .on("close", () => bridge.onClose?.());
process.on("SIGTERM", () => bridge.onSigterm?.());
