import { isAbsolute, posix } from "node:path";
import { fileURLToPath } from "node:url";
export const here = fileURLToPath(new URL("..", import.meta.url));
export const outputLimit = 262_144;
export const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const nonempty = (value) => typeof value === "string" && value.trim() !== "";
export class Fault extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}
export class Problem extends Error {
  constructor(id, parameters = {}) {
    super(id);
    this.id = id;
    this.parameters = parameters;
  }
}
export const success = () => ({ status: 200, payload: { ok: true, problems: [] }, message: "" });
export const problem = (id, parameters = {}) => ({
  status: 200,
  payload: { ok: false, problems: [{ id, parameters }] },
  message: "",
});
export function subjectValue(value, selfCheck = false) {
  const required = ["workingDirectory", "configPath", "scratchDirectory", "pguide"];
  const optional = ["desiredVersion", "agent", "userHome", "allowSanity", "timeoutMs", "target"];
  const remote = value?.target?.type === "ssh";
  if (selfCheck && (value?.target !== undefined || value?.allowSanity !== undefined))
    throw new Fault("invalid-subject: self-check is local-only and has no allowSanity input.", 400);
  const absolute = remote ? posix.isAbsolute : isAbsolute;
  if (
    !record(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key)) ||
    required.slice(0, 3).some((key) => !nonempty(value[key]) || !absolute(value[key])) ||
    !record(value.pguide) ||
    Object.keys(value.pguide).some((key) => !["command", "args"].includes(key)) ||
    !nonempty(value.pguide.command) ||
    (value.pguide.args !== undefined &&
      (!Array.isArray(value.pguide.args) || !value.pguide.args.every(nonempty))) ||
    ["desiredVersion", "agent"].some((key) => value[key] !== undefined && !nonempty(value[key])) ||
    (value.userHome !== undefined && (!nonempty(value.userHome) || !isAbsolute(value.userHome))) ||
    (remote && value.userHome !== undefined) ||
    (value.target !== undefined &&
      (!record(value.target) ||
        (!remote && (value.target.type !== "local" || Object.keys(value.target).length !== 1)))) ||
    (value.allowSanity !== undefined && typeof value.allowSanity !== "boolean") ||
    (value.timeoutMs !== undefined &&
      (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 100 || value.timeoutMs > 300000))
  )
    throw new Fault("invalid-subject: see the setup subject contract.", 400);
  return { ...value, timeoutMs: value.timeoutMs ?? 20000 };
}
