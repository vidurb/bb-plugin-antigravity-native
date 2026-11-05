#!/usr/bin/env node
// A fake agy CLI, shaped from real agy 1.5.0 output, for maintenance tests.
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const mode = process.env.FAKE_AGY_MODE ?? "ok";
if (process.env.FAKE_AGY_LOG)
  appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify(args) + "\n");

if (args[0] === "--version") {
  process.stdout.write((process.env.FAKE_AGY_VERSION ?? "1.5.0") + "\n");
} else if (args[0] === "acp") {
  process.stdout.write("Start the Agent Client Protocol (ACP) stdio server\n");
} else if (mode === "signed-out") {
  // Real agy prints this, then waits for an OAuth login without exiting.
  process.stderr.write(
    "Authentication required. Please visit the URL to log in:\n  https://accounts.google.com/o/oauth2/auth?private=1\n",
  );
  setInterval(() => {}, 1000);
} else if (mode === "expired") {
  process.stderr.write("oauth2: invalid_grant: Token has been expired\n");
  process.exit(1);
} else {
  process.stdout.write(
    JSON.stringify({
      conversation_id: "",
      status: "SUCCESS",
      num_turns: mode === "model-turn" ? 1 : 0,
      usage: { total_tokens: 0 },
      command: {
        name: "usage",
        data: {
          groups: [
            {
              name: "Gemini Models",
              buckets: [
                {
                  id: "gemini-weekly",
                  name: "Weekly Limit Remaining",
                  window: "weekly",
                  remaining_fraction: 0.5,
                  reset_time: "2026-11-11T16:10:44Z",
                },
              ],
            },
          ],
        },
      },
    }) + "\n",
  );
}
