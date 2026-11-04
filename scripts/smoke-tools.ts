// Opt-in: confirm native agy can call a BB-injected MCP tool end to end.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTransport } from "./transport.ts";
import { createProvider } from "../provider.ts";

const cwd = mkdtempSync(join(tmpdir(), "bb-agy-tools-"));
const transport = createTransport();
const secret = randomUUID();
const options = {
  permissionMode: "accept-edits",
  permissionScope: "workspace",
  approvalReviewer: "user",
  permissionEscalation: "ask",
  providerOptions: createProvider({
    command: process.env.AGY_COMMAND ?? "agy",
    sandbox: false,
  }).experimental_bridgeOptions,
};
let next = 0,
  calls = 0;
const log: any[] = [];
const send = (method: string, params: unknown) => {
  const id = ++next;
  transport.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  return id;
};
async function waitFor(predicate: (m: any) => boolean) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    for (const m of transport.takeMessages() as any[]) {
      log.push(m);
      if (m.method === "item/tool/call") {
        assert.equal(m.params.tool, "bb_native_probe");
        calls++;
        transport.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: m.id,
            result: {
              success: true,
              contentItems: [{ type: "inputText", text: secret }],
            },
          }),
        );
      } else if (m.method === "interaction/request") {
        throw new Error(
          "Unexpected approval in the read-only MCP probe: " +
            JSON.stringify(m.params.payload),
        );
      }
    }
    const match = log.find(predicate);
    if (match) {
      if (match.error) throw new Error(JSON.stringify(match.error));
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for bridge response");
}
try {
  let id = send("initialize", {
    protocolVersion: 2,
    client: { name: "bb-native-smoke", version: "0.1.0" },
    grammarVersions: [3, 3],
  });
  await waitFor((m) => m.id === id && !m.method);
  id = send("thread/start", {
    threadId: "thr_native_tools",
    cwd,
    options,
    instructionMode: "append",
    dynamicTools: [
      {
        name: "bb_native_probe",
        description:
          "Return the verification code. Read only, no side effects.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ],
  });
  const started = await waitFor((m) => m.id === id && !m.method);
  id = send("turn/start", {
    threadId: "thr_native_tools",
    providerThreadId: started.result.providerThreadId,
    clientRequestId: "creq_23456789ab",
    options,
    input: [
      {
        type: "text",
        text: "Call the bb_native_probe tool once, then reply with the exact verification code it returns. Do not use any other tools.",
        mentions: [],
      },
    ],
  });
  await waitFor((m) => m.id === id && !m.method);
  await waitFor(
    (m) =>
      m.method === "thread/delta" &&
      m.params.deltas.some((d: any) => d.kind === "turn.boundary"),
  );
  assert.equal(calls, 1, "native agent must invoke the injected BB tool");
  const reply = log
    .filter((m) => m.method === "thread/delta")
    .flatMap((m) => m.params.deltas)
    .filter((d) => d.kind === "item.textDelta" && d.channel === "agentMessage")
    .map((d) => d.text)
    .join("");
  assert.ok(
    reply.includes(secret),
    "agent must return the code supplied only through MCP; received: " + reply,
  );
  console.log(
    "PASS: native agy called a BB MCP tool and returned its verification code.",
  );
} finally {
  await transport.close?.();
  rmSync(cwd, { recursive: true, force: true });
}
