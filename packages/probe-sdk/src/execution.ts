import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { type IpfsClient, openContent } from "@potential-guide/ipfs-content";
import {
  bundleCid,
  type Caller,
  type CancellationResult,
  type JsonObject,
  type SubmissionResult,
  TaskError,
  type TaskRequest,
  type TaskSnapshot,
  validateBundleReference,
} from "@silvermoon-work/task-protocol";
import type { CheckInvoker } from "./index.js";

/** Both the ordinary Engine and TaskClient satisfy this async-compatible public API. */
export interface TaskInvocationService {
  submit(request: TaskRequest, caller: Caller): Promise<SubmissionResult>;
  getRequestStatus(
    id: string,
    options: { waitMs: number },
    caller: Caller,
  ): Promise<SubmissionResult>;
  getTask(id: string, caller: Caller): TaskSnapshot | Promise<TaskSnapshot>;
  cancelTask(id: string, caller: Caller): CancellationResult | Promise<CancellationResult>;
}

export class CheckInvocationCleanupError extends AggregateError {
  constructor(
    readonly requestId: string,
    readonly taskId: string | undefined,
    readonly cleanupConfirmed: boolean,
    readonly cleanupErrorCount: number,
    primary: unknown,
    cleanupErrors: readonly unknown[],
  ) {
    super(
      [primary, ...cleanupErrors],
      `Child invocation ${requestId} failed: ${primary instanceof Error ? primary.message.slice(0, 200) : "non-Error failure"}; cleanup ${cleanupConfirmed ? "confirmed after recovery errors" : "could not be confirmed"} (${cleanupErrorCount} cleanup errors).`,
      { cause: primary },
    );
    this.name = "CheckInvocationCleanupError";
  }
}

function bounded<T>(action: () => T | Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return action();
      })
      .then(
        (value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
  });
}

function validateDecision(decision: SubmissionResult, id: string): SubmissionResult {
  if (
    decision?.requestId !== id ||
    !["accepted", "preparing", "rejected"].includes(decision.status) ||
    (decision.status === "accepted" && !decision.taskId)
  )
    throw new TaskError(
      "invalid_response",
      "Child admission returned an invalid request decision.",
    );
  return decision;
}

async function recoverAndCancel(
  service: TaskInvocationService,
  caller: Caller,
  id: string,
  cid: string,
  taskId: string | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = new TaskError(
    "child_cleanup_timeout",
    `Child cleanup budget exhausted; recover request ${id} before assuming release.`,
  );
  const timer = setTimeout(() => controller.abort(timeout), timeoutMs);
  const errors: unknown[] = [];
  let errorCount = 0;
  const record = (error: unknown) => {
    errorCount++;
    // Keep diagnostics bounded even when a transport rejects synchronously on every retry.
    if (errors.length < 16) errors.push(error);
    else errors[15] = error;
  };
  try {
    while (!controller.signal.aborted) {
      try {
        if (!taskId) {
          const decision = validateDecision(
            await bounded(
              () => service.getRequestStatus(id, { waitMs: Math.min(100, timeoutMs) }, caller),
              controller.signal,
            ),
            id,
          );
          if (decision.status === "rejected")
            return { taskId, confirmed: true, errors, errorCount };
          if (decision.status === "accepted") taskId = decision.taskId;
        }
        if (taskId) {
          const target = taskId;
          const canceled = await bounded(
            () => service.cancelTask(target, caller),
            controller.signal,
          );
          if (
            canceled.taskId !== target ||
            !canceled.bundle ||
            bundleCid(validateBundleReference(canceled.bundle)) !== cid ||
            (!canceled.canceled && !["completed", "failed", "stopped"].includes(canceled.stage))
          )
            throw new TaskError("invalid_response", "Child cancellation was not confirmed.");
          return { taskId, confirmed: true, errors, errorCount };
        }
      } catch (error) {
        record(error);
      }
      if (!controller.signal.aborted) {
        try {
          await delay(25, undefined, { signal: controller.signal });
        } catch (error) {
          record(error);
        }
      }
    }
    if (!errors.includes(timeout)) record(timeout);
    return { taskId, confirmed: false, errors, errorCount };
  } finally {
    clearTimeout(timer);
  }
}

