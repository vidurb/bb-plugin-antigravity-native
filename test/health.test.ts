import assert from "node:assert/strict";
import { test } from "node:test";
import { authStatusFromUsage, createHealthChecker } from "../health.ts";
const exists = async () => "/bin/agy";
const runner = async (spec: { args: string[] }) => ({
  code: 0,
  stdout:
    spec.args[0] === "--version"
      ? "1.5.0"
      : "Start the Agent Client Protocol (ACP) stdio server",
  stderr: "",
});
test("missing executable is reported without launching probes", async () => {
  const checker = createHealthChecker(
    async () => "ready",
    async () => {
      throw new Error("should not run");
    },
    async () => null,
  );
  const r = await checker("missing");
  assert.ok(r.supported);
  assert.equal(r.health.status, "not_installed");
});
test("present CLI without native ACP is unsupported", async () => {
  const checker = createHealthChecker(
    async () => {
      throw new Error("should not probe");
    },
    async () => ({ code: 1, stdout: "unknown subcommand", stderr: "" }),
    exists,
  );
  const r = await checker("agy");
  assert.ok(r.supported);
  assert.equal(r.health.status, "unsupported_version");
});
for (const status of [
  "ready",
  "unauthenticated",
  "expired",
  "unknown",
] as const)
  test(`health reports native sign-in state ${status}`, async () => {
    const r = await createHealthChecker(
      async () => status,
      runner,
      exists,
    )("custom-agy");
    assert.ok(r.supported);
    assert.equal(r.health.status, status);
    assert.equal(r.health.installedVersion, "1.5.0");
    assert.equal(r.health.loginCommand, "custom-agy acp --login");
    if (status === "unauthenticated" || status === "expired")
      assert.equal(
        r.health.statusMessage,
        "Run custom-agy acp --login on this machine.",
      );
  });
test("health requests coalesce and expire", async () => {
  let calls = 0,
    time = 1000;
  const checker = createHealthChecker(
    async () => {
      calls++;
      return "ready";
    },
    runner,
    exists,
    () => time,
  );
  await Promise.all([checker("agy"), checker("agy")]);
  await checker("agy");
  assert.equal(calls, 1);
  time += 30001;
  await checker("agy");
  assert.equal(calls, 2);
});
test("quota read outcomes map to sign-in states", () => {
  const account = { accountEmail: null, planLabel: null };
  const of = (usage: any) => authStatusFromUsage({ supported: true, usage });
  assert.equal(of({ status: "ok", ...account, windows: [] }), "ready");
  assert.equal(of({ status: "unauthenticated" }), "unauthenticated");
  assert.equal(of({ status: "expired" }), "expired");
  assert.equal(of({ status: "error", ...account, message: "x" }), "unknown");
  assert.equal(of({ status: "not_installed" }), "unknown");
  assert.equal(authStatusFromUsage({ supported: false }), "unknown");
});
