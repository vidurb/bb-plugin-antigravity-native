# Antigravity Native for BB

Run [BB](https://getbb.app) threads through Google's native **`agy acp`**
server. No third-party Antigravity adapter, standalone ACP server download,
print-mode subprocess per turn, or conversation database polling.

The plugin registers `antigravity-native` using BB's published ACP bridge.
Models, reasoning levels, and session modes come from the signed-in agent.
BB handles streamed replies, tool calls, approvals, cancellation, MCP tools,
and session resume. The plugin adds account quota reporting, native skill
discovery, and BB's manual compaction action.

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
  A blank value falls back to `agy` and logs a warning.
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

BB's **Approve for me** mode is not supported by the shared ACP bridge.
Enabling the sandbox does not enable Antigravity's native Auto mode. Native
permission requests in Accept Edits are forwarded to BB for your approval.
Native session modes can also affect which actions require approval.

The plugin does not pass BB's extra workspace directories, such as thread
storage, to the agent. `agy` 1.5.1 and 1.5.3 run shell commands in the
first-sorted of the session directory and those directories, so a checkout in
`~/src` would run commands in `~/.bb/thread-storage`. As a result, Accept Edits
asks for approval before writing to thread storage.

## Usage and health

BB's Provider usage panel can read Antigravity's weekly and five-hour quota
windows on the selected machine. The collector invokes
`agy -p /usage --output-format json`, checks that it performed zero model
turns and consumed zero tokens, then maps the returned remaining fractions to
BB's used percentages. Results are cached for 60 seconds and report when they
were measured; concurrent requests share one lookup. A missing CLI or a
missing/expired sign-in is reported as that state. Failures are cached for 5
seconds and are never shown as zero usage.

The command currently returns structured `command.data.groups` in CLI 1.5.0.
That output shape may change. If a future CLI unexpectedly generates a model
turn, the collector stops further automatic reads, and resumes by itself once
the CLI reports a different version. No Google credentials are read or stored
by the plugin. The cache contains quota windows and timestamps only.

Health checks verify the executable and native `acp` support, then use the same
quota read to confirm the sign-in. They send no model prompt and open no ACP
session, because each native session leaves a permanent conversation on disk.
They report missing CLI, unsupported CLI, missing/expired authentication,
unknown failure, or ready. Credentials that the native `/usage` command cannot
report on show as unknown; this has only been tested with Google sign-in.
Health requests coalesce and cache results for 30 seconds. CLI subprocesses
have time and output limits and are stopped when the bridge closes.

## Compaction and native skills

Use BB's `/compact` action to summarize the current native session. This uses
BB's built-in command metadata and produces a compaction item in the timeline.
The native agent performs compaction; model quota may be consumed.

BB lists standard Antigravity skills from:

- `~/.gemini/antigravity-cli/skills/`
- `~/.gemini/skills/`
- `~/.gemini/config/skills/`
- `.agents/skills/` in the workspace and repository ancestors

These roots are also passed to the ACP bridge for native skill reconciliation.
Custom manifest paths and plugin-bundled skill roots are not enumerated by the
plugin yet. See Google's
[customization discovery guide](https://antigravity.google/docs/customization-discovery?tab=cli)
for native precedence and customization rules.

## Development and validation

Install the pinned Node.js runtime, then dependencies:

```sh
mise install
mise run setup
```

Or, with Node 24 already available:

```sh
npm ci
npm run format:check
npm run typecheck
npm test
npm run build
npm run test:live
npm run test:tools
npm run test:maintenance
npm run test:skills
```

`npm test` runs offline against a deterministic ACP peer through the real
published BB bridge. It covers protocol conformance, streamed turns, resume,
launch flags, launch-spec validation, quota parsing and caching, health states
against a fake CLI, process cancellation/output bounds, native roots, and
branding. Tests run the bridge in a child process because it owns stdout and
exits when its stdin closes.

The opt-in live tests use the local signed-in account. `test:live` checks chat,
resume, and completed compaction, and `test:tools` also spends model quota.
`test:tools` exposes a read-only BB MCP tool and verifies that the agent calls
it and returns a random code available only in the tool result.
`test:maintenance` verifies native quotas and authentication; `test:skills`
verifies native discovery of a temporary workspace skill without a model prompt,
and like any native session it leaves a conversation on disk. `AGY_COMMAND`
overrides the test executable. Set `AGY_TEST_BUNDLE=1` to test the built host
artifact instead of TypeScript source (run the build first).

## Current limits

No fork or archive/rename forwarding is advertised. Agent-provided slash commands and session
modes remain available through ACP where supported by BB.

SDK 0.6.104's generic bridge advertises `fork: tip` in its protocol handshake
before it discovers whether an agent supports forks. BB intersects this with
this plugin's `fork: none` declaration. The direct conformance tests accept
that specific upstream mismatch and require all other checks to pass; they do
not claim fork support.

The global BB Providers settings page currently queries the server machine.
An installed-only provider can therefore appear in a Mac's thread composer
while being absent from that page when the server has no `agy`. This requires
a machine-aware settings change in BB; it is not fixed by this plugin.

This is an independent community plugin, not affiliated with Google or BB.

## License

MIT
