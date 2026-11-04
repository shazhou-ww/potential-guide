import type { RunContext } from "@potential-guide/task-sdk";

interface CheckInput {
  checks: { name: string; expected: string; actual: string }[];
}
/** Explicit assertion diagnostics; values and environment are deliberately not logged. */
export default async function check(input: CheckInput, context: RunContext) {
  let problemCount = 0;
  for (const [index, item] of input.checks.entries()) {
    const passed = item.actual === item.expected;
    if (!passed) problemCount++;
    await context.log({
      level: passed ? "info" : "warn",
      message: `${item.name}: ${passed ? "通过" : "未通过"}`,
      fields: { index, passed },
    });
  }
  await context.log({
    level: "info",
    message: "逐项检查完成。",
    fields: { checked: input.checks.length, problemCount },
  });
  return { ok: problemCount === 0, problemCount };
}
