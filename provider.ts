import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";

export const PROVIDER_ID = "antigravity-native";
export interface Settings {
  command: string;
  sandbox: boolean;
}

export function createProvider(settings: Settings): PluginProviderDeclaration {
  const command = settings.command.trim();
  if (!command) throw new Error("Antigravity CLI command must not be empty.");
  return {
    id: PROVIDER_ID,
    displayName: "Antigravity Native",
    family: "acp",
    icon: "Orbit",
    strings: {
      signInHint: "Run `agy acp --login` on this machine, then retry.",
      expiredHint:
        "Run `agy acp --login` on this machine to refresh your sign-in.",
      installUrl: "https://antigravity.google/docs/getting-started",
    },
    experimental_visibility: "installed",
    experimental_bridgeOptions: {
      acpDialect: "acp",
      acpLaunchSpec: {
        displayName: "Antigravity Native",
        command,
        // Isolate sessions and enable the HTTP MCP servers BB supplies.
        args: [
          "acp",
          "--process-per-session",
          ...(settings.sandbox ? ["--sandbox"] : []),
        ],
        env: {},
        permissionCli: {
          // Flags belong after the acp subcommand. BB's normal mode keeps
          // native permission requests; full access explicitly bypasses them.
          insertAfterArgs: 1,
          full: ["--dangerously-skip-permissions"],
        },
      },
    },
    maintenance: { health: true, usage: false, installation: false },
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      fork: "none",
      permissionModes: ["accept-edits", "full"],
      reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
    },
    reasoningLevels: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra high" },
      { id: "max", label: "Max" },
    ],
    // ACP narrows these choices to the selected model's advertised options.
    models: { scope: "workspace" },
    composerActions: [],
  };
}
