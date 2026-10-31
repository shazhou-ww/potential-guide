import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import {
  type CheckerManifest,
  type ContractArtifact,
  parseCheckerResult,
} from "@potential-guide/check-artifacts/contracts";
import type { RunningWork } from "@potential-guide/task-engine/pool";
import type { StartPermit } from "@potential-guide/task-protocol";
import type { CheckPrepared } from "./index.js";

export interface WorkerOptions {
  directory: string;
  wallMs: number;
  cleanupMs: number;
  memoryMb: number;
  environment: Readonly<Record<string, string>>;
  onStart?: () => void;
}

/** One physical worker per run; all scheduling and ownership stay in Engine/Pool. */
export function runChecker(
  prepared: CheckPrepared,
  artifact: ContractArtifact<CheckerManifest>,
  permit: StartPermit,
  options: WorkerOptions,
): RunningWork {
  const directory = join(resolve(options.directory), randomUUID());
  let worker: Worker;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const [path, bytes] of artifact.files) {
      const destination = join(directory, path);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, bytes, { flag: "wx", mode: 0o400 });
    }
    worker = new Worker(
      new URL(import.meta.resolve("@potential-guide/check-runtime-files/worker")),
      {
        execArgv: [],
        env: { ...options.environment, NODE_OPTIONS: "" },
        workerData: {
          entry: join(directory, artifact.manifest.entry),
          source: artifact.files.get(artifact.manifest.entry)!.toString("utf8"),
          generation: permit.generation,
          messageBytes: 8 * 1024 * 1024,
        },
        resourceLimits: { maxOldGenerationSizeMb: options.memoryMb, maxYoungGenerationSizeMb: 32 },
        stdout: true,
        stderr: true,
      },
    );
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  worker.stdout.resume();
  worker.stderr.resume();
  const owned = new Set<number>();
  let value: unknown;
  let failure: Error | undefined;
  let done = false;
  let stopped = false;
  let resolveExit!: () => void;
  let resolveResult!: (value: unknown) => void;
  let rejectResult!: (error: unknown) => void;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  const result = new Promise<unknown>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const send = (type: string, fields: Record<string, unknown> = {}) =>
    worker.postMessage({
      version: 1,
      generation: permit.generation,
      checkId: permit.runId,
      type,
      ...fields,
    });
  let termination: Promise<void> | undefined;
  const force = () =>
    (termination ??= (async () => {
      stopped = true;
      await worker.terminate();
      await exited;
    })());
  const deadline = Date.now() + options.wallMs;
  const timer = setTimeout(() => {
    failure ??= new Error("Checker run or disposal deadline exceeded.");
    void force();
  }, options.wallMs);
  worker.on("message", (message) => {
    if (message.version !== 1 || message.generation !== permit.generation) return;
    try {
      if (message.type === "ready") {
        if (stopped) {
          send("dispose");
          return;
        }
        options.onStart?.();
        send("execute", {
          subject: prepared.input.subject,
          context: { ...prepared.input.context, language: prepared.language },
          deadline,
        });
      } else if (message.type === "initialization-failed") {
        failure = new Error("Checker initialization failed.");
        void force();
      } else if (message.checkId === permit.runId) {
        if (message.type === "owned") {
          if (!Number.isSafeInteger(message.pid) || message.pid <= 0 || message.pid === process.pid)
            throw new Error("Invalid owned child identity.");
          owned.add(message.pid);
        }
        if (message.type === "released") owned.delete(message.pid);
        if (message.type === "progress" && !stopped) permit.progress(message.value);
        if (message.type === "done") {
          done = true;
          if (!message.clean || message.error || owned.size || message.cancelled)
            throw new Error(message.clean ? "Checker run failed." : "Checker cleanup failed.");
          value = parseCheckerResult(message.result, artifact.manifest);
          send("dispose");
        }
      }
    } catch (error) {
      failure = error instanceof Error ? error : new Error("Invalid Checker output.");
      void force();
    }
  });
  worker.on("error", (error) => {
    failure ??= error;
  });
  worker.once("exit", (code) => {
    clearTimeout(timer);
    resolveExit();
    if (failure || !done || code !== 0 || stopped)
      rejectResult(failure ?? new Error("Checker interrupted before confirmed disposal."));
    else resolveResult(value);
  });
  return {
    result,
    exited,
    cooperate() {
      stopped = true;
      send("cancel");
    },
    force,
    async cleanup() {
      // Only process IDs reported by this run are candidates for reclamation.
      for (const pid of owned) {
        if (process.platform === "win32") {
          try {
            await promisify(execFile)("taskkill", ["/PID", String(pid), "/T", "/F"], {
              windowsHide: true,
              timeout: options.cleanupMs,
            });
          } catch (error) {
            try {
              process.kill(pid, 0);
            } catch (cause) {
              if ((cause as NodeJS.ErrnoException).code === "ESRCH") continue;
              throw cause;
            }
            throw error;
          }
        } else {
          try {
            process.kill(pid, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
        }
        const until = performance.now() + options.cleanupMs;
        for (;;) {
          try {
            process.kill(pid, 0);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
            break;
          }
          if (performance.now() >= until) throw new Error("Owned process exit is unconfirmed.");
          await delay(10);
        }
      }
      owned.clear();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