function requestId(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let value = BigInt(Date.now());
  for (const byte of randomBytes(10)) value = (value << 8n) | BigInt(byte);
  let output = "";
  for (let count = 0; count < 26; count++) {
    output = alphabet[Number(value & 31n)] + output;
    value >>= 5n;
  }
  return output;
}
/**
 * Explicit business composition over TaskService, not a nested Engine protocol.
 * The transport authenticates the caller; authorize is a mandatory per-invocation gate.
 */
export function createCheckInvoker(options: {
  service: TaskInvocationService;
  client: IpfsClient;
  caller: Caller;
  timeoutMs: number;
  cleanupTimeoutMs?: number;
  authorize: (request: { parentCid: string; cid: string; scope: string }) => boolean;
}): CheckInvoker {
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 300_000
  )
    throw new Error("Invalid child invocation timeout.");
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1 || cleanupTimeoutMs > 30_000)
    throw new Error("Invalid child cleanup timeout.");
  return async (request, context) => {
    context.signal.throwIfAborted();
    if (
      options.authorize({
        parentCid: request.parentCid,
        cid: request.cid,
        scope: context.scope,
      }) !== true ||
      options.caller.scope !== context.scope
    )
      throw new TaskError("forbidden", "Child Task invocation is not authorized.");
    if (
      request.parentCid !== context.bundle.cid ||
      !/^resources\/checks\/[a-z][a-z0-9-]*$/.test(request.path)
    )
      throw new TaskError("invalid_bundle", "Child invocation does not belong to this Probe.");
    const deadline = Date.now() + options.timeoutMs;
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(options.timeoutMs)]);
    const node = await openContent(options.client, `${request.parentCid}/${request.path}`, {
      signal,
    });
    if (node.type !== "directory" || node.cid.toString() !== request.cid)
      throw new TaskError("invalid_bundle", "Child subtree does not match the locked Check root.");
    if (!request.input || typeof request.input !== "object" || Array.isArray(request.input))
      throw new TaskError("invalid_input", "Mapped child Task input must be an object.");
    const input = request.input as JsonObject;
    for (const key of ["requestId", "bundle", "timeoutMs", "eligibleAt", "seriesId", "matchPolicy"])
      if (Object.hasOwn(input, key))
        throw new TaskError("invalid_input", "Mapped input collides with Task envelope.");
    let taskId: string | undefined;
    let admissionAttempted = false;
    let rejected = false;
    const id = requestId();
    try {
      signal.throwIfAborted();
      admissionAttempted = true;
      let decision = validateDecision(
        await bounded(
          () =>
            options.service.submit(
              {
                ...input,
                requestId: id,
                bundle: request.cid,
                timeoutMs: Math.max(1, deadline - Date.now()),
              },
              options.caller,
            ),
          signal,
        ),
        id,
      );
      while (decision.status === "preparing") {
        await delay(10, undefined, { signal });
        decision = validateDecision(
          await bounded(
            () => options.service.getRequestStatus(id, { waitMs: 100 }, options.caller),
            signal,
          ),
          id,
        );
      }
      if (decision.status === "rejected") {
        rejected = true;
        throw new TaskError(decision.error.code, decision.error.message);
      }
      taskId = decision.taskId;
      for (;;) {
        signal.throwIfAborted();
        const target: string = taskId;
        const task: TaskSnapshot = await bounded(
          () => options.service.getTask(target, options.caller),
          signal,
        );
        if (
          task.taskId !== taskId ||
          !task.bundle ||
          bundleCid(validateBundleReference(task.bundle)) !== request.cid
        )
          throw new TaskError(
            "invalid_response",
            "Child response has a different execution identity.",
          );
        if (task.stage === "completed") {
          return task.result;
        }
        if (["failed", "stopped"].includes(task.stage))
          throw new TaskError(
            task.error?.code ?? "child_failed",
            task.error?.message ?? "Child Check did not complete.",
          );
        await delay(10, undefined, { signal });
      }
    } catch (primary) {
      if (admissionAttempted && !rejected) {
        // A failed transport does not prove that the durable admission failed.
        const cleanup = await recoverAndCancel(
          options.service,
          options.caller,
          id,
          request.cid,
          taskId,
          cleanupTimeoutMs,
        );
        if (cleanup.errorCount)
          throw new CheckInvocationCleanupError(
            id,
            cleanup.taskId,
            cleanup.confirmed,
            cleanup.errorCount,
            primary,
            cleanup.errors,
          );
      }
      throw primary;
    }
  };
}
