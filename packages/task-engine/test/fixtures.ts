import assert from "node:assert/strict";
import {
  type Caller,
  canonical,
  fail,
  type Json,
  type JsonObject,
  json,
  object,
  type StartPermit,
  TaskError,
  type TaskType,
} from "@potential-guide/task-protocol";
import { createTaskEngine, type EngineLimits, newId } from "../src/index.js";
import { createExecutorPool } from "../src/pool.js";
import { MemoryStore, VirtualClock } from "../src/testing.js";

export const caller: Caller = { scope: "a", subject: "tester" };
export function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
export async function flush(): Promise<void> {
  for (let index = 0; index < 30; index++) await Promise.resolve();
}
export function validateEcho(value: unknown): JsonObject {
  const input = object(value);
  if (Object.keys(input).sort().join(",") !== "text" || typeof input.text !== "string")
    fail("invalid_request", "echo requires only text.");
  return input;
}
export function echoEquals(input: JsonObject, other: unknown): boolean {
  try {
    return canonical(input) === canonical(validateEcho(other));
  } catch (error) {
    if (error instanceof TaskError && ["invalid_request", "invalid_payload"].includes(error.code))
      return false;
    throw error;
  }
}
export function harness(
  options: {
    limits?: Partial<EngineLimits>;
    resources?: string[];
    prepare?: TaskType<JsonObject>["prepare"];
  } = {},
) {
  const clock = new VirtualClock();
  const store = new MemoryStore();
  const work: {
    permit: StartPermit;
    input: JsonObject;
    done: ReturnType<typeof deferred<unknown>>;
    exit: ReturnType<typeof deferred<void>>;
    stops: string[];
  }[] = [];
  let prepares = 0;
  const pool = createExecutorPool<JsonObject>({
    resources: options.resources ?? ["js", "js"],
    resourceKey: () => "js",
    run(input, permit, context) {
      assert.ok(
        store.read().facts.executions[permit.executionId],
        "startup is durable before business code",
      );
      assert.equal(context.scope, store.read().facts.executions[permit.executionId]?.binding.scope);
      assert.ok(Object.isFrozen(context));
      const done = deferred<unknown>();
      const exit = deferred<void>();
      const stops: string[] = [];
      work.push({ permit, input, done, exit, stops });
      return {
        result: done.promise,
        exited: exit.promise,
        cooperate(reason) {
          stops.push(reason);
          done.reject(new Error(reason));
          exit.resolve();
        },
        async force() {
          throw new Error("Same-thread work has no force capability.");
        },
        async cleanup() {},
      };
    },
  });
  const type: TaskType<JsonObject> = {
    type: "echo",
    version: "1",
    environment: "js-v1",
    validate: validateEcho,
    equals: echoEquals,
    prepare: async (input, options_) => {
      prepares++;
      return options.prepare ? options.prepare(input, options_) : input;
    },
    validatePrepared: json as (value: unknown) => JsonObject,
    validateResult: json,
    validateProgress: json,
    execute: (input, executeOptions) => pool.execute(input, executeOptions),
  };
  const sum: TaskType<JsonObject> = {
    ...type,
    type: "sum",
    validate(value) {
      const input = object(value);
      if (
        Object.keys(input).join(",") !== "values" ||
        !Array.isArray(input.values) ||
        !input.values.every((item) => typeof item === "number")
      )
        fail("invalid_request", "sum requires numeric values.");
      return input;
    },
    equals: (a, b) => canonical(a) === canonical(json(b)),
    async execute(input, options_) {
      return pool.execute(
        { text: String((input.values as number[]).reduce((a, b) => a + b, 0)) },
        options_,
      );
    },
  };
  const engine = createTaskEngine({
    store,
    clock,
    types: [type, sum],
    currentVersions: { echo: "1", sum: "1" },
    authorize: (who) => who.subject === "tester",
    ...(options.limits ? { limits: options.limits } : {}),
  });
  engine.start();
  function submit(extra: JsonObject = {}) {
    return engine.submit(
      { requestId: newId(clock.now()), type: "echo", text: "hello", timeoutMs: 100, ...extra },
      caller,
    );
  }
  async function turn(milliseconds = 1) {
    clock.advance(milliseconds);
    engine.tick();
    await flush();
    engine.tick();
    await flush();
  }
  async function finish(index = 0, result: Json = { text: "hello" }) {
    const item = work[index];
    assert.ok(item);
    item.done.resolve(result);
    item.exit.resolve();
    await flush();
  }
  async function close() {
    await engine.close();
    await pool.close();
    store.close();
  }
  return {
    engine,
    store,
    clock,
    pool,
    type,
    sum,
    work,
    submit,
    turn,
    finish,
    close,
    prepares: () => prepares,
  };
}
