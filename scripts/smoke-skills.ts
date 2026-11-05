// Verify native project skill discovery without sending a model prompt.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { startProcess, terminateProcess } from "../process.ts";
const cwd = await mkdtemp(join(tmpdir(), "bb-agy-skills-"));
const name = "bb-native-discovery-probe";
await mkdir(join(cwd, ".agents", "skills", name), { recursive: true });
await writeFile(
  join(cwd, ".agents", "skills", name, "SKILL.md"),
  `---\nname: ${name}\ndescription: A temporary native skill discovery verification.\n---\nReply with the verification text when explicitly requested.\n`,
);
const child = startProcess({
  command: process.env.AGY_COMMAND ?? "agy",
  args: ["acp", "--process-per-session"],
  cwd,
});
const lines = createInterface({ input: child.stdout! });
child.stderr?.resume();
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Native skill was not advertised.")),
      20000,
    );
    child.once("error", reject);
    lines.on("line", (line) => {
      let m: any;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.error) {
        clearTimeout(timer);
        reject(new Error("Native ACP initialization failed."));
        return;
      }
      if (m.id === 1)
        child.stdin?.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "session/new",
            params: { cwd, mcpServers: [] },
          }) + "\n",
        );
      if (
        m.params?.update?.availableCommands?.some(
          (command: any) => command.name === name,
        )
      ) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stdin?.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientInfo: { name: "bb-native-skills-probe", version: "0.1.0" },
          clientCapabilities: {},
        },
      }) + "\n",
    );
  });
  assert.ok(true);
  console.log(
    "PASS: native ACP discovered the workspace skill and advertised its slash command.",
  );
} finally {
  lines.close();
  terminateProcess(child);
  await rm(cwd, { recursive: true, force: true });
}
