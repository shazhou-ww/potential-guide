import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type CheckState,
  connectHost,
  type Subject as HostSubject,
} from "@potential-guide/check-host";
import {
  bindDependencyRequest,
  type ObjectiveDependencySource,
  withDependencyResolutions,
} from "./dependency.js";
import { type CheckEvidenceContext, RunEvidence } from "./evidence.js";
import { parseCheckEnvelope } from "./pilot.js";
import { stopPosixTree } from "./process-tree.js";
import type { CheckProbe, CheckResult, DependencyResolution, Envelope, Subject } from "./types.js";
import { fields, json, ObjectiveConfigurationError, record } from "./validation.js";

function failure(kind: string, cause: unknown, status = 502): Envelope<CheckResult> {
  return {
    status,
    payload: null,
    message: `${kind}: ${cause instanceof Error ? cause.message : String(cause)}`,
  };
}

function evidenceProbe(
  invoke: (
    subject: Subject,
    signal: AbortSignal,
    context?: CheckEvidenceContext,
    resolutions?: readonly DependencyResolution[],
  ) => Promise<Envelope<CheckResult>>,
  options: { readonly evidence?: RunEvidence | false; readonly identity?: unknown },
): CheckProbe {
  return async (subject, signal, resolutions) => {
    signal.throwIfAborted();
    const ownRun = options.evidence === undefined;
    const run =
      options.evidence === false || process.env.PGUIDE_EVIDENCE_DISABLED === "1"
        ? undefined
        : (options.evidence ?? new RunEvidence());
    const context = run?.startCheck(options.identity ?? { transport: "probe" });
    run?.stream.protect(subject);
    try {
      const result = await invoke(subject, signal, context, resolutions);
      if (context !== undefined) run?.finishCheck(context, result);
      if (ownRun) run?.stream.emit("run.finished", { outcome: "completed" });
      return result;
    } catch (error) {
      run?.stream.emit("check.interrupted", {
        checkRunId: context?.checkRunId,
        outcome: signal.aborted ? "cancelled" : "execution-error",
      });
      if (ownRun)
        run?.stream.emit("run.failed", {
          outcome: signal.aborted ? "cancelled" : "execution-error",
        });
      throw error;
    }
  };
}

export function createWorkerCheckProbe(options: {
  readonly directory: string;
  readonly revision: string;
  readonly inputView?: unknown;
  readonly timeoutMs?: number;
  readonly evidence?: RunEvidence | false;
  readonly identity?: unknown;
}): CheckProbe {
  return evidenceProbe(async (subject, signal, _evidence, resolutions) => {
    signal.throwIfAborted();
    const client = await connectHost();
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
    let state: CheckState;
    try {
      state = await client.execute(
        {
          directory: options.directory,
          revision: options.revision,
          subject: structuredClone(subject) as HostSubject,
          context: {
            resolutions: JSON.parse(JSON.stringify(resolutions ?? [])),
            inputView:
              options.inputView === undefined
                ? null
                : JSON.parse(JSON.stringify(options.inputView)),
            timeoutMs: options.timeoutMs ?? 30_000,
          },
        },
        AbortSignal.any([signal, timeout]),
      );
    } catch (error) {
      signal.throwIfAborted();
      if (timeout.aborted)
        return failure(
          "check-timeout",
          `${JSON.stringify(options.identity)}: ${options.timeoutMs ?? 30_000}ms`,
        );
      throw error;
    }
    if (state.state === "Completed") return parseCheckEnvelope(state.result);
    return failure("worker-invocation", state.state === "Failed" ? state.error : state.state);
  }, options);
}

export function createMemoryCheckProbe(
  invoke: (
    subject: Subject,
    signal: AbortSignal,
  ) => Promise<Envelope<CheckResult>> | Envelope<CheckResult>,
  options: { readonly evidence?: RunEvidence | false; readonly identity?: unknown } = {},
): CheckProbe {
  return evidenceProbe(async (subject, signal, _context, resolutions) => {
    signal.throwIfAborted();
    try {
      const result = parseCheckEnvelope(
        await withDependencyResolutions(resolutions ?? [], () => invoke(subject, signal)),
      );
      signal.throwIfAborted();
      return result;
    } catch (cause) {
      signal.throwIfAborted();
      return failure("memory-invocation", cause);
    }
  }, options);
}

function duration(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new ObjectiveConfigurationError(`${name} must be a positive safe timer duration.`);
  }
  return value;
}

