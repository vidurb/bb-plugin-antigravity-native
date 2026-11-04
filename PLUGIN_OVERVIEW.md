Use your Antigravity CLI sign-in and model entitlements from BB. The plugin
launches Google's native `agy acp` server on the machine running your thread.

## What you get

- Models, reasoning levels, and session modes discovered from Antigravity.
- Streamed replies, tool activity, approvals, and session resume through BB's
  shared ACP bridge.
- BB-provided MCP tools, with isolated native server sessions.
- A configurable executable path and optional Antigravity terminal sandbox.

## Requirements

BB 0.48.1 or later and Antigravity CLI with `agy acp` on each target machine.
Tested with CLI 1.5.0 on macOS. Sign in there using `agy acp --login`, or reuse
an existing CLI sign-in. Model calls use your account's quota and can incur
charges under your authentication plan.

## How it works

Select Antigravity Native in BB's provider picker. The plugin runs
`agy acp --process-per-session`; it does not install adapters or a separate
ACP server. Normal sessions retain approval handling. BB full access passes
`--dangerously-skip-permissions`.

Forks and a provider quota panel are not supported. Settings changes require
a plugin reload. See the
[project README](https://github.com/vidurb/bb-plugin-antigravity-native) for
setup and validation details. This is an independent community plugin.
