import assert from "node:assert/strict";
import { test } from "node:test";
import { readCliVersion, run } from "../process.ts";
test("bounded CLI processes capture a nonzero exit and stderr", async () => {
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
// The descendant inherits stdout, so the pipe outlives the command it serves.
const holdsStdout = (then: string) =>
  `require("child_process").spawn(process.execPath,["-e","setTimeout(()=>{},3000)"],{stdio:"inherit",detached:true}).unref();${then}`;
test("a descendant holding stdout cannot outlast the watchdog", async () => {
  const started = Date.now();
  await assert.rejects(
    run(
      {
        command: process.execPath,
        args: ["-e", holdsStdout("setInterval(()=>{},1000)")],
      },
      100,
    ),
    /timed out/,
  );
  assert.ok(Date.now() - started < 2500);
});
test("a descendant holding stdout does not delay a finished command", async () => {
  const started = Date.now();
  const r = await run({
    command: process.execPath,
    args: ["-e", holdsStdout('process.stdout.write("done")')],
  });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "done");
  assert.ok(Date.now() - started < 2500);
});
test("stopOn ends a waiting command and returns its output", async () => {
  const started = Date.now();
  const r = await run(
    {
      command: process.execPath,
      args: [
        "-e",
        'process.stderr.write("Authentication required");setInterval(()=>{},1000)',
      ],
    },
    20000,
    /authentication required/i,
  );
  assert.equal(r.stderr, "Authentication required");
  assert.ok(Date.now() - started < 5000);
});
test("CLI versions are parsed, and failures are not fatal", async () => {
  const output = (stdout: string) => async () => ({
    code: 0,
    stdout,
    stderr: "",
  });
  assert.equal(await readCliVersion(output("agy 1.5.0\n"), "agy"), "1.5.0");
  assert.equal(await readCliVersion(output("unknown"), "agy"), null);
  const failing = async () => {
    throw new Error("spawn failed");
  };
  assert.equal(await readCliVersion(failing, "agy"), null);
});
