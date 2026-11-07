---
name: antigravity-native
description: Set up or troubleshoot the Antigravity Native BB provider, which launches the native agy acp server.
---

# Antigravity Native

Provider id: `antigravity-native`. Install Antigravity CLI on the machine
that will run the thread. Verify `agy acp --help`, then sign in with
`agy acp --login`. BB uses that machine's cached sign-in.

Inspect with `bb provider models antigravity-native --machine <name>`.
Models, reasoning, and session modes come from the native ACP server.
Choose Plan from the session mode picker when wanted.

If agy isn't on the daemon's PATH, set an absolute executable path with
`bb plugin config antigravity-native set command /absolute/path/to/agy`,
then `bb plugin reload antigravity-native`. The command must work on each
target machine; no shell expansion is applied.

Optional terminal containment:
`bb plugin config antigravity-native set sandbox true`, then reload.
BB full access passes `--dangerously-skip-permissions`; normal sessions
keep native approval requests. Do not change access to fix a failed tool.

The provider does not pass extra workspace directories to agy, because agy 1.5.1
and 1.5.3 can then run shell commands outside the project. Accept Edits therefore asks
before writing to thread storage.

The provider doesn't install agy or adapters. Update agy on the target
machine if the `acp` subcommand is missing. Native logs are under
`~/.gemini/antigravity-cli/log/acp-*.log`.

## Usage, health, and skills

The provider reports account quota windows in BB's Provider usage panel on the
selected machine. Quota reads use native `agy -p /usage --output-format json`
and are cached for 60 seconds. Never interpret a collection error as zero
usage. A detected model turn disables subsequent automatic reads until agy
reports a different version; update agy on that machine to resume them.

Health checks test native ACP support and the sign-in through the same quota
read, with no model prompt or ACP session. A `not_installed`, `unauthenticated`,
or `expired` usage state means fix the CLI or its sign-in on that machine.
Use BB's built-in `/compact` action for session summarization.

BB discovers standard skills in `~/.gemini/antigravity-cli/skills`,
`~/.gemini/skills`, `~/.gemini/config/skills`, and workspace/ancestor
`.agents/skills`. Custom manifests and installed native plugin skills are not
enumerated by this plugin.
