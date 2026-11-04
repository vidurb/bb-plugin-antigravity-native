# Antigravity Native for BB

Run [BB](https://getbb.app) threads through Google's native **`agy acp`**
server. No third-party Antigravity adapter, standalone ACP server download,
print-mode subprocess per turn, or conversation database polling.

The plugin registers `antigravity-native` using BB's published ACP bridge.
Models, reasoning levels, and session modes come from the signed-in agent.
BB handles streamed replies, tool calls, approvals, cancellation, MCP tools,
and session resume.

## Requirements

- BB 0.48.1 or later (Plugin SDK 0.6.104 or later).
- Antigravity CLI with native ACP on each machine running threads. Tested
  with `agy` 1.5.0 on macOS; other operating systems are not yet verified.
- An Antigravity account or supported credentials. Model calls consume your
  account's quota and may incur charges under your authentication plan.

Verify the CLI and sign in **on the thread's machine**:

```sh
agy acp --help
agy acp --login
```

Google's [ACP guide](https://antigravity.google/docs/cli/acp/) describes
installation and authentication. Existing cached CLI sign-in is reused.
The plugin does not read or store credentials.

## Install

```sh
bb plugin install https://github.com/vidurb/bb-plugin-antigravity-native
bb provider models antigravity-native --machine <machine-name>
```

Choose **Antigravity Native** in the provider picker. Select a session mode
such as Plan from the agent's mode picker. The provider appears only on
machines where BB finds the configured command.

BB's server loads the plugin; the enrolled machine running the thread
launches `agy`. The server itself does not need Antigravity installed.
For a local path install, the path must exist on the BB server.

## Settings

Settings are read at load time; reload after changes.

- `command`: executable name on PATH or absolute path, default `agy`. It is
  executed directly, without a shell. `~` and shell variables are not expanded.
  A configured absolute path must be valid on every machine using the provider.
- `sandbox`: pass Antigravity's `--sandbox`, default `false`.

```sh
bb plugin config antigravity-native set command /absolute/path/to/agy
bb plugin config antigravity-native set sandbox true
bb plugin reload antigravity-native
```

Launch is `agy acp --process-per-session`, with optional `--sandbox`.
Process isolation enables editor-provided HTTP MCP servers. Normal BB
sessions preserve native permission requests and BB's approval handling.
BB full access additionally passes `--dangerously-skip-permissions`.
Native session modes can also affect which actions require approval.

## Development and validation

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run test:live
npm run test:tools
```

`npm test` runs offline against a deterministic ACP peer through the real
published BB bridge. It covers protocol conformance, streamed turns, resume,
launch flags, and launch-spec validation. Tests run the bridge in a child
process because it owns stdout and exits when its stdin closes.

The two opt-in live tests use the local signed-in account and spend model
quota. `test:live` checks chat and resume. `test:tools` exposes a read-only BB
MCP tool and verifies that the agent calls it and returns a random code
available only in the tool result. `AGY_COMMAND` overrides the test executable.

## Current limits

No fork, provider usage panel, archive/rename forwarding, or dedicated BB
compaction action is advertised. Agent-provided slash commands and session
modes remain available through ACP where supported by BB.

SDK 0.6.104's generic bridge advertises `fork: tip` in its protocol handshake
before it discovers whether an agent supports forks. BB intersects this with
this plugin's `fork: none` declaration. The direct live conformance test
reports that specific upstream mismatch and requires all other checks to
pass; it does not claim fork support.

This is an independent community plugin, not affiliated with Google or BB.

## License

MIT
