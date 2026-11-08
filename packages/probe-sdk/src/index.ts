import { createCheckResult } from "@potential-guide/check-sdk";
import { createCheckResultSchema } from "@potential-guide/check-sdk/contracts";
import { canonical, json } from "@potential-guide/task-protocol";
import type { TaskCallback, TaskContext } from "@potential-guide/task-sdk";
import { Value } from "@sinclair/typebox/value";
import { mapInput, type ProbeDefinitions, readCheckDefinition, readObjective } from "./model.js";

export type { ProbeDefinitions } from "./model.js";

export interface CheckInvocation {
  parentCid: string;
  path: string;
  cid: string;
  input: unknown;
}
export type CheckInvoker = (request: CheckInvocation, context: TaskContext) => Promise<unknown>;
export interface ProbeResult {
  objective: string;
  documentation: Record<string, string>;
  currentLevel: { id: string; documentation: Record<string, string> };
  checks: {
    id: string;
    documentation: Record<string, string>;
    problems: {
      target: string;
      code: string;
      actual: string | null;
      documentation: Record<string, string>;
    }[];
  }[];
}
async function readJson(context: TaskContext, path: string): Promise<unknown> {
  const reader = context.bundle.read(path, { signal: context.signal }).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let failed = false;
  let primary: unknown;
  let value: unknown;
  const failures: unknown[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 1_048_576) throw new Error("Probe metadata budget exceeded.");
      chunks.push(value);
    }
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    ) as unknown;
  } catch (error) {
    failed = true;
    primary = error;
  } finally {
    try {
      await reader.cancel();
    } catch (error) {
      failures.push(error);
    }
    try {
      reader.releaseLock();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) {
    if (failed)
      throw new AggregateError(
        [primary, ...failures],
        `Probe metadata read and cleanup failed: ${primary instanceof Error ? primary.message.slice(0, 200) : "non-Error failure"}`,
        { cause: primary },
      );
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(failures, "Probe metadata cleanup failed.");
  }
  if (failed) throw primary;
  return value;
}
const same = (a: unknown, b: unknown) => canonical(json(a)) === canonical(json(b));

/** Execute ordered goals, never rewrite child facts or fetch Markdown during assembly. */
export function createProbeTask<Input>(
  definitions: ProbeDefinitions,
  invoke?: CheckInvoker,
): TaskCallback<Input, ProbeResult> {
  return async (input, context) => {
    context.signal.throwIfAborted();
    const objective = readObjective(await readJson(context, "resources/objective.json"));
    if (
      !same(definitions.languages, objective.languages) ||
      !same(definitions.levels, objective.levels)
    )
      throw new Error("Probe definitions differ from its Objective.");
    const children = Object.fromEntries(
      await Promise.all(
        Object.entries(objective.bundles).map(
          async ([name, bundle]) =>
            [
              name,
              readCheckDefinition(await readJson(context, `${bundle.path}/resources/check.json`)),
            ] as const,
        ),
      ),
    );
    if (
      !same(
        definitions.problemCodes,
        Object.fromEntries(
          Object.entries(objective.checks).map(([ref, check]) => [
            ref,
            children[check.bundle]!.problemCodes,
          ]),
        ),
      )
    )
      throw new Error("Probe problem definitions differ from its Checks.");
    const uri = (root: string, path: string | undefined) => {
      if (!path) throw new Error("Missing effective documentation.");
      return `ipfs://${root}/${path}`;
    };
    const documentation = (get: (language: string) => string) =>
      Object.fromEntries(objective.languages.map((language) => [language, get(language)]));
    const result = (id: string, checks: ProbeResult["checks"]): ProbeResult => ({
      objective: context.bundle.cid,
      documentation: documentation((language) =>
        uri(context.bundle.cid, objective.references[language]!.objective),
      ),
      currentLevel: {
        id,
        documentation: documentation((language) =>
          uri(context.bundle.cid, objective.references[language]!.levels[id]),
        ),
      },
      checks,
    });
    for (const level of objective.levels) {
      const failures: ProbeResult["checks"] = [];
      for (const ref of level.checks) {
        context.signal.throwIfAborted();
        const check = objective.checks[ref]!;
        const bundle = objective.bundles[check.bundle]!;
        const child = children[check.bundle]!;
        const mapped = mapInput(input, check.inputMapping);
        const observed = invoke
          ? await invoke(
              {
                parentCid: context.bundle.cid,
                path: bundle.path,
                cid: bundle.cid,
                input: mapped,
              },
              context,
            )
          : await context.invokeTask({
              key: `check:${ref}`,
              path: bundle.path,
              cid: bundle.cid,
              input: json(mapped),
              timeoutMs: 30_000,
            });
        context.signal.throwIfAborted();
        if (!Value.Check(createCheckResultSchema(child.problemCodes, child.languages), observed))
          throw new Error("Invalid child Check result.");
        const expected = createCheckResult(
          child.problemCodes,
          observed.pass
            ? []
            : observed.problems.map(({ target, code, actual }) => ({ target, code, actual })),
          {
            cid: bundle.cid,
            languages: child.languages,
          },
        );
        if (!same(observed, expected))
          throw new Error("Invalid child Check facts or execution identity.");
        if (observed.pass) continue;
        const effective = (code?: string) =>
          documentation((language) => {
            const own = objective.references[language]!.checks[ref];
            const override = code === undefined ? own?.check : own?.problems[code];
            const inherited = child.references[language];
            return override
              ? uri(context.bundle.cid, override)
              : uri(bundle.cid, code === undefined ? inherited?.check : inherited?.problems[code]);
          });
        failures.push({
          id: ref,
          documentation: effective(),
          problems: observed.problems.map(({ target, code, actual }) => ({
            target,
            code,
            actual,
            documentation: effective(code),
          })),
        });
      }
      if (failures.length) return result(level.id, failures);
    }
    return result("terminal", []);
  };
}
