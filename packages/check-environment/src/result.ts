export interface CheckContext {
  signal?: AbortSignal;
}

export interface CheckItem {
  target: string;
  ok: boolean;
  code: string;
  actual: string | null;
}

export interface CheckProblem {
  target: string;
  code: string;
  actual: string | null;
}

export type CheckResult = { pass: true } | { pass: false; problems: CheckProblem[] };

export function result(checks: CheckItem[]): CheckResult {
  const problems = checks
    .filter((check) => !check.ok)
    .map(({ target, code, actual }) => ({ target, code, actual }));
  return problems.length ? { pass: false, problems } : { pass: true };
}

export function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

export function timeoutValue(value: number | undefined): number {
  const timeout = value ?? 5000;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 300000)
    throw new Error("checkTimeoutMs must be an integer between 100 and 300000.");
  return timeout;
}
