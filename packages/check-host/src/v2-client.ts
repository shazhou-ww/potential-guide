import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { parseCheckManifest } from "@potential-guide/check-artifacts";
import type { HostAddress } from "./client.js";
import {
  type ArtifactMetadata,
  type CheckRequest,
  type CheckTaskSnapshot,
  type TaskEvent,
  TaskProtocolError,
  taskTerminal,
} from "./v2-types.js";

type Subscriber = {
  ids: Set<string>;
  queue: TaskEvent[];
  revisions: Map<string, number>;
  wake?: () => void;
  error?: Error;
};
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function metadata(value: unknown): ArtifactMetadata {
  if (
    !object(value) ||
    typeof value.digest !== "string" ||
    typeof value.revision !== "string" ||
    typeof value.source !== "string" ||
    typeof value.checkedAt !== "string"
  )
    throw new Error("Invalid artifact metadata.");
  return {
    digest: value.digest,
    revision: value.revision,
    source: value.source,
    checkedAt: value.checkedAt,
    manifest: parseCheckManifest(Buffer.from(JSON.stringify(value.manifest))),
    ...(typeof value.transportDigest === "string"
      ? { transportDigest: value.transportDigest }
      : {}),
  };
}
function snapshot(value: unknown): CheckTaskSnapshot {
  if (
    !object(value) ||
    typeof value.taskId !== "string" ||
    typeof value.hostInstance !== "string" ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    typeof value.acceptedAt !== "string" ||
    (value.freshness !== "started-after-request" &&
      value.freshness !== "completed-after-request") ||
    (value.state !== "accepted" &&
      value.state !== "preparing" &&
      value.state !== "waiting" &&
      value.state !== "running" &&
      value.state !== "completed" &&
      value.state !== "failed" &&
      value.state !== "cancelled")
  )
    throw new Error("Invalid task snapshot.");
  const result = value.result === undefined ? undefined : JSON.parse(JSON.stringify(value.result));
  const error = value.error;
  return {
    taskId: value.taskId,
    hostInstance: value.hostInstance,
    revision: value.revision,
    acceptedAt: value.acceptedAt,
    freshness: value.freshness,
    state: value.state,
    ...(value.artifact ? { artifact: metadata(value.artifact) } : {}),
    ...(typeof value.executionId === "string" ? { executionId: value.executionId } : {}),
    ...(typeof value.executionStartedAt === "string"
      ? { executionStartedAt: value.executionStartedAt }
      : {}),
    ...(typeof value.executionCompletedAt === "string"
      ? { executionCompletedAt: value.executionCompletedAt }
      : {}),
    ...(result !== undefined ? { result } : {}),
    ...(object(error) &&
    typeof error.code === "string" &&
    typeof error.stage === "string" &&
    typeof error.message === "string"
      ? { error: { code: error.code, stage: error.stage, message: error.message } }
      : {}),
  };
}
export class CheckTask {
  constructor(
    readonly taskId: string,
    private readonly client: CheckTaskClient,
  ) {}
  snapshot() {
    return this.client.taskSnapshot(this.taskId);
  }
  events(options: { signal?: AbortSignal } = {}) {
    return this.client.watchTasks([this], options);
  }
  cancel() {
    return this.client.cancelTask(this.taskId);
  }
  async result() {
    for await (const event of this.events()) {
      const state = event.snapshot;
      if (state.state === "completed") return state;
      if (taskTerminal(state))
        throw new TaskProtocolError(
          409,
          state.error ?? {
            code: "task_failed",
            stage: "execute",
            message: "Task did not complete.",
          },
        );
    }
    throw new Error("Task stream closed before result.");
  }
}
export class CheckTaskClient {
  private readonly subscribers = new Set<Subscriber>();
  private connection: AbortController | undefined;
  private pumpRunning = false;
  private changed = 0;
  private closed = false;
  constructor(readonly address: HostAddress) {
    const url = new URL(address.endpoint);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password)
      throw new Error("Check Host must be authenticated loopback HTTP.");
  }
  private async rpc(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.address.endpoint}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.address.token}`, ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const value: unknown = await response.json();
      const error =
        value && typeof value === "object" && "error" in value ? value.error : undefined;
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        "stage" in error &&
        "message" in error &&
        typeof error.code === "string" &&
        typeof error.stage === "string" &&
        typeof error.message === "string"
      )
        throw new TaskProtocolError(response.status, {
          code: error.code,
          stage: error.stage,
          message: error.message,
        });
      throw new TaskProtocolError(response.status, {
        code: "http_error",
        stage: "schedule",
        message: "Host request failed.",
      });
    }
    return response;
  }
  async check(request: CheckRequest, options: { idempotencyKey?: string } = {}) {
    if (this.closed) throw new Error("Client is closed.");
    const key = options.idempotencyKey ?? randomUUID();
    const send = () =>
      this.rpc("/v2/check-tasks", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify(request),
      });
    let response: Response;
    try {
      response = await send();
    } catch (error) {
      if (error instanceof TaskProtocolError) throw error;
      // Only a retry of the same idempotent admission; never generate a second Task.
      response = await send();
    }
    const state = snapshot(await response.json());
    return new CheckTask(state.taskId, this);
  }
  async taskSnapshot(id: string): Promise<CheckTaskSnapshot> {
    return snapshot(await (await this.rpc(`/v2/check-tasks/${encodeURIComponent(id)}`)).json());
  }
  async cancelTask(id: string): Promise<CheckTaskSnapshot> {
    return snapshot(
      await (
        await this.rpc(`/v2/check-tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" })
      ).json(),
    );
  }
  async resolveArtifact(url: string): Promise<ArtifactMetadata> {
    return metadata(
      await (
        await this.rpc("/v2/artifacts/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        })
      ).json(),
    );
  }
  async artifact(digest: string): Promise<ArtifactMetadata> {
    return metadata(await (await this.rpc(`/v2/artifacts/${encodeURIComponent(digest)}`)).json());
  }
  async reference(digest: string, id: string) {
    return (
      await this.rpc(
        `/v2/artifacts/${encodeURIComponent(digest)}/references/${encodeURIComponent(id)}`,
      )
    ).text();
  }
  async *watchTasks(
    tasks: readonly (CheckTask | string)[],
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<TaskEvent> {
    if (this.closed) throw new Error("Client is closed.");
    options.signal?.throwIfAborted();
    const ids = new Set(tasks.map((task) => (typeof task === "string" ? task : task.taskId)));
    const union = new Set([...this.subscribers].flatMap((sub) => [...sub.ids]).concat([...ids]));
    if (!ids.size || union.size > 64) throw new Error("Task filter must contain 1..64 Tasks.");
    const subscriber: Subscriber = { ids, queue: [], revisions: new Map() };
    const abort = () => {
      subscriber.wake?.();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    this.subscribers.add(subscriber);
    this.reconnect();
    try {
      for (;;) {
        options.signal?.throwIfAborted();
        if (subscriber.error) throw subscriber.error;
        const event = subscriber.queue.shift();
        if (event) {
          yield event;
          continue;
        }
        await new Promise<void>((resolve) => {
          subscriber.wake = resolve;
        });
        delete subscriber.wake;
      }
    } finally {
      options.signal?.removeEventListener("abort", abort);
      this.subscribers.delete(subscriber);
      this.reconnect();
    }
  }
  private reconnect() {
    this.changed++;
    this.connection?.abort();
    if (!this.pumpRunning && this.subscribers.size) {
      this.pumpRunning = true;
      void this.pump().finally(() => {
        this.pumpRunning = false;
        if (this.subscribers.size && !this.closed) this.reconnect();
      });
    }
  }
  private broadcast(event: TaskEvent) {
    for (const sub of this.subscribers) {
      if (
        !sub.ids.has(event.taskId) ||
        (sub.revisions.get(event.taskId) ?? -1) >= event.snapshot.revision
      )
        continue;
      sub.revisions.set(event.taskId, event.snapshot.revision);
      if (sub.queue.length >= 64) sub.error = new Error("Task subscriber exceeded bounded queue.");
      else sub.queue.push(event);
      sub.wake?.();
    }
  }
  private async pump() {
    while (this.subscribers.size && !this.closed) {
      const version = this.changed;
      const ids = new Set([...this.subscribers].flatMap((sub) => [...sub.ids]));
      const controller = new AbortController();
      this.connection = controller;
      try {
        const query = new URLSearchParams();
        for (const id of ids) query.append("taskId", id);
        const response = await this.rpc(`/v2/events?${query}`, {
          signal: controller.signal,
          headers: { accept: "text/event-stream" },
        });
        if (!response.body) throw new Error("Task stream unavailable.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const read = await reader.read();
            if (read.done) break;
            buffer += decoder.decode(read.value, { stream: true });
            if (buffer.length > 16 * 1024 * 1024) throw new Error("Task event exceeds bound.");
            let end = buffer.indexOf("\n\n");
            while (end >= 0) {
              const frame = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              const data = frame.split("\n").find((line) => line.startsWith("data: "));
              if (data) {
                const raw: unknown = JSON.parse(data.slice(6));
                if (!object(raw) || typeof raw.taskId !== "string")
                  throw new Error("Invalid task event.");
                const event: TaskEvent = { taskId: raw.taskId, snapshot: snapshot(raw.snapshot) };
                if (
                  !ids.has(event.taskId) ||
                  event.snapshot.taskId !== event.taskId ||
                  !Number.isSafeInteger(event.snapshot.revision)
                )
                  throw new Error("Invalid task event.");
                this.broadcast(event);
              }
              end = buffer.indexOf("\n\n");
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } catch (error) {
        if (!controller.signal.aborted && error instanceof TaskProtocolError) {
          for (const sub of this.subscribers) {
            sub.error = error;
            sub.wake?.();
          }
          return;
        }
      }
      if (version === this.changed && !this.closed) await delay(50);
    }
  }
  close() {
    this.closed = true;
    this.connection?.abort();
    for (const sub of this.subscribers) {
      sub.error = new Error("Client closed.");
      sub.wake?.();
    }
  }
}
