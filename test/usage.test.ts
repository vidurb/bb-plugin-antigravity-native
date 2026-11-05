import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUsageCollector, parseUsage } from "../usage.ts";
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
              name: "Weekly remaining",
              remaining_fraction: 0.75,
              reset_time: "2026-11-12T03:00:00Z",
            },
          ],
        },
      ],
    },
  },
});
test("native remaining fractions map to BB used percentages", () => {
  const r = parseUsage(fixture());
  assert.ok(r.supported && r.usage.status === "ok");
  assert.equal(r.usage.windows[0].usedPercent, 25);
  assert.equal(r.usage.windows[0].resetsAt, "2026-11-12T03:00:00Z");
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
  const runner = async (spec: any) => {
    calls++;
    assert.equal(spec.command, "custom-agy");
    assert.deepEqual(spec.args, ["-p", "/usage", "--output-format", "json"]);
    return { code: 0, stdout: JSON.stringify(fixture()), stderr: "" };
  };
  try {
    const collect = createUsageCollector(runner, () => time);
    await Promise.all([collect("custom-agy", dir), collect("custom-agy", dir)]);
    assert.equal(calls, 1);
    await createUsageCollector(runner, () => time)("custom-agy", dir);
    assert.equal(calls, 1);
    time += 60001;
    await collect("custom-agy", dir);
    assert.equal(calls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("a generated model turn latches quota reads off across collector restarts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agy-quota-"));
  let calls = 0;
  const runner = async () => {
    calls++;
    return {
      code: 0,
      stdout: JSON.stringify({ ...fixture(), num_turns: 1 }),
      stderr: "",
    };
  };
  try {
    const r = await createUsageCollector(runner)("agy", dir);
    assert.ok(r.supported && r.usage.status === "error");
    await createUsageCollector(runner)("agy", dir);
    assert.equal(calls, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
