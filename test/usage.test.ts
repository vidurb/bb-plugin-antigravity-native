import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandSpec } from "../process.ts";
import { createUsageCollector, parseUsage } from "../usage.ts";
const exists = async () => "/bin/agy";
const fixture = () => ({
  status: "SUCCESS",
  num_turns: 0,
  usage: { total_tokens: 0 },
  command: {
    name: "usage",
    data: {
      groups: [
        {
          name: "Gemini",
          buckets: [
            {
              id: "gemini-weekly",
              name: "Weekly Limit Remaining",
              window: "weekly",
              remaining_fraction: 0.75,
              reset_time: "2026-11-12T03:00:00Z",
            },
            {
              id: "gemini-5h",
              name: "Five Hour Limit Remaining",
              window: "5h",
              remaining_fraction: 1,
            },
            { name: "Burst", window: "1m", remaining_fraction: 1 },
          ],
        },
      ],
    },
  },
});
const stdoutOf = (value: unknown) => ({
  code: 0,
  stdout: JSON.stringify(value),
  stderr: "",
});
test("native remaining fractions map to BB used percentages", () => {
  const r = parseUsage(fixture());
  assert.ok(r.supported && r.usage.status === "ok");
  assert.equal(r.usage.windows[0].usedPercent, 25);
  assert.equal(r.usage.windows[0].resetsAt, "2026-11-12T03:00:00Z");
});
test("native window metadata is kept and labels fit BB's used percentage", () => {
  const r = parseUsage(fixture(), 1234);
  assert.ok(r.supported && r.usage.status === "ok");
  assert.equal(r.usage.observedAt, 1234);
  assert.deepEqual(
    r.usage.windows.map(({ id, kind, label, model }) => ({
      id,
      kind,
      label,
      model,
    })),
    [
      {
        id: "gemini-weekly",
        kind: "weekly",
        label: "Gemini · Weekly Limit",
        model: "Gemini",
      },
      {
        id: "gemini-5h",
        kind: "five-hour",
        label: "Gemini · Five Hour Limit",
        model: "Gemini",
      },
      {
        id: undefined,
        kind: "custom",
        label: "Gemini · Burst",
        model: "Gemini",
      },
    ],
  );
});
test("reset times accept any valid ISO offset", () => {
  for (const reset_time of [
    "2026-11-12T03:00:00.123456789Z",
    "2026-11-12T03:00:00+00:00",
  ]) {
    const value = fixture();
    value.command.data.groups[0].buckets[0].reset_time = reset_time;
    const r = parseUsage(value);
    assert.ok(r.supported && r.usage.status === "ok");
    assert.equal(r.usage.windows[0].resetsAt, reset_time);
  }
});
test("invalid and empty quota payloads never become zero usage", () => {
  for (const value of [
    {},
    { ...fixture(), command: { name: "usage", data: { groups: [] } } },
  ])
    assert.throws(() => parseUsage(value));
  const bad = fixture();
  bad.command.data.groups[0].buckets[0].remaining_fraction = 2;
  assert.throws(() => parseUsage(bad));
});
test("quota requests coalesce, cache on disk, expire, and honor executable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agy-quota-"));
  let calls = 0,
    time = 100000;
  const runner = async (spec: CommandSpec) => {
    calls++;
    assert.equal(spec.command, "custom-agy");
    assert.deepEqual(spec.args, ["-p", "/usage", "--output-format", "json"]);
    return stdoutOf(fixture());
  };
  try {
    const collect = createUsageCollector(runner, () => time, exists);
    await Promise.all([collect("custom-agy", dir), collect("custom-agy", dir)]);
    assert.equal(calls, 1);
    await createUsageCollector(runner, () => time, exists)("custom-agy", dir);
    assert.equal(calls, 1);
    time += 60001;
    await collect("custom-agy", dir);
    assert.equal(calls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("cached quota keeps its measurement time, and refresh bypasses the cache", async () => {
  let calls = 0,
    time = 100000;
  const runner = async () => {
    calls++;
    return stdoutOf(fixture());
  };
  const collect = createUsageCollector(runner, () => time, exists);
  await collect("agy");
  time += 30000;
  const cached = await collect("agy");
  assert.ok(cached.supported && cached.usage.status === "ok");
  assert.equal(cached.usage.observedAt, 100000);
  assert.equal(calls, 1);
  const fresh = await collect("agy", undefined, {}, true);
  assert.ok(fresh.supported && fresh.usage.status === "ok");
  assert.equal(fresh.usage.observedAt, 130000);
  assert.equal(calls, 2);
});
test("sign-in failures use account states and are only briefly cached", async () => {
  let stderr = "Authentication required. Please visit the URL to log in:",
    time = 100000,
    calls = 0;
  const runner = async () => {
    calls++;
    return { code: null, stdout: "", stderr };
  };
  const collect = createUsageCollector(runner, () => time, exists);
  const signedOut = await collect("agy");
  assert.ok(signedOut.supported);
  assert.equal(signedOut.usage.status, "unauthenticated");
  time += 1000;
  await collect("agy");
  assert.equal(calls, 1);
  time += 5000;
  stderr = "oauth2: invalid_grant";
  const expired = await collect("agy");
  assert.ok(expired.supported);
  assert.equal(expired.usage.status, "expired");
  assert.equal(calls, 2);
});
test("the signed-out prompt stops the command as soon as it appears", async () => {
  let stopOn: RegExp | undefined;
  const collect = createUsageCollector(
    async (_spec, _timeout, pattern) => {
      stopOn = pattern;
      return stdoutOf(fixture());
    },
    Date.now,
    exists,
  );
  await collect("agy");
  assert.ok(stopOn?.test("Authentication required. Please visit the URL"));
});
test("a missing executable is reported without launching it", async () => {
  const collect = createUsageCollector(
    async () => {
      throw new Error("should not run");
    },
    Date.now,
    async () => null,
  );
  const r = await collect("missing");
  assert.ok(r.supported);
  assert.equal(r.usage.status, "not_installed");
});
test("other failures stay generic and keep CLI output private", async () => {
  const collect = createUsageCollector(
    async () => ({ code: 3, stdout: "", stderr: "private diagnostics" }),
    Date.now,
    exists,
  );
  const r = await collect("agy");
  assert.ok(r.supported && r.usage.status === "error");
  assert.equal(JSON.stringify(r).includes("private"), false);
});
test("a generated model turn blocks reads across restarts until the CLI changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agy-quota-"));
  let reads = 0,
    version = "1.5.0",
    turns = 1,
    time = 100000;
  const runner = async (spec: CommandSpec) => {
    if (spec.args[0] === "--version")
      return { code: 0, stdout: version, stderr: "" };
    reads++;
    return stdoutOf({ ...fixture(), num_turns: turns });
  };
  const clock = () => time;
  try {
    const collect = createUsageCollector(runner, clock, exists);
    const first = await collect("agy", dir);
    assert.ok(first.supported && first.usage.status === "error");
    assert.equal(reads, 1);
    const stored = JSON.parse(
      await readFile(join(dir, (await readdir(dir))[0]), "utf8"),
    );
    assert.equal(stored.blocked, true);
    assert.equal(stored.version, "1.5.0");

    // Neither a restart, an elapsed cache, nor a refresh repeats the command.
    const restarted = createUsageCollector(runner, clock, exists);
    await restarted("agy", dir);
    time += 60001;
    await restarted("agy", dir);
    await restarted("agy", dir, {}, true);
    assert.equal(reads, 1);

    // The running bridge recovers by itself once agy is updated.
    version = "1.6.0";
    turns = 0;
    time += 60001;
    const recovered = await restarted("agy", dir);
    assert.ok(recovered.supported && recovered.usage.status === "ok");
    assert.equal(reads, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
