import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createProvider } from "./provider.ts";
import { registerUsageSource } from "./usage-source.ts";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    command: {
      type: "string",
      label: "Antigravity CLI command",
      description:
        "agy on PATH, or an absolute executable path shared by the target machines. Reload the plugin after changing.",
      default: "agy",
    },
    sandbox: {
      type: "boolean",
      label: "Antigravity terminal sandbox",
      description:
        "Pass --sandbox to the native ACP server. Reload the plugin after changing.",
      default: false,
    },
  });
  bb.providers.register(createProvider(await settings.get()));
  registerUsageSource(bb);
}
