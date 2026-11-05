// Opt-in: uses the signed-in account and sends one short model prompt.
import { compactInput } from "./compact-input.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  experimental_runBridgeConformance,
  experimental_formatConformanceReport,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import { createTransport } from "./transport.ts";
import { createProvider, PROVIDER_ID } from "../provider.ts";

const cwd = mkdtempSync(join(tmpdir(), "bb-agy-live-"));
const transport = createTransport();
const originalTake = transport.takeMessages;
let sawCompaction = false;
let compactedContext = false;
transport.takeMessages = () => {
  const messages = originalTake();
  for (const m of messages as any[]) {
    if (
      m.method === "thread/delta" &&
      m.params.deltas.some(
        (d: any) => d.kind === "item.open" && d.item?.type === "compaction",
      )
    )
      sawCompaction = true;
    if (
      m.method === "thread/delta" &&
      m.params.deltas.some((d: any) => d.kind === "context.compacted")
    )
      compactedContext = true;
  }
  return messages;
};
let report;
try {
  report = await experimental_runBridgeConformance({
    providerId: PROVIDER_ID,
    transport,
    session: {
      cwd,
      zeroWorkPromptInput: compactInput,
      promptInput: [
        {
          type: "text",
          text: "Reply with exactly BB_NATIVE_ACP_OK. Do not use any tools.",
          mentions: [],
        },
      ],
      options: {
        permissionMode: "accept-edits",
        permissionScope: "workspace",
        approvalReviewer: "user",
        permissionEscalation: "ask",
        providerOptions: createProvider({
          command: process.env.AGY_COMMAND ?? "agy",
          sandbox: false,
        }).experimental_bridgeOptions,
      },
    },
    timeoutMs: 60000,
  });
} finally {
  await transport.close?.();
  rmSync(cwd, { recursive: true, force: true });
}
console.log(experimental_formatConformanceReport(report!));
// SDK 0.6.104's shared bridge advertises fork:tip before probing the agent.
// BB intersects this with our declaration (fork:none); direct conformance
// cannot do that. Require all other cells to pass and this exact upstream error.
for (const result of report!.results) {
  if (result.id === "session/fork-identity" && result.status === "fail") {
    assert.match(result.detail, /does not advertise session\/fork support/);
    console.log(
      "Known SDK limitation: native Antigravity has no fork; plugin declares fork:none.",
    );
  } else assert.notEqual(result.status, "fail", result.detail);
}

assert.ok(sawCompaction, "Native /compact must produce a BB compaction item.");

assert.ok(
  compactedContext,
  "Native /compact must confirm successful context compaction.",
);
