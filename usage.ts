import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { providerUsageResultSchema } from "@get-bb/plugin-sdk/provider-bridge";
import { run, type Runner } from "./process.ts";

export type UsageResult = z.infer<typeof providerUsageResultSchema>;
const bucketSchema = z.object({
  name: z.string().min(1),
  remaining_fraction: z.number().min(0).max(1),
  reset_time: z.string().datetime().optional(),
});
const outputSchema = z.object({
  status: z.literal("SUCCESS"),
  num_turns: z.literal(0),
  usage: z.record(z.string(), z.number().nonnegative()),
  command: z.object({
    name: z.literal("usage"),
    data: z.object({
      groups: z
        .array(
          z.object({
            name: z.string().min(1),
            buckets: z.array(bucketSchema).min(1),
          }),
        )
        .min(1),
    }),
  }),
});
const cacheSchema = z.object({
  at: z.number(),
  result: providerUsageResultSchema,
  blocked: z.boolean().optional(),
});
export function parseUsage(value: unknown): UsageResult {
  const parsed = outputSchema.parse(value);
  if (Object.values(parsed.usage).some((n) => n !== 0))
    throw new Error("Model generation detected during quota lookup.");
  return {
    supported: true,
    usage: {
      status: "ok",
      accountEmail: null,
      planLabel: null,
      windows: parsed.command.data.groups.flatMap((group) =>
        group.buckets.map((bucket) => ({
          label: `${group.name} · ${bucket.name}`,
          usedPercent:
            Math.round((1 - bucket.remaining_fraction) * 10000) / 100,
          resetsAt: bucket.reset_time ?? null,
        })),
      ),
    },
  };
}
function error(message: string): UsageResult {
  return {
    supported: true,
    usage: { status: "error", message, accountEmail: null, planLabel: null },
  };
}
export function createUsageCollector(runner: Runner = run, now = Date.now) {
  const pending = new Map<string, Promise<UsageResult>>();
  const memory = new Map<string, z.infer<typeof cacheSchema>>();
  return async function collect(
    command: string,
    dataDir?: string,
    env: Record<string, string> = {},
  ): Promise<UsageResult> {
    const key = createHash("sha256")
      .update(JSON.stringify([command, Object.entries(env).sort()]))
      .digest("hex");
    const existing = pending.get(key);
    if (existing) return existing;
    const promise = (async () => {
      const path = dataDir ? join(dataDir, `quota-${key}.json`) : undefined;
      let cached = memory.get(key);
      if (!cached && path) {
        try {
          cached = cacheSchema.parse(JSON.parse(await readFile(path, "utf8")));
        } catch {
          /* First run or invalid cache: fetch fresh. */
        }
      }
      if (cached?.blocked) return cached.result;
      if (cached && now() >= cached.at && now() - cached.at < 60000)
        return cached.result;
      let blocked = false,
        result: UsageResult;
      try {
        const response = await runner({
          command,
          args: ["-p", "/usage", "--output-format", "json"],
          env,
        });
        const raw: unknown = JSON.parse(response.stdout);
        // Refuse to repeat a command that unexpectedly invoked a model.
        const generation = z
          .object({
            num_turns: z.number().optional(),
            usage: z.record(z.string(), z.number()).optional(),
          })
          .safeParse(raw);
        blocked =
          generation.success &&
          ((generation.data.num_turns ?? 0) > 0 ||
            Object.values(generation.data.usage ?? {}).some((n) => n > 0));
        if (blocked)
          throw new Error(
            "Model generation detected. Automatic quota reads are disabled; clear the plugin bridge quota cache after updating agy.",
          );
        if (response.code !== 0) throw new Error("Quota command failed.");
        result = parseUsage(raw);
      } catch (cause) {
        result = error(
          blocked
            ? (cause as Error).message
            : "Could not read native Antigravity quota. Check CLI sign-in and version, then retry.",
        );
      }
      // Failed reads are briefly cached to avoid repeatedly launching the CLI.
      const entry = {
        at:
          now() -
          (result.supported && result.usage.status === "error" && !blocked
            ? 55000
            : 0),
        result,
        blocked,
      };
      memory.set(key, entry);
      if (path) {
        try {
          await mkdir(dataDir!, { recursive: true });
          const temp = `${path}.${process.pid}.tmp`;
          await writeFile(temp, JSON.stringify(entry), { mode: 0o600 });
          await rename(temp, path);
        } catch {
          /* Quota remains available even if the cache cannot be written. */
        }
      }
      return result;
    })();
    pending.set(key, promise);
    try {
      return await promise;
    } finally {
      pending.delete(key);
    }
  };
}
