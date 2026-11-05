import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../process.ts";
test("bounded CLI processes retain a nonzero exit without printing stderr", async () => {
  const r = await run({
    command: process.execPath,
    args: ["-e", 'process.stderr.write("private diagnostics");process.exit(7)'],
  });
  assert.equal(r.code, 7);
  assert.equal(r.stderr, "private diagnostics");
});
test("CLI watchdog terminates a hung child", async () => {
  await assert.rejects(
    run(
      { command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] },
      100,
    ),
    /timed out/,
  );
});
test("CLI output bounds terminate an excessive response", async () => {
  await assert.rejects(
    run({
      command: process.execPath,
      args: [
        "-e",
        'process.stdout.write("x".repeat(2*1024*1024));setInterval(()=>{},1000)',
      ],
    }),
    /exceeded/,
  );
});
