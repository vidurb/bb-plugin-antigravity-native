import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { experimental_acpLaunchSpecSchema } from "@get-bb/plugin-sdk/provider-bridge/acp";
import {
  experimental_runBridgeConformance,
  experimental_formatConformanceReport,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import { createTransport } from "../scripts/transport.ts";
import { createProvider, PROVIDER_ID } from "../provider.ts";

test("launch configuration is valid and requires an executable", () => {
  const provider = createProvider({ command: " /custom/agy ", sandbox: true });
  const launch = experimental_acpLaunchSpecSchema.parse(
    provider.experimental_bridgeOptions?.acpLaunchSpec,
  );
  assert.equal(launch.command, "/custom/agy");
  assert.deepEqual(launch.args, ["acp", "--process-per-session", "--sandbox"]);
  assert.deepEqual(launch.permissionCli, {
    insertAfterArgs: 1,
    full: ["--dangerously-skip-permissions"],
  });
  assert.throws(
    () => createProvider({ command: "  ", sandbox: false }),
    /must not be empty/,
  );
});

test("published bridge passes protocol conformance with native-shaped launch flags", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "bb-agy-test-"));
  const launch = experimental_acpLaunchSpecSchema.parse(
    createProvider({ command: process.execPath, sandbox: false })
      .experimental_bridgeOptions?.acpLaunchSpec,
  );
  // The fixture script precedes the unchanged native subcommand and flags.
  launch.args.unshift(
    fileURLToPath(new URL("./native-agent.mjs", import.meta.url)),
  );
  launch.permissionCli!.insertAfterArgs = 2;
  launch.env = { AGY_TEST_LOG: join(cwd, "launch.jsonl") };
  const transport = createTransport();
  try {
    const report = await experimental_runBridgeConformance({
      providerId: PROVIDER_ID,
      transport,
      session: {
        cwd,
        promptInput: [{ type: "text", text: "hello", mentions: [] }],
        zeroWorkPromptInput: [{ type: "text", text: "/noop", mentions: [] }],
        options: {
          permissionMode: "full",
          permissionScope: "full",
          approvalReviewer: null,
          permissionEscalation: null,
          providerOptions: { acpDialect: "acp", acpLaunchSpec: launch },
        },
      },
      timeoutMs: 5000,
    });
    assert.equal(
      report.passed,
      true,
      experimental_formatConformanceReport(report),
    );
    const launches = readFileSync(join(cwd, "launch.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(launches.length >= 2, "start and resume both launch the agent");
    for (const args of launches)
      assert.deepEqual(args, [
        "acp",
        "--dangerously-skip-permissions",
        "--process-per-session",
      ]);
  } finally {
    await transport.close?.();
    rmSync(cwd, { recursive: true, force: true });
  }
});
