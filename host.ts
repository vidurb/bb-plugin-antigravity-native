import {
  bridgeRequestEnvelopeSchema,
  providerMaintenanceParamsSchema,
  createBridgeIo,
  experimental_defineProviderBridge,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  experimental_acpProviderBridge as acp,
  experimental_acpLaunchSpecSchema,
} from "@get-bb/plugin-sdk/provider-bridge/acp";
import { createHealthChecker } from "./health.ts";
import { createUsageCollector } from "./usage.ts";
import { stopMaintenanceProcesses } from "./process.ts";
import { PROVIDER_ID } from "./provider.ts";

const io = createBridgeIo();
const collectUsage = createUsageCollector();
const checkHealth = createHealthChecker();
let dataDir: string | undefined;
export const experimental_providerBridge = experimental_defineProviderBridge({
  start(context) {
    dataDir = context.dataDir;
    acp.start?.(context);
  },
  handleLine(line) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      acp.handleLine(line);
      return;
    }
    const envelope = bridgeRequestEnvelopeSchema.safeParse(raw);
    if (
      !envelope.success ||
      !["provider/usage", "provider/health"].includes(envelope.data.method)
    ) {
      acp.handleLine(line);
      return;
    }
    const { id, params } = envelope.data;
    const parsed = providerMaintenanceParamsSchema.safeParse(params);
    const launch = experimental_acpLaunchSpecSchema.safeParse(
      parsed.success ? parsed.data.providerOptions?.acpLaunchSpec : undefined,
    );
    if (!parsed.success || !launch.success) {
      io.sendError(
        id,
        -32602,
        "Invalid native Antigravity maintenance parameters.",
      );
      return;
    }
    if (parsed.data.providerId !== PROVIDER_ID) {
      io.sendResult(id, { supported: false });
      return;
    }
    const operation =
      envelope.data.method === "provider/usage"
        ? collectUsage(launch.data.command, dataDir, launch.data.env)
        : checkHealth(launch.data.command, launch.data.env, parsed.data.cwd);
    void operation.then(
      (result) => io.sendResult(id, result),
      () => io.sendError(id, -32603, "Antigravity maintenance failed."),
    );
  },
  onClose() {
    stopMaintenanceProcesses();
    acp.onClose?.();
  },
  onSigterm() {
    stopMaintenanceProcesses();
    acp.onSigterm?.();
  },
  onSigint() {
    stopMaintenanceProcesses();
    acp.onSigint?.();
  },
});
