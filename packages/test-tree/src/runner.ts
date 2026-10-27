import { test } from "node:test";
import { type CheckPath, type LoadedTree, paths, skipReason } from "./model.js";

export type After = () => void | Promise<void>;
export type Transition<C> = (context: C) => After | Promise<After>;
export type Probe<C> = (context: C) => void | Promise<void>;
export type Bindings = Record<string, unknown>;

export function validateBindings(loaded: LoadedTree, binding: Bindings): void {
  const errors: string[] = [];
  const visit = (state: LoadedTree["tree"]["state"]) => {
    const symbol = `transition_${state.id}`;
    if (typeof binding[symbol] !== "function")
      errors.push(`state ${state.id}: expected function ${symbol} in ${loaded.bindingFile}`);
    for (const check of state.checks) {
      const symbol = `check_${state.id}_${check.id}`;
      if (typeof binding[symbol] !== "function")
        errors.push(
          `state ${state.id}, check ${check.id}: expected function ${symbol} in ${loaded.bindingFile}`,
        );
    }
    state.states.forEach(visit);
  };
  visit(loaded.tree.state);
  if (errors.length) throw new Error(errors.join("\n"));
}
export async function executePath<C>(
  path: CheckPath,
  binding: Bindings,
  context: C,
): Promise<void> {
  const afters: After[] = [];
  const errors: unknown[] = [];
  try {
    for (const state of path.states) {
      const symbol = `transition_${state.id}`;
      const after = await (binding[symbol] as Transition<C>)(context);
      if (typeof after !== "function")
        throw new Error(`state ${state.id}: ${symbol} must return an after function`);
      afters.push(after);
    }
    const symbol = `check_${path.states.at(-1)?.id}_${path.check.id}`;
    await (binding[symbol] as Probe<C>)(context);
  } catch (error) {
    errors.push(error);
  } finally {
    for (const after of afters.reverse()) {
      try {
        await after();
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length)
    throw new AggregateError(errors, `Path ${path.id}: execution and/or cleanup failed`);
}
export async function registerTests<C>(
  loaded: LoadedTree,
  createContext: () => C,
  loadBinding: (bindingFile: string) => Promise<Bindings>,
): Promise<void> {
  const binding = await loadBinding(loaded.bindingFile);
  validateBindings(loaded, binding);
  for (const path of paths(loaded.tree)) {
    test(
      `${loaded.tree.namespace}/${path.id}: ${path.check.title}`,
      { skip: skipReason(path) ?? false },
      () => executePath(path, binding, createContext()),
    );
  }
}
