import assert from "node:assert/strict";
import { test } from "node:test";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { registerUsageSource } from "../usage-source.ts";
import { usageListMethod, usageFetchMethod, usageMeasurementSchema, usageResourceListSchema } from "../usage-contract.ts";

function fixture() {
  let removed = false;
  let fail = false;
  const calls: unknown[] = [];
  let handlers: Record<string, (input: any) => Promise<unknown>>;
  const bb = {
    sdk: {
      hosts: {
        list: async () => [{ id: "mac", name: "Mac" }, { id: "server", name: "Server" }],
        get: async ({ hostId }: { hostId: string }) => ({ id: hostId, status: hostId === "offline" ? "disconnected" : "connected" }),
      },
      providers: { list: async ({ hostId }: { hostId: string }) => removed || hostId === "server" ? [] : [
        { id: "antigravity-native", pluginId: "antigravity-native", displayName: "Antigravity Native" },
        { id: "foreign", pluginId: "foreign", displayName: "Other" },
      ] },
      system: { usageLimits: async (input: unknown) => {
        calls.push(input);
        if (fail) throw new Error("Private diagnostic");
        return { "antigravity-native": { status: "ok", accountEmail: null, planLabel: null, windows: [
          { label: "Gemini Models · Weekly Limit Remaining", usedPercent: 12, resetsAt: null },
        ] } };
      } },
    },
    rpc: { register: (_contract: unknown, registered: typeof handlers, options: { experimental_discoverable: boolean }) => {
      assert.equal(options.experimental_discoverable, true);
      handlers = registered;
    } },
  };
  registerUsageSource(bb as unknown as BbPluginApi);
  return {
    calls,
    remove: () => { removed = true; },
    fail: () => { fail = true; },
    list: async () => usageResourceListSchema.parse(await handlers[usageListMethod]({})),
    read: async (host = "mac", provider = "antigravity-native", refresh = false) => usageMeasurementSchema.parse(await handlers[usageFetchMethod]({ resourceId: JSON.stringify([host, provider]), refresh })),
  };
}

test("usage panel discovers owned machine resources without quota reads and fetches only the selected resource", async () => {
  const f = fixture();
  const { resources } = await f.list();
  assert.equal(resources.length, 1);
  assert.equal(resources[0].providerId, "antigravity-native");
  assert.deepEqual(resources[0].scope, { kind: "host", hostId: "mac", hostName: "Mac" });
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.read("mac", "foreign"), /no longer exists/);
  const value = await f.read();
  assert.equal(value.usage.status, "ok");
  assert.equal(value.accountKey, null);
  if (value.usage.status === "ok") {
    assert.equal(value.usage.windows[0].usedPercent, 12);
    assert.equal(value.usage.windows[0].id, "0:Gemini Models · Weekly Limit Remaining");
  }
  assert.deepEqual(f.calls, [{ hostId: "mac", providerId: "antigravity-native", refresh: false }]);
  await f.read();
  assert.equal(f.calls.length, 1);
  await f.read("mac", "antigravity-native", true);
  assert.equal(f.calls.length, 2);
  f.remove();
  assert.deepEqual((await f.list()).resources, []);
  await assert.rejects(f.read(), /no longer exists/);
});

test("usage panel reports offline and collection errors without inventing quota or exposing diagnostics", async () => {
  const f = fixture();
  assert.equal((await f.read("offline")).usage.status, "error");
  assert.equal(f.calls.length, 0);
  const previous = await f.read();
  f.fail();
  const failed = await f.read("mac", "antigravity-native", true);
  assert.equal(failed.observedAt, previous.observedAt);
  assert.equal(failed.usage.status, "error");
  assert.equal(JSON.stringify(failed).includes("Private diagnostic"), false);
});
