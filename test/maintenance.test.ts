import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProvider, PROVIDER_ID } from "../provider.ts";
import { createTransport } from "../scripts/transport.ts";

const fakeAgy = fileURLToPath(new URL("./fake-agy.mjs", import.meta.url));

function bridge(mode: string) {
  const dir = mkdtempSync(join(tmpdir(), "bb-agy-maintenance-"));
  const log = join(dir, "calls.jsonl");
  const transport = createTransport();
  const options = createProvider({ command: fakeAgy, sandbox: false })
    .experimental_bridgeOptions as { acpLaunchSpec: object };
  const providerOptions = {
    ...options,
    acpLaunchSpec: {
      ...options.acpLaunchSpec,
      env: { FAKE_AGY_MODE: mode, FAKE_AGY_LOG: log },
    },
  };
  let next = 0;
  return {
    async request(method: string, providerId = PROVIDER_ID): Promise<any> {
      const id = ++next;
      transport.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params: { providerId, providerOptions },
        }),
      );
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const messages = transport.takeMessages() as any[];
        const reply = messages.find((m) => m.id === id);
        if (reply) return reply.result;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`${method} did not answer within 5s`);
    },
    calls: () =>
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]),
    async close() {
      await transport.close?.();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("health confirms a signed-in CLI without opening an ACP session", async () => {
  const b = bridge("ok");
  try {
    const { health } = await b.request("provider/health");
    assert.equal(health.status, "ready");
    assert.equal(health.installedVersion, "1.5.0");
    // Anything beyond `acp --help` would start a server and a native session.
    for (const args of b.calls())
      if (args[0] === "acp") assert.deepEqual(args, ["acp", "--help"]);
  } finally {
    await b.close();
  }
});

test("a signed-out CLI is reported promptly instead of waiting for OAuth", async () => {
  const b = bridge("signed-out");
  try {
    const { health } = await b.request("provider/health");
    assert.equal(health.status, "unauthenticated");
    assert.equal(
      health.statusMessage,
      `Run ${fakeAgy} acp --login on this machine.`,
    );
    const { usage } = await b.request("provider/usage");
    assert.equal(usage.status, "unauthenticated");
    assert.equal(JSON.stringify(usage).includes("oauth2"), false);
  } finally {
    await b.close();
  }
});

test("an expired sign-in is reported as expired", async () => {
  const b = bridge("expired");
  try {
    const { usage } = await b.request("provider/usage");
    assert.equal(usage.status, "expired");
    const { health } = await b.request("provider/health");
    assert.equal(health.status, "expired");
  } finally {
    await b.close();
  }
});

test("usage windows reach BB with native kinds, ids, and readable labels", async () => {
  const b = bridge("ok");
  try {
    const { usage } = await b.request("provider/usage");
    const [window] = usage.windows;
    assert.equal(window.label, "Gemini Models · Weekly Limit");
    assert.equal(window.kind, "weekly");
    assert.equal(window.id, "gemini-weekly");
    assert.equal(window.model, "Gemini Models");
    assert.equal(window.usedPercent, 50);
    assert.equal(typeof usage.observedAt, "number");
  } finally {
    await b.close();
  }
});

test("a blocked quota read also stops health from repeating the command", async () => {
  const b = bridge("model-turn");
  try {
    const { usage } = await b.request("provider/usage");
    assert.equal(usage.status, "error");
    const reads = () => b.calls().filter((args) => args[0] === "-p").length;
    assert.equal(reads(), 1);
    const { health } = await b.request("provider/health");
    assert.equal(health.status, "unknown");
    assert.equal(reads(), 1);
  } finally {
    await b.close();
  }
});

test("another provider's maintenance request is declined, not rejected", async () => {
  const b = bridge("ok");
  try {
    assert.deepEqual(await b.request("provider/usage", "foreign"), {
      supported: false,
    });
  } finally {
    await b.close();
  }
});
