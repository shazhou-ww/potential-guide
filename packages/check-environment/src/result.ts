import { createCheckResult } from "@potential-guide/check-sdk";

export type { CheckProblem, CheckResult } from "@potential-guide/check-sdk";

export interface CheckContext {
  signal?: AbortSignal;
}

export interface CheckResultContext extends CheckContext {
  bundle: { readonly cid: string };
}

export interface CheckItem<Code extends string = string> {
  target: string;
  ok: boolean;
  code: Code | "pass";
  actual: string | null;
}

export function problems<Code extends string>(checks: CheckItem<Code>[]) {
  return checks
    .filter((check) => !check.ok)
    .map(({ target, code, actual }) => {
      if (code === "pass") throw new Error("A failing check requires a problem code.");
      return { target, code: code as Code, actual };
    });
}

export const result = createCheckResult;

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
