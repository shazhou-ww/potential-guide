import { parentPort, workerData } from "node:worker_threads";
import {
  canonical,
  compileInputSchema,
  compileJsonSchema,
  type Json,
  json,
  type ResolvedTaskBundle,
  type RunContext,
  type RunProgress,
  RunFailure,
  type RunMessage,
  taskSchemaUri,
  TaskError,
  validateRunProgress,
} from "@potential-guide/task-protocol";

export type TaskCallback<Input = Json, Result = Json, Message extends Json = never> = (
  input: Input,
  context: RunContext<Message>,
) => Promise<Result>;
export type { RunContext, RunMessage, RunProgress } from "@potential-guide/task-protocol";
export { RunFailure } from "@potential-guide/task-protocol";

class Inbox implements AsyncIterable<RunMessage<Json>> {
  private queue: RunMessage<Json>[] = [];
  private waiter: ((value: IteratorResult<RunMessage<Json>>) => void) | undefined;
  private closed = false;
  constructor(private readonly capacity: number) {}
  push(value: RunMessage<Json>): void {
    if (this.closed || this.queue.length >= this.capacity)
      throw new Error("Task inbox unavailable.");
    if (this.waiter) {
      this.waiter({ done: false, value });
      this.waiter = undefined;
    } else this.queue.push(value);
  }
  close(): void {
    this.closed = true;
    this.queue = [];
    this.waiter?.({ done: true, value: undefined });
    this.waiter = undefined;
  }
  [Symbol.asyncIterator](): AsyncIterator<RunMessage<Json>> {
    return {
      next: () => {
        const value = this.queue.shift();
        if (value) return Promise.resolve({ done: false, value });
        if (this.closed) return Promise.resolve({ done: true, value: undefined });
        if (this.waiter) return Promise.reject(new Error("Task inbox has one consumer."));
        return new Promise((resolve) => {
          this.waiter = resolve;
        });
      },
    };
  }
}

