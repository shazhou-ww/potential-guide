import { problemCodes } from "../dist/definitions/tools.js";
import { executeCommand } from "./command.js";
import { type CheckContext, type CheckItem, problems, result, timeoutValue } from "./result.js";

export interface ToolInput {
  tools: { command: string; args: string[]; minimumVersion: string }[];
  checkTimeoutMs?: number;
}

export function parseToolVersion(output: string): string | undefined {
  return /(?:^|\s)v?(\d+\.\d+(?:\.\d+)*)(?:\b|$)/m.exec(output)?.[1];
}

export function compareVersions(actual: string, expected: string): number {
  if (![actual, expected].every((value) => /^\d+(?:\.\d+)*$/.test(value)))
    throw new Error("Versions must contain only dot-separated decimal numbers.");
  const a = actual.split(".").map((part) => part.replace(/^0+(?=\d)/, ""));
  const b = expected.split(".").map((part) => part.replace(/^0+(?=\d)/, ""));
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const first = a[i] ?? "0";
    const second = b[i] ?? "0";
    if (first.length !== second.length) return Math.sign(first.length - second.length);
    if (first !== second) return first > second ? 1 : -1;
  }
  return 0;
}

export async function inspectTools(input: ToolInput, context: CheckContext = {}) {
  if (!input.tools.length || input.tools.length > 100)
    throw new Error("Specify between 1 and 100 tools.");
  const timeout = timeoutValue(input.checkTimeoutMs);
  for (const tool of input.tools) compareVersions(tool.minimumVersion, tool.minimumVersion);
  const checks: CheckItem<(typeof problemCodes)[number]>[] = [];
  for (const tool of input.tools) {
    const output = await executeCommand(tool.command, tool.args, timeout, context.signal);
    const actual = parseToolVersion(output.stdout + output.stderr);
    const code = output.missing
      ? "tool-missing"
      : output.code !== 0
        ? "tool-unusable"
        : actual === undefined
          ? "version-unparseable"
          : compareVersions(actual, tool.minimumVersion) < 0
            ? "tool-version"
            : "pass";
    checks.push({ target: tool.command, ok: code === "pass", code, actual: actual ?? null });
  }
  return problems(checks);
}

export async function checkTools(input: ToolInput, context: CheckContext = {}) {
  return result(problemCodes, await inspectTools(input, context));
}

export default checkTools;
