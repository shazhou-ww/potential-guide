import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseCheckEnvelope } from "./pilot.js";
import type { CheckProbe, CheckResult, Envelope, Subject } from "./types.js";
import { ObjectiveConfigurationError } from "./validation.js";

function failure(kind: string, cause: unknown, status = 502): Envelope<CheckResult> {
  return {
    status,
    payload: null,
    message: `${kind}: ${cause instanceof Error ? cause.message : String(cause)}`,
  };
}

export function createMemoryCheckProbe(
  invoke: (
    subject: Subject,
    signal: AbortSignal,
  ) => Promise<Envelope<CheckResult>> | Envelope<CheckResult>,
): CheckProbe {
  return async (subject, signal) => {
    signal.throwIfAborted();
    try {
      const result = parseCheckEnvelope(await invoke(subject, signal));
      signal.throwIfAborted();
      return result;
    } catch (cause) {
      signal.throwIfAborted();
      return failure("memory-invocation", cause);
    }
  };
}

function duration(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new ObjectiveConfigurationError(`${name} must be a positive safe timer duration.`);
  }
  return value;
}

export function createHttpCheckProbe(
  url: string,
  options: { readonly timeoutMs?: number } = {},
): CheckProbe {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ObjectiveConfigurationError(
      "HTTP probes require an HTTP(S) URL without credentials.",
    );
  }
  const timeoutMs = duration(options.timeoutMs ?? 30_000, "timeoutMs");
  return async (subject, signal) => {
    signal.throwIfAborted();
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetch(parsed, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subject),
        signal: AbortSignal.any([signal, timeout]),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        return failure("http-status", `HTTP ${response.status}`, response.status);
      }
      const result = parseCheckEnvelope(await response.json());
      signal.throwIfAborted();
      return result;
    } catch (cause) {
      signal.throwIfAborted();
      return failure(timeout.aborted ? "timeout" : "http-invocation", cause);
    }
  };
}

export interface ProcessCheckProbeOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly gracePeriodMs?: number;
  readonly log?: (text: string) => void;
}

const OUTPUT_LIMIT = 1024 * 1024;

export function createProcessCheckProbe(options: ProcessCheckProbeOptions): CheckProbe {
  if (!options.command.trim())
    throw new ObjectiveConfigurationError("A process command is required.");
  const timeoutMs = duration(options.timeoutMs ?? 30_000, "timeoutMs");
  const gracePeriodMs = duration(options.gracePeriodMs ?? 250, "gracePeriodMs");
  return async (subject, signal) => {
    signal.throwIfAborted();
    const scratch = resolve(".cache", "pguide-probes");
    await mkdir(scratch, { recursive: true });
    const directory = await mkdtemp(join(scratch, "pguide-check-"));
    try {
      signal.throwIfAborted();
      const inherited =
        process.platform === "win32"
          ? ["Path", "PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"]
          : ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"];
      const environment = Object.fromEntries(
        inherited.flatMap((key) =>
          process.env[key] === undefined ? [] : [[key, process.env[key]]],
        ),
      );
      const result = await new Promise<Envelope<CheckResult>>((resolve) => {
        const child = spawn(options.command, [...(options.args ?? [])], {
          cwd: options.cwd,
          env: { ...environment, PGUIDE_PROBE_TEMP_DIR: directory },
          shell: false,
          windowsHide: true,
          detached: process.platform !== "win32",
          stdio: ["pipe", "pipe", "pipe"],
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
        function terminate(force: boolean) {
          if (process.platform === "win32") {
            killWindows(force);
          } else if (child.pid !== undefined) {
            try {
              process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
            } catch (cause) {
              if ((cause as NodeJS.ErrnoException).code !== "ESRCH") {
                options.log?.(`Process group termination failed: ${String(cause)}\n`);
                child.kill(force ? "SIGKILL" : "SIGTERM");
              }
            }
          }
        }
        function stop(result: Envelope<CheckResult>) {
          if (stopped !== undefined) return;
          stopped = result;
          terminate(false);
          hardTimer = setTimeout(() => terminate(true), gracePeriodMs);
        }
        const onAbort = () => stop(failure("cancelled", "Check cancelled.", 499));
        const timer = setTimeout(
          () => stop(failure("timeout", `Check timed out after ${timeoutMs}ms.`, 504)),
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
          clearTimeout(timer);
          if (hardTimer !== undefined) {
            // A child can exit before descendants. Complete the group teardown before cleanup.
            terminate(true);
            clearTimeout(hardTimer);
          }
          signal.removeEventListener("abort", onAbort);
          await Promise.all(killers);
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
}
