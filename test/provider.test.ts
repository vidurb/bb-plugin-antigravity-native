import { compactInput } from "../scripts/compact-input.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { experimental_acpLaunchSpecSchema } from "@get-bb/plugin-sdk/provider-bridge/acp";
import { experimental_runBridgeConformance } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { assertConformance } from "../scripts/conformance.ts";
import { createTransport } from "../scripts/transport.ts";
import { createProvider, DEFAULT_COMMAND, PROVIDER_ID } from "../provider.ts";

test("launch configuration is valid and a blank command uses the default", () => {
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
  const blank = experimental_acpLaunchSpecSchema.parse(
    createProvider({ command: "  ", sandbox: false }).experimental_bridgeOptions
      ?.acpLaunchSpec,
  );
  assert.equal(blank.command, DEFAULT_COMMAND);
});

test("sign-in hints name the configured command", () => {
  const { strings } = createProvider({ command: "/opt/agy", sandbox: false });
  assert.match(strings?.signInHint ?? "", /`\/opt\/agy acp --login`/);
  assert.match(strings?.expiredHint ?? "", /`\/opt\/agy acp --login`/);
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
        zeroWorkPromptInput: compactInput,
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
    assertConformance(report);
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

test("native roots reach both BB skill discovery and ACP reconciliation", () => {
  const provider = createProvider({ command: "agy", sandbox: false });
  const launch = experimental_acpLaunchSpecSchema.parse(
    provider.experimental_bridgeOptions?.acpLaunchSpec,
  );
  assert.deepEqual(
    launch.nativeSkillRoots,
    provider.experimental_nativeSkillRoots,
  );
  assert.ok(
    launch.nativeSkillRoots?.user.includes(".gemini/antigravity-cli/skills"),
  );
  assert.deepEqual(launch.nativeSkillRoots?.project, [
    { path: ".agents/skills", ancestors: true },
  ]);
  assert.equal(provider.capabilities.supportsManualCompaction, true);
});

test("provider and package branding use the identical safe SVG asset", async () => {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const icon = createProvider({ command: "agy", sandbox: false }).icon;
  assert.equal(icon, manifest.bb.branding.icon);
  const svg = await readFile(
    new URL("../icons/antigravity.svg", import.meta.url),
    "utf8",
  );
  assert.ok(svg.includes('viewBox="0 0 24 24"'));
  assert.doesNotMatch(svg, /<script|<foreignObject|(?:href|src)=/i);
});

test("maintenance rejects malformed requests without launching a CLI", async () => {
  const transport = createTransport();
  try {
    for (const [id, method] of [
      [1, "provider/usage"],
      [2, "provider/health"],
    ] as const) {
      transport.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params: { providerId: PROVIDER_ID },
        }),
      );
    }
    const responses: any[] = [];
    const deadline = Date.now() + 5000;
    while (responses.length < 2 && Date.now() < deadline) {
      responses.push(...transport.takeMessages());
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(responses.length, 2);
    for (const m of responses) assert.equal(m.error.code, -32602);
  } finally {
    await transport.close?.();
  }
});
