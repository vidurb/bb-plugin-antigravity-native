import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  experimental_resolveExecutablePath as resolveExecutable,
  providerUsageResultSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import { readCliVersion, run, type Runner } from "./process.ts";

export type UsageResult = z.infer<typeof providerUsageResultSchema>;
const CACHE_MS = 60000;
// Failed reads stay cached only this long so a new sign-in shows up quickly.
const FAILURE_CACHE_MS = 5000;
// Signed out, agy prints this and then waits for an OAuth login indefinitely.
const SIGN_IN_PROMPT = /authentication required/i;
const windowKinds: Record<string, "weekly" | "five-hour"> = {
  weekly: "weekly",
  "5h": "five-hour",
};
const bucketSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  window: z.string().optional(),
  remaining_fraction: z.number().min(0).max(1),
  reset_time: z.iso.datetime({ offset: true }).optional(),
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
  version: z.string().nullable().optional(),
});
export function parseUsage(
  value: unknown,
  observedAt = Date.now(),
): UsageResult {
  const parsed = outputSchema.parse(value);
  if (Object.values(parsed.usage).some((n) => n !== 0))
    throw new Error("Model generation detected during quota lookup.");
  return {
    supported: true,
    usage: {
      status: "ok",
      accountEmail: null,
      planLabel: null,
      observedAt,
      windows: parsed.command.data.groups.flatMap((group) =>
        group.buckets.map((bucket) => ({
          ...(bucket.id ? { id: bucket.id } : {}),
          kind: windowKinds[bucket.window ?? ""] ?? "custom",
          model: group.name,
          // BB shows "N% used" beside the label, so drop the CLI's "Remaining".
          label: `${group.name} · ${bucket.name.replace(/\s+remaining$/i, "")}`,
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
function accountState(
  status: "not_installed" | "unauthenticated" | "expired",
): UsageResult {
  return {
    supported: true,
    usage: { status, accountEmail: null, planLabel: null },
  };
}
function signInFailure(text: string) {
  if (/\b(?:expired|invalid_grant)\b/i.test(text)) return "expired";
  if (
    /authentication required|unauthenticated|not (?:logged|signed) in|please (?:log|sign) in/i.test(
      text,
    )
  )
    return "unauthenticated";
  return null;
}
export function createUsageCollector(
  runner: Runner = run,
  now = Date.now,
  resolve = resolveExecutable,
) {
  const pending = new Map<string, Promise<UsageResult>>();
  const memory = new Map<string, z.infer<typeof cacheSchema>>();
  const isFresh = (entry: { at: number }) =>
    now() >= entry.at && now() - entry.at < CACHE_MS;
  return async function collect(
    command: string,
    dataDir?: string,
    env: Record<string, string> = {},
    refresh = false,
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
      if (cached?.blocked) {
        // A blocked read stays off until the CLI itself changes.
        if (isFresh(cached)) return cached.result;
        const version = await readCliVersion(runner, command, env);
        if (version === null || version === cached.version) {
          memory.set(key, { ...cached, at: now() });
          return cached.result;
        }
      } else if (!refresh && cached && isFresh(cached)) {
        return cached.result;
      }
      let blocked = false,
        version: string | null = null,
        result: UsageResult;
      try {
        if ((await resolve(command)) === null) {
          result = accountState("not_installed");
        } else {
          const response = await runner(
            {
              command,
              args: ["-p", "/usage", "--output-format", "json"],
              env,
            },
            undefined,
            SIGN_IN_PROMPT,
          );
          let raw: unknown;
          let isJson = true;
          try {
            raw = JSON.parse(response.stdout);
          } catch {
            isJson = false;
          }
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
          if (blocked) {
            version = await readCliVersion(runner, command, env);
            result = error(
              "Model generation detected. Automatic quota reads are off until Antigravity CLI is updated.",
            );
          } else {
            const usable = response.code === 0 && isJson;
            const parsed = usable ? tryParseUsage(raw, now()) : null;
            const signIn = signInFailure(response.stdout + response.stderr);
            if (parsed) result = parsed;
            else if (signIn) result = accountState(signIn);
            else throw new Error("Quota command failed.");
          }
        }
      } catch {
        result = error(
          "Could not read native Antigravity quota. Check CLI sign-in and version, then retry.",
        );
      }
      // Failed reads are briefly cached to avoid repeatedly launching the CLI.
      const failed =
        !blocked && result.supported && result.usage.status !== "ok";
      const entry = {
        at: now() - (failed ? CACHE_MS - FAILURE_CACHE_MS : 0),
        result,
        blocked,
        version,
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
function tryParseUsage(raw: unknown, observedAt: number): UsageResult | null {
  try {
    return parseUsage(raw, observedAt);
  } catch {
    return null;
  }
}
