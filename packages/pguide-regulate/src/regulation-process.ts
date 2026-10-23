import { type ChildProcess, fork } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type AgentProfile, killProcessTree } from "@potential-guide/cli-core";
import {
  type AuthorizationRequest,
  RegulationError,
  type RegulationInput,
  type RegulationOutcome,
} from "@potential-guide/objective-regulator";

export interface ProcessRegulationHandle {
  readonly result: Promise<RegulationOutcome>;
  abort(): void;
  kill(): Promise<void>;
}

export interface CapabilityRequest {
  readonly type: "capability-request";
  readonly capability: string;
  readonly reason: string;
}
export interface PermissionRequest {
  readonly type: "authorization-request";
  readonly request: AuthorizationRequest;
}
export type RegulationProcessEvent = CapabilityRequest | PermissionRequest;

export function createProcessRegulationRunner(
  profiles: Readonly<Record<string, AgentProfile>>,
  cwd: string,
  onEvent?: (input: RegulationInput, event: RegulationProcessEvent) => void,
) {
  return {
    start(
      input: RegulationInput,
      resource: { readonly binding: { readonly id: string } },
    ): ProcessRegulationHandle {
      const pinnedInput = structuredClone(input);
      const profile =
        profiles[resource.binding.id] === undefined
          ? undefined
          : structuredClone(profiles[resource.binding.id]);
      if (profile === undefined) throw new RegulationError("Unknown execution Agent binding.", 400);
      let child: ChildProcess | undefined;
      let aborted = false;
      let killRequested = false;
      let ready: Promise<void>;
      let closed: Promise<void> = Promise.resolve();
      let cleanupAcknowledged = false;
      let acknowledge!: () => void;
      const cleaned = new Promise<void>((resolve) => {
        acknowledge = resolve;
      });
      let stop: Promise<void> | undefined;
      const force = () => {
        killRequested = true;
        stop ??= (async () => {
          await ready;
          let cleanupConfirmed = cleanupAcknowledged;
          if (child !== undefined) {
            if (!cleanupAcknowledged && child.connected) {
              // Killing an observer process alone does not cancel its shared Host execution.
              aborted = true;
              child.send({ type: "abort" }, () => {});
              let timer: ReturnType<typeof setTimeout> | undefined;
              try {
                await Promise.race([
                  cleaned,
                  new Promise<void>((resolve) => {
                    timer = setTimeout(resolve, 10_000);
                  }),
                ]);
              } finally {
                clearTimeout(timer);
              }
            }
            cleanupConfirmed = cleanupAcknowledged;
            await killProcessTree(child);
          }
          await closed;
          if (!cleanupConfirmed)
            throw new RegulationError(
              "Regulation process stopped before shared-check cleanup was confirmed.",
              500,
            );
        })();
        return stop;
      };
      const setup = (async () => {
        const scratch = resolve(cwd, ".cache", "pguide-runs");
        await mkdir(scratch, { recursive: true });
        const directory = await mkdtemp(join(scratch, "run-"));
        try {
          child = fork(new URL("./regulation-worker.js", import.meta.url), [], {
            cwd,
            execArgv: [],
            serialization: "advanced",
            stdio: ["ignore", "ignore", "pipe", "ipc"],
            windowsHide: true,
          });
          child.stderr?.pipe(process.stderr, { end: false });
          closed = new Promise<void>((resolveClosed) =>
            child?.once("close", () => resolveClosed()),
          );
          const reply = new Promise<RegulationOutcome>((resolveReply, rejectReply) => {
            child?.once("error", rejectReply);
            child?.on("message", (message: unknown) => {
              if (message === null || typeof message !== "object" || !("type" in message)) return;
              if (
                message.type === "capability-request" &&
                "capability" in message &&
                typeof message.capability === "string" &&
                "reason" in message &&
                typeof message.reason === "string"
              ) {
                try {
                  onEvent?.(input, {
                    type: "capability-request",
                    capability: message.capability,
                    reason: message.reason,
                  });
                } catch (error) {
                  rejectReply(error);
                }
              } else if (message.type === "authorization-request" && "request" in message) {
                try {
                  onEvent?.(input, {
                    type: "authorization-request",
                    request: message.request as AuthorizationRequest,
                  });
                } catch (error) {
                  rejectReply(error);
                }
              } else if (message.type === "outcome" && "outcome" in message) {
                cleanupAcknowledged = true;
                acknowledge();
                resolveReply(message.outcome as RegulationOutcome);
              } else if (message.type === "error" && "message" in message) {
                cleanupAcknowledged = true;
                acknowledge();
                const status =
                  "status" in message && typeof message.status === "number" ? message.status : 500;
                rejectReply(new RegulationError(String(message.message), status));
              }
            });
            child?.once("close", (code, signal) => {
              rejectReply(
                new RegulationError(
                  aborted || killRequested
                    ? "Regulation process was cancelled."
                    : `Regulation process exited without a result (${code ?? signal}).`,
                  aborted || killRequested ? 499 : 500,
                ),
              );
            });
          });
          child.send({ type: "start", input: pinnedInput, profile, cwd, directory }, (error) => {
            if (error !== null)
              void force().catch((cause: unknown) => process.stderr.write(`${String(cause)}\n`));
          });
          if (aborted) child.send({ type: "abort" });
          return { reply, directory };
        } catch (error) {
          await rm(directory, { recursive: true, force: true });
          throw error;
        }
      })();
      ready = setup.then(() => undefined);
      void ready.catch(() => undefined);
      const result = (async () => {
        const { reply, directory } = await setup;
        try {
          return await reply;
        } finally {
          await force();
          await rm(directory, { recursive: true, force: true });
        }
      })();
      // Callers may attach after a synchronous queue reconciliation.
      void result.catch(() => undefined);
      return {
        result,
        abort() {
          aborted = true;
          if (child?.connected) child.send({ type: "abort" });
        },
        kill: force,
      };
    },
  };
}
