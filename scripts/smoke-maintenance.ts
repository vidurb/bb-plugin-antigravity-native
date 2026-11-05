import assert from "node:assert/strict";
import {
  providerUsageResultSchema,
  providerHealthResultSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import { createTransport } from "./transport.ts";
import { createProvider, PROVIDER_ID } from "../provider.ts";
const transport = createTransport();
const providerOptions = createProvider({
  command: process.env.AGY_COMMAND ?? "agy",
  sandbox: false,
}).experimental_bridgeOptions;
async function request(method: string, id: number) {
  transport.send(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: { providerId: PROVIDER_ID, providerOptions },
    }),
  );
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    for (const m of transport.takeMessages() as {
      id?: number;
      result?: unknown;
      error?: unknown;
    }[]) {
      if (m.id === id) {
        assert.equal(m.error, undefined, JSON.stringify(m.error));
        return m.result;
      }
    }
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`${method} timed out`);
}
try {
  const usage = providerUsageResultSchema.parse(
    await request("provider/usage", 1),
  );
  assert.ok(usage.supported && usage.usage.status === "ok");
  assert.ok(usage.usage.windows.length > 0);
  console.log(
    `PASS: native quota returned ${usage.usage.windows.length} limit windows.`,
  );
  if (process.argv.includes("--health")) {
    const health = providerHealthResultSchema.parse(
      await request("provider/health", 2),
    );
    assert.ok(health.supported && health.health.status === "ready");
    console.log(
      "PASS: native ACP support and cached authentication are healthy.",
    );
  }
} finally {
  await transport.close?.();
}
