import type { TaskCallback, TaskContext } from "@potential-guide/task-sdk";
import type { CheckProblem, CheckResult } from "./contracts.js";
import { assertProblemCodes } from "./definition.js";

export type { CheckProblem, CheckResult } from "./contracts.js";

export function createCheckResult<const Codes extends readonly string[]>(
  codes: Codes,
  problems: readonly CheckProblem<Codes[number]>[],
): CheckResult<Codes[number]> {
  assertProblemCodes(codes);
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
    return { target: problem.target, code: problem.code, actual: problem.actual };
  });
  return copy.length ? { pass: false, problems: copy } : { pass: true };
}

export function createCheckTask<Input, const Codes extends readonly string[]>(
  codes: Codes,
  inspect: (input: Input, context: TaskContext) => Promise<readonly CheckProblem<Codes[number]>[]>,
): TaskCallback<Input, CheckResult<Codes[number]>> {
  return async (input, context) => {
    context.signal.throwIfAborted();
    const problems = await inspect(input, context);
    context.signal.throwIfAborted();
    return createCheckResult(codes, problems);
  };
}
