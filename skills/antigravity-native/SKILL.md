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

The provider doesn't install agy or adapters. Update agy on the target
machine if the `acp` subcommand is missing. Native logs are under
`~/.gemini/antigravity-cli/log/acp-*.log`.