export function createHttpCheckProbe(
  url: string,
  _options: {
    readonly timeoutMs?: number;
    readonly evidence?: RunEvidence | false;
    readonly identity?: unknown;
  } = {},
): CheckProbe {
  throw new ObjectiveConfigurationError(
    `Legacy bare-subject HTTP checks are unsupported (${url}); use a worker directory/revision with createWorkerCheckProbe.`,
  );
}

export interface ProcessCheckProbeOptions {
  readonly inputView?: { readonly path: string; readonly sha256: string };
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly gracePeriodMs?: number;
  readonly log?: (text: string) => void;
  readonly evidence?: RunEvidence | false;
  readonly identity?: unknown;
  readonly dependencyBinding?: boolean;
}

const OUTPUT_LIMIT = 1024 * 1024;

export function createProcessCheckProbe(options: ProcessCheckProbeOptions): CheckProbe {
  if (!options.command.trim())
    throw new ObjectiveConfigurationError("A process command is required.");
  const timeoutMs = duration(options.timeoutMs ?? 30_000, "timeoutMs");
  const gracePeriodMs = duration(options.gracePeriodMs ?? 250, "gracePeriodMs");
  const dependencyBinding =
    options.dependencyBinding ?? /(?:^|[\\/])node(?:\.exe)?$/i.test(options.command);
  const invoke = async (
    subject: Subject,
    signal: AbortSignal,
    context?: CheckEvidenceContext,
  ): Promise<Envelope<CheckResult>> => {
    signal.throwIfAborted();
    const scratch = resolve(".cache", "pguide-probes");
    await mkdir(scratch, { recursive: true });
    const directory = await mkdtemp(join(scratch, "pguide-check-"));
    try {
      signal.throwIfAborted();
      const inherited =
        process.platform === "win32"
          ? ["Path", "PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "PGUIDE_TIMINGS"]
          : ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "PGUIDE_TIMINGS"];
      const environment = Object.fromEntries(
        inherited.flatMap((key) =>
          process.env[key] === undefined ? [] : [[key, process.env[key]]],
        ),
      );
      const result = await new Promise<Envelope<CheckResult>>((resolve, reject) => {
        const dependencyRequest = bindDependencyRequest();
        const dependencyLifetime = new AbortController();
        const requests = new Set<Promise<void>>();
        const child = spawn(options.command, [...(options.args ?? [])], {
          cwd: options.cwd,
          env: {
            ...environment,
            PGUIDE_PROBE_TEMP_DIR: directory,
            PGUIDE_PROBE_TIMEOUT_MS: String(timeoutMs),
            ...(options.inputView === undefined
              ? {}
              : {
                  PGUIDE_INPUT_VIEW: options.inputView.path,
                  PGUIDE_INPUT_VIEW_SHA256: options.inputView.sha256,
                }),
            ...(dependencyBinding
              ? {
                  NODE_OPTIONS: `--import=${new URL("./dependency-preload.js", import.meta.resolve("@potential-guide/objective-pilot")).href}`,
                }
              : {}),
            ...(context === undefined
              ? { PGUIDE_EVIDENCE_DISABLED: "1" }
              : { PGUIDE_EVIDENCE_CONTEXT: JSON.stringify(context) }),
          },
          shell: false,
          windowsHide: true,
          detached: process.platform !== "win32",
          stdio: dependencyBinding ? ["pipe", "pipe", "pipe", "ipc"] : ["pipe", "pipe", "pipe"],
        });
        if (!child.stdin || !child.stdout || !child.stderr) {
          reject(new Error("Process probe requires piped stdin/stdout/stderr."));
          return;
        }
        child.on("message", (value: unknown) => {
          const pending = (async () => {
            if (!record(value) || value.type !== "pguide.dependency.request")
              throw new Error("Invalid dependency IPC request.");
            if (Buffer.byteLength(JSON.stringify(value)) > OUTPUT_LIMIT)
              throw new Error("Dependency IPC request exceeded the output limit.");
            fields(value, ["type", "requestId", "target", "subject"]);
            if (
              typeof value.requestId !== "string" ||
              value.requestId.length > 128 ||
              !record(value.target) ||
              !record(value.subject) ||
              !json(value.subject)
            )
              throw new Error("Invalid dependency IPC payload.");
            fields(value.target, ["objectiveId", "expectedLevelId"], ["language"]);
            if (
              typeof value.target.objectiveId !== "string" ||
              typeof value.target.expectedLevelId !== "string" ||
              (value.target.language !== undefined && typeof value.target.language !== "string")
            )
              throw new Error("Invalid dependency source.");
            const target: ObjectiveDependencySource = {
              objectiveId: value.target.objectiveId,
              expectedLevelId: value.target.expectedLevelId,
              ...(value.target.language === undefined ? {} : { language: value.target.language }),
            };
            try {
              const envelope = await dependencyRequest(
                target,
                value.subject,
                AbortSignal.any([signal, dependencyLifetime.signal]),
              );
              if (!dependencyLifetime.signal.aborted && child.connected)
                child.send(
                  {
                    type: "pguide.dependency.result",
                    requestId: value.requestId,
                    envelope,
                  },
                  (cause) => {
                    if (cause && !dependencyLifetime.signal.aborted)
                      stop(failure("dependency-binding", cause));
                  },
                );
            } catch (cause) {
              if (!dependencyLifetime.signal.aborted && child.connected)
                child.send(
                  {
                    type: "pguide.dependency.result",
                    requestId: value.requestId,
                    error: cause instanceof Error ? cause.message : String(cause),
                  },
                  (error) => {
                    if (error && !dependencyLifetime.signal.aborted)
                      stop(failure("dependency-binding", error));
                  },
                );
            }
          })().catch((cause) => stop(failure("dependency-binding", cause)));
          requests.add(pending);
          void pending.finally(() => requests.delete(pending));
        });
        let stdout = "";
        let stderrBytes = 0;
        let stopped: Envelope<CheckResult> | undefined;
        let hardTimer: ReturnType<typeof setTimeout> | undefined;
        const killers = new Set<Promise<void>>();
        function killWindows(force: boolean) {
          if (child.pid === undefined) return;
          const killer = spawn(
            "taskkill",
            ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])],
            {
              windowsHide: true,
              stdio: "ignore",
            },
          );
          const pending = new Promise<void>((done) => {
            killer.once("error", (cause) => {
              options.log?.(`taskkill failed: ${cause.message}\n`);
              child.kill("SIGKILL");
              done();
            });
            killer.once("close", () => done());
          });
          killers.add(pending);
          void pending.then(() => killers.delete(pending));
        }
        function stop(result: Envelope<CheckResult>) {
          if (stopped !== undefined) return;
          stopped = result;
          if (process.platform === "win32") {
            killWindows(false);
            hardTimer = setTimeout(() => killWindows(true), gracePeriodMs);
          } else {
            const pending = stopPosixTree(child, gracePeriodMs);
            killers.add(pending);
            void pending.catch(reject);
          }
        }
        const onAbort = () => stop(failure("cancelled", "Check cancelled.", 499));
        const timer = setTimeout(
          () =>
            stop(
              failure(
                "timeout",
                `check-timeout: ${JSON.stringify(options.identity ?? { command: options.command })}: Check timed out after ${timeoutMs}ms.`,
                504,
              ),
            ),
          timeoutMs,
        );
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          if (stopped !== undefined) return;
          stdout += chunk;
          if (Buffer.byteLength(stdout) > OUTPUT_LIMIT)
            stop(failure("output-limit", "Check stdout exceeded the output limit."));
        });
        child.stderr.on("data", (chunk: string) => {
          if (stopped !== undefined) return;
          stderrBytes += Buffer.byteLength(chunk);
          options.log?.(chunk);
          if (stderrBytes > OUTPUT_LIMIT)
            stop(failure("output-limit", "Check stderr exceeded the output limit."));
        });
        child.once("error", (cause) => {
          stopped = failure("process-start", cause);
        });
        child.stdin.once("error", (cause) => stop(failure("process-stdin", cause)));
        child.once("close", async (code, exitSignal) => {
          dependencyLifetime.abort(new Error("Owning check exited."));
          clearTimeout(timer);
          if (hardTimer !== undefined) {
            // A child can exit before descendants. Complete the group teardown before cleanup.
            killWindows(true);
            clearTimeout(hardTimer);
          }
          signal.removeEventListener("abort", onAbort);
          try {
            await Promise.all(killers);
            await Promise.all(requests);
          } catch (cause) {
            reject(cause);
            return;
          }
          if (stopped !== undefined) {
            resolve(stopped);
            return;
          }
          if (code !== 0) {
            resolve(
              failure("process-exit", `Check exited with ${code ?? exitSignal ?? "unknown"}.`),
            );
            return;
          }
          try {
            resolve(parseCheckEnvelope(JSON.parse(stdout)));
          } catch (cause) {
            resolve(failure("process-protocol", cause));
          }
        });
        child.stdin.end(JSON.stringify(subject));
      });
      signal.throwIfAborted();
      return result;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
  return evidenceProbe(invoke, options);
}
