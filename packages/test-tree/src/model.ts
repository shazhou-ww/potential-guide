import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { parseDocument } from "yaml";

export type Instructions = string | { posix: string; powershell: string };
export interface Check {
  id: string;
  title: string;
  doc: Instructions;
}
export interface State {
  id: string;
  title: string;
  before: Instructions;
  after: Instructions;
  platforms?: string[];
  checks: Check[];
  states: State[];
}
export interface Tree {
  namespace: string;
  binding: string;
  state: State;
}
export interface LoadedTree {
  file: string;
  bindingFile: string;
  tree: Tree;
}
export interface CheckPath {
  id: string;
  states: State[];
  check: Check;
}
const identifier = /^[A-Za-z][A-Za-z0-9]*$/;
const platforms = new Set([
  "aix",
  "android",
  "darwin",
  "freebsd",
  "haiku",
  "linux",
  "openbsd",
  "sunos",
  "win32",
]);
function object(value: unknown, path: string, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path}: expected an object`);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record))
    if (!keys.includes(key)) throw new Error(`${path}.${key}: unknown field`);
  return record;
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${path}: expected non-empty text`);
  return value;
}
function instructions(value: unknown, path: string): Instructions {
  if (typeof value === "string") return text(value, path);
  const record = object(value, path, ["posix", "powershell"]);
  return {
    posix: text(record.posix, `${path}.posix`),
    powershell: text(record.powershell, `${path}.powershell`),
  };
}
function id(value: unknown, path: string): string {
  const result = text(value, path);
  if (!identifier.test(result))
    throw new Error(`${path}: expected ASCII letter then alphanumerics`);
  return result;
}
function list(value: unknown, path: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${path}: expected an array`);
  return value;
}
export function parseTree(source: string): Tree {
  const document = parseDocument(source, { uniqueKeys: true });
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length) throw new Error(diagnostics.map((e) => e.message).join("\n"));
  const root = object(document.toJS({ maxAliasCount: 0 }), "tree", [
    "namespace",
    "binding",
    "state",
  ]);
  const seen = new Set<string>();
  const state = (value: unknown, path: string): State => {
    const r = object(value, path, [
      "id",
      "title",
      "before",
      "after",
      "platforms",
      "checks",
      "states",
    ]);
    const name = id(r.id, `${path}.id`);
    if (seen.has(name)) throw new Error(`${path}.id: duplicate state ${name}`);
    seen.add(name);
    const checks = new Set<string>();
    const result: State = {
      id: name,
      title: text(r.title, `${path}.title`),
      before: instructions(r.before, `${path}.before`),
      after: instructions(r.after, `${path}.after`),
      checks: list(r.checks, `${path}.checks`).map((value, index) => {
        const p = `${path}.checks[${index}]`;
        const check = object(value, p, ["id", "title", "doc"]);
        const name = id(check.id, `${p}.id`);
        if (checks.has(name)) throw new Error(`${p}.id: duplicate check ${name}`);
        checks.add(name);
        return {
          id: name,
          title: text(check.title, `${p}.title`),
          doc: instructions(check.doc, `${p}.doc`),
        };
      }),
      states: list(r.states, `${path}.states`).map((v, i) => state(v, `${path}.states[${i}]`)),
    };
    if (r.platforms !== undefined) {
      const values = list(r.platforms, `${path}.platforms`);
      if (!values.length || values.some((v) => typeof v !== "string" || !platforms.has(v)))
        throw new Error(`${path}.platforms: expected non-empty Node platform names`);
      result.platforms = values as string[];
    }
    return result;
  };
  const binding = text(root.binding, "tree.binding");
  if (isAbsolute(binding) || !binding.endsWith(".ts") || /[:?#\0]/.test(binding))
    throw new Error("tree.binding: expected a relative TS file path");
  const tree = {
    namespace: text(root.namespace, "tree.namespace"),
    binding,
    state: state(root.state, "state"),
  };
  if (!paths(tree).length) throw new Error("tree: at least one check is required");
  return tree;
}
export async function loadTree(file: string): Promise<LoadedTree> {
  const absolute = resolve(file);
  try {
    const tree = parseTree(await readFile(absolute, "utf8"));
    return { file: absolute, bindingFile: resolve(dirname(absolute), tree.binding), tree };
  } catch (cause) {
    throw new Error(`${absolute}: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
  }
}
export function paths(tree: Tree): CheckPath[] {
  const result: CheckPath[] = [];
  const visit = (state: State, ancestors: State[]) => {
    const states = [...ancestors, state];
    for (const check of state.checks) result.push({ id: `${state.id}.${check.id}`, states, check });
    for (const child of state.states) visit(child, states);
  };
  visit(tree.state, []);
  return result;
}
export function skipReason(
  path: CheckPath,
  platform: string = process.platform,
): string | undefined {
  const state = path.states.find((s) => s.platforms && !s.platforms.includes(platform));
  return state
    ? `${state.id}: requires ${state.platforms?.join(", ")}; current ${platform}`
    : undefined;
}
