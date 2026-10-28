import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { finiteJson, jsonObject, type ArtifactPage } from "@potential-guide/check-artifacts";
import type { ContractMetadata } from "./contract-store.js";
import {
  type ServiceEvent,
  type ServiceSnapshot,
  type TaskOptions,
  serviceTerminal,
} from "./task-service.js";
import { TaskProtocolError } from "./v2-types.js";

export interface ServiceAddress {
  endpoint: string;
  token: string;
}
type Subscriber<R, P, E> = {
  ids: Set<string>;
  queue: Map<string, ServiceEvent<R, P, E>>;
  revisions: Map<string, number>;
  wake?: () => void;
  error?: Error;
};
export class ServiceTask<R, P, E> {
  constructor(
    readonly taskId: string,
    private readonly client: TaskHttpClient<TaskOptions, R, P, E>,
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
      if (state.state === "completed") {
        if (
          !state.artifact ||
          !state.executionId ||
          !state.executionStartedAt ||
          !state.executionCompletedAt ||
          state.result === undefined ||
          state.evidence === undefined
        )
          throw new Error("Incomplete observation evidence.");
        return state as ServiceSnapshot<R, P, E> & { result: R; evidence: E; state: "completed" };
      }
      if (serviceTerminal(state))
        throw new TaskProtocolError(
          409,
          state.error ?? {
            code: "task_failed",
            stage: "observe",
            message: "Task did not complete.",
          },
        );
    }
    throw new Error("Task stream closed.");
  }
}
export class TaskHttpClient<Q extends TaskOptions, R, P, E> {
  private readonly subscribers = new Set<Subscriber<R, P, E>>();
  private readonly instances = new Map<string, string>();
  private connection: AbortController | undefined;
  private closed = false;
  private pumping = false;
  private changed = 0;
  constructor(
    readonly address: ServiceAddress,
    readonly prefix: string,
    readonly taskPath: "check-tasks" | "probe-tasks",
  ) {
    const url = new URL(address.endpoint);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Expected authenticated loopback Host.");
  }
  private async rpc(path: string, init: RequestInit = {}) {
    if (this.closed) throw new Error("Client closed.");
    const response = await fetch(`${this.address.endpoint}${this.prefix}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.address.token}`, ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const body: unknown = await response.json();
      const error = jsonObject(body) && jsonObject(body.error) ? body.error : undefined;
      throw new TaskProtocolError(
        response.status,
        error &&
          typeof error.code === "string" &&
          typeof error.stage === "string" &&
          typeof error.message === "string"
          ? { code: error.code, stage: error.stage, message: error.message }
          : { code: "http_error", stage: "schedule", message: "Host request failed." },
      );
    }
    return response;
  }
  private parse(value: unknown): ServiceSnapshot<R, P, E> {
    if (
      !jsonObject(value) ||
      typeof value.taskId !== "string" ||
      typeof value.hostInstance !== "string" ||
      !Number.isSafeInteger(value.revision) ||
      typeof value.acceptedAt !== "string" ||
      !["accepted", "preparing", "waiting", "running", "completed", "failed", "cancelled"].includes(
        String(value.state),
      ) ||
      !["started-after-request", "completed-after-request"].includes(String(value.freshness))
    )
      throw new Error("Invalid Task snapshot.");
    const instance = this.instances.get(value.taskId);
    if (instance && instance !== value.hostInstance)
      throw new TaskProtocolError(409, {
        code: "host_restarted",
        stage: "schedule",
        message: "Task Host instance changed.",
      });
    this.instances.set(value.taskId, value.hostInstance);
    return value as unknown as ServiceSnapshot<R, P, E>;
  }
  protected async create(request: Q, options: { idempotencyKey?: string } = {}) {
    if (!finiteJson(request)) throw new TypeError("Expected finite plain JSON without getters.");
    const body = JSON.stringify(request);
    const key = options.idempotencyKey ?? randomUUID();
    const send = () =>
      this.rpc(`/${this.taskPath}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body,
      });
    let response: Response;
    try {
      response = await send();
    } catch (error) {
      if (error instanceof TaskProtocolError) throw error;
      response = await send();
    }
    return this.parse(await response.json()).taskId;
  }
  async taskSnapshot(id: string) {
    return this.parse(await (await this.rpc(`/${this.taskPath}/${encodeURIComponent(id)}`)).json());
  }
  async cancelTask(id: string) {
    return this.parse(
      await (
        await this.rpc(`/${this.taskPath}/${encodeURIComponent(id)}/cancel`, { method: "POST" })
      ).json(),
    );
  }
  async resolveArtifact(url: string): Promise<ContractMetadata> {
    if (typeof url !== "string") throw new Error("Expected artifact URL.");
    return (
      await this.rpc("/artifacts/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      })
    ).json() as Promise<ContractMetadata>;
  }
  async artifact(digest: string): Promise<ContractMetadata> {
    return (
      await this.rpc(`/artifacts/${encodeURIComponent(digest)}`)
    ).json() as Promise<ContractMetadata>;
  }
  async reference(
    digest: string,
    id: string,
    options: { language?: string } = {},
  ): Promise<ArtifactPage> {
    const query = options.language ? `?${new URLSearchParams({ language: options.language })}` : "";
    return (
      await this.rpc(
        `/artifacts/${encodeURIComponent(digest)}/references/${encodeURIComponent(id)}${query}`,
      )
    ).json() as Promise<ArtifactPage>;
  }
  async *watchTasks(
    tasks: readonly ({ taskId: string } | string)[],
    options: { signal?: AbortSignal } = {},
  ) {
    if (this.closed) throw new Error("Client closed.");
    options.signal?.throwIfAborted();
    const ids = new Set(tasks.map((task) => (typeof task === "string" ? task : task.taskId)));
    const union = new Set([...this.subscribers].flatMap((sub) => [...sub.ids]).concat([...ids]));
    if (!ids.size || union.size > 64) throw new Error("Task filter must contain 1..64 Tasks.");
    const sub: Subscriber<R, P, E> = { ids, queue: new Map(), revisions: new Map() };
    const wake = () => sub.wake?.();
    options.signal?.addEventListener("abort", wake, { once: true });
    this.subscribers.add(sub);
    this.reconnect();
    try {
      for (;;) {
        options.signal?.throwIfAborted();
        if (sub.error) throw sub.error;
        const event = sub.queue.values().next().value;
        if (event) {
          sub.queue.delete(event.taskId);
          yield event;
          continue;
        }
        await new Promise<void>((resolve) => {
          sub.wake = resolve;
        });
        delete sub.wake;
      }
    } finally {
      options.signal?.removeEventListener("abort", wake);
      this.subscribers.delete(sub);
      this.reconnect();
    }
  }
  private reconnect() {
    this.changed++;
    this.connection?.abort();
    if (!this.pumping && this.subscribers.size && !this.closed) {
      this.pumping = true;
      void this.pump().finally(() => {
        this.pumping = false;
        if (
          this.subscribers.size &&
          !this.closed &&
          [...this.subscribers].some((sub) => !sub.error)
        )
          this.reconnect();
      });
    }
  }
  private broadcast(event: ServiceEvent<R, P, E>) {
    for (const sub of this.subscribers) {
      if (
        !sub.ids.has(event.taskId) ||
        (sub.revisions.get(event.taskId) ?? -1) >= event.snapshot.revision
      )
        continue;
      sub.revisions.set(event.taskId, event.snapshot.revision);
      sub.queue.set(event.taskId, event);
      sub.wake?.();
    }
  }
  private async pump() {
    let failures = 0;
    while (this.subscribers.size && !this.closed) {
      const version = this.changed;
      const ids = new Set([...this.subscribers].flatMap((sub) => [...sub.ids]));
      const controller = new AbortController();
      this.connection = controller;
      try {
        const query = new URLSearchParams();
        for (const id of ids) query.append("taskId", id);
        const response = await this.rpc(`/events?${query}`, {
          signal: controller.signal,
          headers: { accept: "text/event-stream" },
        });
        if (!response.body) throw new Error("Missing Task stream.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let buffer = "";
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            if (buffer.length > 8 * 1024 * 1024) throw new Error("Task frame exceeds bounds.");
            let end = buffer.indexOf("\n\n");
            while (end >= 0) {
              const frame = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              const line = frame.split("\n").find((line) => line.startsWith("data: "));
              if (line) {
                const raw: unknown = JSON.parse(line.slice(6));
                if (!jsonObject(raw) || typeof raw.taskId !== "string")
                  throw new Error("Invalid event.");
                const snapshot = this.parse(raw.snapshot);
                if (raw.taskId !== snapshot.taskId || !ids.has(raw.taskId))
                  throw new Error("Unexpected Task event.");
                this.broadcast({ taskId: raw.taskId, snapshot });
                failures = 0;
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
      if (version === this.changed && !this.closed) {
        if (++failures >= 5) {
          for (const sub of this.subscribers) {
            sub.error = new Error("Task stream unavailable.");
            sub.wake?.();
          }
          return;
        }
        await delay(50);
      }
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
