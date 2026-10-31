import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import {
  type Caller,
  canonical,
  compileInputSchema,
  compileJsonSchema,
  type ErrorFact,
  type Json,
  json,
  TaskError,
  type TypeWorkerRegistration,
  validateRunProgress,
} from "@potential-guide/task-protocol";

export interface TypeChannel {
  dispatch?(runId: string, generation: string): Promise<void>;
  progress(runId: string, value: Json): Promise<void>;
  checkpoint?(runId: string, value: Json): Promise<void>;
  complete(runId: string, value: Json): Promise<void>;
  failed(runId: string, error: ErrorFact, result?: Json): Promise<void>;
  confirm(
    runId: string,
    taskId: string,
    messageId: string,
    state: "accepted" | "rejected",
    reason?: string,
  ): Promise<void>;
  released(runId: string): void;
  lost(runIds: readonly string[], error: ErrorFact): void;
}
export interface SupervisorLimits {
  heartbeatMs: number;
  healthMs: number;
  maxInFlight: number;
  maxPayloadBytes: number;
}
/** 跨边界只传静态注册数据，不传宿主生命周期闭包。 */
export class TypeSupervisor {
  private worker: Worker | undefined;
  private generation: string | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  private lastPong = 0;
  private starting: Promise<void> | undefined;
  private closing = false;
  private runs = new Set<string>();
  private routes = new Set<string>();
  private contexts = new Map<
    string,
    { runId: string; scope: string; controller: AbortController }
  >();
  private inFlight = new Set<number>();
  private verifySequence = 0;
  private lastRequestId = 0;
  private verifications = new Map<
    number,
    { resolve(value: Json): void; reject(error: unknown): void }
  >();
  constructor(
    readonly registration: TypeWorkerRegistration,
    private readonly channel: TypeChannel,
    private readonly limits: SupervisorLimits,
  ) {
    compileInputSchema(registration.inputSchema);
    compileJsonSchema(registration.resultSchema);
    compileJsonSchema(registration.messageSchema);
    json(registration.configuration, limits.maxPayloadBytes);
    if (!registration.module.startsWith("file:") || !registration.exportName)
      throw new TaskError("invalid_type", "类型注册需要明确的本地模块和导出。");
    const selected = new URL(registration.module);
    if (
      selected.protocol !== "file:" ||
      (selected.hostname && selected.hostname !== "localhost") ||
      selected.search ||
      selected.hash ||
      selected.username ||
      selected.password
    )
      throw new TaskError("invalid_type", "类型模块必须是无凭据、查询或片段的本地 file URL。");
    const module = realpathSync(fileURLToPath(selected));
    if (!statSync(module).isFile())
      throw new TaskError("invalid_type", "类型模块不是本地普通文件。");
    const digest = createHash("sha256").update(readFileSync(module)).digest("hex");
    if (registration.moduleDigest !== undefined && registration.moduleDigest !== digest)
      throw new TaskError("unsupported_contract", "类型模块内容身份不匹配。");
    this.registration = {
      ...registration,
      module: pathToFileURL(module).href,
      moduleDigest: digest,
    };
  }
  async start(): Promise<void> {
    if (this.closing) throw new TaskError("engine_closed", "类型守护已关闭。");
    if (this.starting) return this.starting;
    if (this.worker) return;
    const generation = randomUUID();
    const worker = new Worker(
      new URL(
        import.meta.url.endsWith(".ts") ? "../dist/type-worker.js" : "./type-worker.js",
        import.meta.url,
      ),
      {
        execArgv: [],
        env: { NODE_OPTIONS: "" },
        resourceLimits: { maxOldGenerationSizeMb: 128 },
        workerData: {
          module: this.registration.module,
          moduleDigest: this.registration.moduleDigest,
          exportName: this.registration.exportName,
          configuration: this.registration.configuration,
          verifyExportName: this.registration.verifyExportName,
          generation,
          maxInFlight: this.limits.maxInFlight,
          maxPayloadBytes: this.limits.maxPayloadBytes,
        },
      },
    );
    this.worker = worker;
    this.generation = generation;
    this.starting = new Promise<void>((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => {
        reject(new TaskError("type_unavailable", "类型守护启动超时。"));
        this.lose(worker, generation, "类型守护启动超时。");
      }, this.limits.healthMs);
      const startupFailure = (error: Error) => {
        clearTimeout(timer);
        if (!ready) reject(error);
        this.lose(worker, generation, error.message);
      };
      worker.on("error", startupFailure);
      worker.on("exit", (code) => startupFailure(new Error(`类型守护退出：${code}`)));
      worker.on("message", (message) => {
        if (!message || typeof message !== "object" || Array.isArray(message)) {
          startupFailure(new Error("类型守护消息不是对象。"));
          return;
        }
        if (
          this.worker !== worker ||
          this.generation !== generation ||
          message.generation !== generation
        )
          return;
        if (message.kind === "ready") {
          if (ready) return startupFailure(new Error("重复类型握手。"));
          try {
            const expected = this.registration;
            if (
              canonical(json(message.value)) !==
              canonical({
                type: expected.type,
                version: expected.version,
                inputSchema: expected.inputSchema,
                resultSchema: expected.resultSchema,
                messageSchema: expected.messageSchema,
              })
            )
              throw new TaskError("unsupported_contract", "隔离类型与宿主注册契约不同。");
            ready = true;
            clearTimeout(timer);
            this.lastPong = performance.now();
            this.heartbeat = setInterval(() => {
              if (performance.now() - this.lastPong > this.limits.healthMs) {
                this.lose(worker, generation, "类型守护健康确认超时，副作用和残留资源未知。");
              } else worker.postMessage({ generation, kind: "ping" });
            }, this.limits.heartbeatMs);
            this.heartbeat.unref();
            resolve();
          } catch (error) {
            startupFailure(error instanceof Error ? error : new Error("类型握手失败。"));
          }
          return;
        }
        if (!ready) return startupFailure(new Error("握手前收到类型运行消息。"));
        if (message.kind === "verified") {
          const operation = this.verifications.get(message.id);
          if (!operation) return;
          this.verifications.delete(message.id);
          if (message.error) operation.reject(new TaskError("invalid_result", message.error));
          else operation.resolve(json(message.value, this.limits.maxPayloadBytes));
          return;
        }
        if (message.kind === "pong") {
          this.lastPong = performance.now();
          return;
        }
        if (message.kind === "released") {
          if (!this.runs.delete(message.runId)) return;
          this.routes.delete(message.runId);
          this.contexts.get(message.runId)?.controller.abort();
          this.contexts.delete(message.runId);
          this.channel.released(message.runId);
          return;
        }
        if (message.kind === "uncertain") {
          if (this.runs.has(message.runId))
            this.channel.lost([message.runId], {
              code: "run_outcome_unknown",
              message: "类型没有获得最终事实持久化确认，不确认清理成功。",
            });
          return;
        }
        void this.receive(worker, generation, message);
      });
    }).finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }
  private async receive(
    worker: Worker,
    generation: string,
    message: Record<string, unknown>,
  ): Promise<void> {
    const id = message.id;
    const runId = message.runId;
    const reply = (error?: string, code = "type_channel_failure") => {
      if (this.worker === worker && this.generation === generation)
        worker.postMessage({
          generation,
          kind: "ack",
          id,
          ...(error ? { error: { code, message: error } } : {}),
        });
    };
    const ordered = Number.isSafeInteger(id) && id === this.lastRequestId + 1;
    if (ordered) this.lastRequestId = id as number;
    if (
      !Number.isSafeInteger(id) ||
      typeof runId !== "string" ||
      !this.runs.has(runId) ||
      !ordered
    ) {
      reply("未知 Run、重复确认身份或旧通道。");
      return;
    }
    if (this.inFlight.size >= this.limits.maxInFlight) {
      reply("类型通道在途容量已满。");
      return;
    }
    this.inFlight.add(id as number);
    try {
      const value = json(message.value, this.limits.maxPayloadBytes);
      switch (message.kind) {
        case "checkpoint":
          if (!this.channel.checkpoint)
            throw new TaskError("invalid_type", "宿主未配置结构化证据通道。");
          await this.channel.checkpoint(
            runId,
            compileJsonSchema(this.registration.resultSchema, {
              maxInputBytes: this.limits.maxPayloadBytes,
            }).validate(value),
          );
          break;
        case "resource": {
          if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value) ||
            typeof value.action !== "string" ||
            !Object.hasOwn(value, "value")
          )
            throw new TaskError("invalid_payload", "资源操作信封无效。");
          const action = this.registration.resources?.[value.action];
          const context = this.contexts.get(runId);
          if (!action || !context) throw new TaskError("forbidden", "宿主未授予此资源动作。");
          if (!this.registration.cleanupActions?.includes(value.action))
            context.controller.signal.throwIfAborted();
          const result = json(
            await action(value.value!, {
              runId,
              scope: context.scope,
              signal: context.controller.signal,
            }),
            96 * 1024 * 1024,
          );
          if (this.worker === worker && this.generation === generation)
            worker.postMessage({ generation, kind: "ack", id, value: result });
          return;
        }
        case "progress":
          await this.channel.progress(
            runId,
            validateRunProgress(value, this.limits.maxPayloadBytes),
          );
          break;
        case "complete":
          await this.channel.complete(
            runId,
            compileJsonSchema(this.registration.resultSchema, {
              maxInputBytes: this.limits.maxPayloadBytes,
            }).validate(value),
          );
          break;
        case "failed": {
          if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value) ||
            typeof value.code !== "string" ||
            typeof value.message !== "string"
          )
            throw new TaskError("invalid_payload", "类型错误事实无效。");
          await this.channel.failed(
            runId,
            { code: value.code, message: value.message },
            value.result === undefined
              ? undefined
              : compileJsonSchema(this.registration.resultSchema, {
                  maxInputBytes: this.limits.maxPayloadBytes,
                }).validate(value.result),
          );
          break;
        }
        case "message-confirm": {
          if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value) ||
            typeof value.messageId !== "string" ||
            typeof value.taskId !== "string" ||
            !["accepted", "rejected"].includes(value.state as string) ||
            (value.reason !== undefined && typeof value.reason !== "string")
          )
            throw new TaskError("invalid_payload", "消息确认无效。");
          await this.channel.confirm(
            runId,
            value.taskId,
            value.messageId,
            value.state as "accepted" | "rejected",
            value.reason as string | undefined,
          );
          break;
        }
        default:
          throw new TaskError("invalid_payload", "未知类型通道操作。");
      }
      reply();
    } catch (error) {
      reply(
        error instanceof Error ? error.message : "类型通道操作失败。",
        error instanceof TaskError ? error.code : "type_channel_failure",
      );
    } finally {
      this.inFlight.delete(id as number);
    }
  }
  async run(runId: string, input: Json, scope: string): Promise<void> {
    if (!runId || typeof runId !== "string" || !scope || typeof scope !== "string")
      throw new TaskError("invalid_tracking", "Run 身份与可信 scope 必须明确。");
    const parsed = compileInputSchema(this.registration.inputSchema, {
      maxInputBytes: this.limits.maxPayloadBytes,
    }).validate(input);
    await this.start();
    if (this.runs.has(runId)) throw new TaskError("invalid_tracking", "重复 Run 身份。");
    this.runs.add(runId);
    this.contexts.set(runId, { runId, scope, controller: new AbortController() });
    try {
      await this.channel.dispatch?.(runId, this.generation!);
    } catch (error) {
      this.runs.delete(runId);
      this.contexts.delete(runId);
      throw error;
    }
    this.worker!.postMessage({
      generation: this.generation,
      kind: "run",
      runId,
      scope,
      input: parsed,
    });
    this.routes.add(runId);
  }
  async verify(value: Json, mode = "historical"): Promise<void> {
    await this.start();
    if (this.verifications.size >= this.limits.maxInFlight)
      throw new TaskError("capacity_exceeded", "历史复验在途容量已满。");
    const id = ++this.verifySequence;
    const verified = await new Promise<Json>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.verifications.delete(id);
        reject(new TaskError("type_unavailable", "历史业务复验超时。"));
      }, this.limits.healthMs);
      this.verifications.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.worker!.postMessage({ generation: this.generation, kind: "verify", id, value, mode });
    });
    if (canonical(verified) !== canonical(value))
      throw new TaskError("invalid_type", "历史业务复验不得改写 Result。");
  }
  cancel(runId: string): void {
    this.contexts.get(runId)?.controller.abort();
    if (this.runs.has(runId))
      this.worker?.postMessage({ generation: this.generation, kind: "cancel", runId });
  }
  withdraw(runId: string, taskId: string, reason: string): void {
    if (this.runs.has(runId))
      this.worker?.postMessage({
        generation: this.generation,
        kind: "withdraw",
        runId,
        taskId,
        reason,
      });
  }
  message(
    runId: string,
    value: { messageId: string; taskId: string; caller: Caller; payload: Json },
  ): void {
    if (!this.worker || !this.routes.has(runId))
      throw new TaskError("no_run_route", "Task 没有当前 Run 路由。");
    compileJsonSchema(this.registration.messageSchema).validate(value.payload);
    const context = this.contexts.get(runId);
    if (!context || value.caller.scope !== context.scope || !value.caller.subject)
      throw new TaskError("forbidden", "消息 Caller 必须保留当前 Run 的可信 scope。");
    this.worker.postMessage({
      generation: this.generation,
      kind: "message",
      runId,
      value: {
        messageId: value.messageId,
        taskId: value.taskId,
        caller: { scope: value.caller.scope, subject: value.caller.subject },
        payload: json(value.payload, this.limits.maxPayloadBytes),
      },
    });
  }
  private lose(worker: Worker, generation: string, message: string): void {
    if (this.worker !== worker || this.generation !== generation) return;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.worker = undefined;
    this.generation = undefined;
    const runIds = [...this.runs];
    this.runs.clear();
    this.routes.clear();
    for (const context of this.contexts.values()) context.controller.abort();
    this.contexts.clear();
    this.inFlight.clear();
    this.lastRequestId = 0;
    for (const operation of this.verifications.values())
      operation.reject(new TaskError("type_unavailable", message));
    this.verifications.clear();
    try {
      this.channel.lost(runIds, { code: "type_worker_lost", message });
    } finally {
      void worker.terminate().catch(() => {});
    }
  }
  async close(): Promise<void> {
    this.closing = true;
    const worker = this.worker;
    if (!worker) return;
    for (const runId of this.runs) this.cancel(runId);
    if (this.runs.size) throw new TaskError("reclamation_failed", "类型守护仍有未确认清理的 Run。");
    clearInterval(this.heartbeat);
    this.worker = undefined;
    await worker.terminate();
  }
  canRoute(runId: string): boolean {
    return !!this.worker && this.routes.has(runId);
  }
  async retire(reason = "类型守护退休，原资源与副作用不作清理成功推断。"): Promise<void> {
    const worker = this.worker;
    const generation = this.generation;
    if (!worker || !generation) return;
    this.lose(worker, generation, reason);
    await worker.terminate();
  }
}
