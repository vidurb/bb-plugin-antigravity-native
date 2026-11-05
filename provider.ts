import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";

// Standard native folders, verified against Google's customization discovery guide.
export const NATIVE_SKILL_ROOTS = {
  user: [
    ".gemini/antigravity-cli/skills",
    ".gemini/skills",
    ".gemini/config/skills",
  ],
  project: [{ path: ".agents/skills", ancestors: true }],
};
export const PLUGIN_ID = "antigravity-native";
export const PROVIDER_ID = "antigravity-native";
export const DEFAULT_COMMAND = "agy";
export interface Settings {
  command: string;
  sandbox: boolean;
}

export function createProvider(settings: Settings): PluginProviderDeclaration {
  const command = settings.command.trim() || DEFAULT_COMMAND;
  return {
    id: PROVIDER_ID,
    displayName: "Antigravity Native",
    family: "acp",
    icon: "./icons/antigravity.svg",
    strings: {
      signInHint: `Run \`${command} acp --login\` on this machine, then retry.`,
      expiredHint: `Run \`${command} acp --login\` on this machine to refresh your sign-in.`,
      installUrl: "https://antigravity.google/docs/getting-started",
    },
    experimental_visibility: "installed",
    experimental_nativeSkillRoots: NATIVE_SKILL_ROOTS,
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
        nativeSkillRoots: NATIVE_SKILL_ROOTS,
        permissionCli: {
          // Flags belong after the acp subcommand. BB's normal mode keeps
          // native permission requests; full access explicitly bypasses them.
          insertAfterArgs: 1,
          full: ["--dangerously-skip-permissions"],
        },
      },
    },
    maintenance: { health: true, usage: true, installation: false },
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      supportsManualCompaction: true,
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
