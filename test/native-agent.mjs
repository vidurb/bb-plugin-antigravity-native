// A deterministic ACP peer: exercise BB's real bridge without network/model calls.
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
if (process.env.AGY_TEST_LOG)
  appendFileSync(
    process.env.AGY_TEST_LOG,
    JSON.stringify(process.argv.slice(2)) + "\n",
  );
const send = (value) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\n");
const configOptions = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "fixture-model",
    options: [{ value: "fixture-model", name: "Fixture model" }],
  },
  {
    id: "thought_level",
    name: "Thinking level",
    category: "thought_level",
    type: "select",
    currentValue: "high",
    options: [
      { value: "low", name: "Low" },
      { value: "high", name: "High" },
    ],
  },
];
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (!m.method || m.id === undefined) continue;
  let result = {};
  switch (m.method) {
    case "initialize":
      result = {
        protocolVersion: 1,
        agentInfo: { name: "Native fixture", version: "1.5.0" },
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { resume: {}, fork: {} },
        },
        authMethods: [],
      };
      break;
    case "session/new":
    case "session/fork":
      result = { sessionId: randomUUID(), configOptions };
      break;
    case "session/resume":
    case "session/load":
      result = { configOptions };
      break;
    case "session/set_config_option":
      result = { configOptions };
      break;
    case "session/prompt":
      if (!m.params.prompt.some((p) => ["/noop", "/compact"].includes(p.text)))
        send({
          method: "session/update",
          params: {
            sessionId: m.params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "native fixture reply" },
            },
          },
        });
      result = { stopReason: "end_turn" };
      break;
    case "session/set_mode":
    case "session/set_model":
      break;
    default:
      send({ id: m.id, error: { code: -32601, message: "Unknown method" } });
      continue;
  }
  send({ id: m.id, result });
}
