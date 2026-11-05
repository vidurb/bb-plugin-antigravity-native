import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createProvider, DEFAULT_COMMAND } from "./provider.ts";
import { registerUsageSource } from "./usage-source.ts";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    command: {
      type: "string",
      label: "Antigravity CLI command",
      description:
        "agy on PATH, or an absolute executable path shared by the target machines. Reload the plugin after changing.",
      default: DEFAULT_COMMAND,
    },
    sandbox: {
      type: "boolean",
      label: "Antigravity terminal sandbox",
      description:
        "Pass --sandbox to the native ACP server. Reload the plugin after changing.",
      default: false,
    },
  });
  const values = await settings.get();
  if (!values.command.trim())
    bb.log.warn(
      `The Antigravity CLI command setting is blank; using ${DEFAULT_COMMAND}.`,
    );
  bb.providers.register(createProvider(values));
  registerUsageSource(bb);
}
