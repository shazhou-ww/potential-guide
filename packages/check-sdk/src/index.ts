import type { TaskCallback, TaskContext } from "@potential-guide/task-sdk";
import {
  bundleCid,
  validateBundleReference,
} from "@potential-guide/task-protocol/bundle-reference";
import type { CheckObservation, CheckResult } from "./contracts.js";
import { assertLanguages, assertProblemCodes } from "./definition.js";

export type { CheckObservation, CheckProblem, CheckResult } from "./contracts.js";

export interface CheckDocumentationContext {
  readonly cid: string;
  readonly languages: readonly string[];
}

export function createCheckResult<const Codes extends readonly string[]>(
  codes: Codes,
  problems: readonly CheckObservation<Codes[number]>[],
  context: CheckDocumentationContext,
): CheckResult<Codes[number]> {
  assertProblemCodes(codes);
  assertLanguages(context.languages);
  const cid = bundleCid(validateBundleReference(context.cid));
  const documentation = (suffix: string) =>
    Object.fromEntries(
      context.languages.map((language) => [
        language,
        `ipfs://${cid}/resources/references/${language}/${suffix}.md`,
      ]),
    );
  const allowed = new Set<string>(codes);
  const copy = problems.map((problem) => {
    if (!allowed.has(problem.code))
      throw new Error(`Undeclared Check problem code: ${problem.code}`);
    if (
      typeof problem.target !== "string" ||
      !problem.target.length ||
      [...problem.target].length > 4096 ||
      (problem.actual !== null && typeof problem.actual !== "string") ||
      Object.keys(problem).some((key) => !["target", "code", "actual"].includes(key))
    )
      throw new Error("Invalid Check problem.");
    return {
      target: problem.target,
      code: problem.code,
      actual: problem.actual,
      documentation: documentation(`problems/${problem.code}`),
    };
  });
  return copy.length
    ? { pass: false, documentation: documentation("check"), problems: copy }
    : { pass: true, documentation: documentation("check") };
}

export function createCheckTask<Input, const Codes extends readonly string[]>(
  codes: Codes,
  languages: readonly string[],
  inspect: (
    input: Input,
    context: TaskContext,
  ) => Promise<readonly CheckObservation<Codes[number]>[]>,
): TaskCallback<Input, CheckResult<Codes[number]>> {
  return async (input, context) => {
    context.signal.throwIfAborted();
    const problems = await inspect(input, context);
    context.signal.throwIfAborted();
    return createCheckResult(codes, problems, { cid: context.bundle.cid, languages });
  };
}