/** Generated entry supplies the build-locked declaration; authors supply only the callback. */
export function runTask<Input = Json, Result = Json, Message extends Json = never>(
  callback: TaskCallback<Input, Result, Message>,
  declaration: ResolvedTaskBundle,
): void {
  const port = parentPort;
  if (!port || declaration.$schema !== taskSchemaUri) throw new Error("Unsupported Task Worker.");
  const config = workerData as {
    generation: string;
    maxInFlight: number;
    maxPayloadBytes: number;
    bundle: { digest: string; declaration: ResolvedTaskBundle };
  };
  if (
    typeof config.generation !== "string" ||
    !config.generation ||
    !Number.isSafeInteger(config.maxInFlight) ||
    config.maxInFlight <= 0 ||
    !Number.isSafeInteger(config.maxPayloadBytes) ||
    config.maxPayloadBytes <= 0 ||
    !/^sha256:[a-f0-9]{64}$/.test(config.bundle?.digest ?? "")
  )
    throw new Error("Invalid trusted Task Worker configuration.");
  if (
    !config.bundle ||
    canonical(json(config.bundle.declaration, 1_048_576)) !==
      canonical(json(declaration, 1_048_576))
  )
    throw new Error("Task Worker declaration differs from verified Bundle.");
  const schemaLimits = { maxInputBytes: config.maxPayloadBytes };
  const input = compileInputSchema<Input>(declaration.inputSchema, schemaLimits);
  const result = compileJsonSchema(declaration.resultSchema, schemaLimits);
  const messages = compileJsonSchema(declaration.messageSchema, schemaLimits);
  const controller = new AbortController();
  const inbox = new Inbox(config.maxInFlight);
  const tasks = new Map<string, AbortController>();
  const pending = new Map<number, { resolve(): void; reject(error: Error): void }>();
  let sequence = 0;
  let runId: string | undefined;
  let finishing = false;
  let queued = 0;
  let cleanupUncertain = false;
  let output = Promise.resolve();
  function request(kind: string, value: unknown): Promise<void> {
    if (pending.size >= config.maxInFlight)
      return Promise.reject(new Error("Task channel capacity exceeded."));
    const id = ++sequence;
    const operation = new Promise<void>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    port!.postMessage({ generation: config.generation, runId, id, kind, value });
    return operation;
  }
  function enqueue(kind: string, value: unknown): Promise<void> {
    if (finishing) return Promise.reject(new TaskError("run_finished", "Task is finishing."));
    const parsed = json(value, config.maxPayloadBytes);
    if (queued >= config.maxInFlight)
      return Promise.reject(new Error("Task channel capacity exceeded."));
    queued++;
    const operation = output
      .then(() => request(kind, parsed))
      .finally(() => {
        queued--;
      });
    output = operation;
    void operation.catch(() => {});
    return operation;
  }
  port.postMessage({
    generation: config.generation,
    kind: "ready",
    value: {
      $schema: declaration.$schema,
      digest: config.bundle.digest,
      inputSchema: declaration.inputSchema,
      resultSchema: declaration.resultSchema,
      messageSchema: declaration.messageSchema,
    },
  });
  port.on("message", (envelope) => {
    if (!envelope || envelope.generation !== config.generation) return;
    if (envelope.kind === "ack") {
      const operation = pending.get(envelope.id);
      if (!operation) return;
      pending.delete(envelope.id);
      if (envelope.error)
        operation.reject(new TaskError(envelope.error.code, envelope.error.message));
      else operation.resolve();
      return;
    }
    if (envelope.kind === "ping") {
      port.postMessage({ generation: config.generation, kind: "pong" });
      return;
    }
    if (envelope.runId !== runId && envelope.kind !== "run") return;
    if (envelope.kind === "cancel") {
      port.postMessage({ generation: config.generation, runId, kind: "stopping" });
      controller.abort();
      inbox.close();
      for (const task of tasks.values()) task.abort();
      return;
    }
    if (envelope.kind === "withdraw") {
      const task = tasks.get(envelope.taskId) ?? new AbortController();
      tasks.set(envelope.taskId, task);
      task.abort();
      return;
    }
    if (envelope.kind === "message") {
      const message = envelope.value;
      const task = tasks.get(message.taskId) ?? new AbortController();
      tasks.set(message.taskId, task);
      let confirmed = false;
      const confirm = (state: string, reason?: string) => {
        if (confirmed || task.signal.aborted)
          return Promise.reject(new Error("Message unavailable."));
        confirmed = true;
        return enqueue("message-confirm", {
          taskId: message.taskId,
          messageId: message.messageId,
          state,
          ...(reason === undefined ? {} : { reason }),
        });
      };
      inbox.push(
        Object.freeze({
          messageId: message.messageId,
          taskId: message.taskId,
          caller: Object.freeze(message.caller),
          signal: task.signal,
          payload: messages.validate(message.payload),
          accept: () => confirm("accepted"),
          reject: (reason: string) => confirm("rejected", reason),
        }),
      );
      return;
    }
    if (envelope.kind !== "run" || runId !== undefined) return;
    runId = envelope.runId;
    const context: RunContext<Json> = Object.freeze({
      runId: envelope.runId,
      ...(envelope.identity
        ? { generation: envelope.identity.generation, startedAt: envelope.identity.startedAt }
        : {}),
      scope: envelope.scope,
      signal: controller.signal,
      messages: inbox,
      progress: (value: RunProgress) =>
        enqueue("progress", validateRunProgress(value, config.maxPayloadBytes)),
      checkpoint: (value: Json) => enqueue("checkpoint", result.validate(value)),
    });
    const reportFailure = async (error: unknown) => {
      cleanupUncertain =
        error instanceof TaskError &&
        ["reclamation_failed", "reclamation_unknown"].includes(error.code);
      let evidence: Json | undefined;
      if (error instanceof RunFailure) {
        try {
          evidence = result.validate(error.result);
        } catch {
          /* Invalid evidence stays local. */
        }
      }
      await request("failed", {
        code: error instanceof TaskError ? error.code.slice(0, 128) : "run_failed",
        message: error instanceof Error ? error.message.slice(0, 512) : "Task callback failed.",
        ...(evidence === undefined ? {} : { result: evidence }),
      });
    };
    void Promise.resolve()
      .then(() => callback(input.validate(envelope.input), context as RunContext<Message>))
      .then(
        async (value) => {
          finishing = true;
          await output;
          let validated: Json;
          try {
            validated = result.validate(value);
          } catch (error) {
            await reportFailure(error);
            return;
          }
          await request("complete", validated);
        },
        async (error) => {
          finishing = true;
          await output.catch(() => {});
          if (
            controller.signal.aborted &&
            (error?.name === "AbortError" || ["ABORT_ERR", "run_canceled"].includes(error?.code))
          )
            return;
          await reportFailure(error);
        },
      )
      .then(
        () => {
          inbox.close();
          controller.abort();
          for (const task of tasks.values()) task.abort();
          port.postMessage({
            generation: config.generation,
            runId,
            kind: cleanupUncertain ? "uncertain" : "released",
          });
          port.close();
        },
        () => {
          inbox.close();
          controller.abort();
          for (const task of tasks.values()) task.abort();
          port.postMessage({ generation: config.generation, runId, kind: "uncertain" });
          port.close();
        },
      );
  });
}
