import type { AgentProfile, AhpSessionIdentity } from "@potential-guide/cli-core";
import { Effect } from "@potential-guide/effects";
import type { PilotSpec } from "@potential-guide/objective-pilot";
import {
  type AgentOutcome,
  RegulationError,
  type RegulationInput,
  regulate,
} from "@potential-guide/objective-regulator";
import { executeAgent, safeAgentValue } from "./commands/regulator.js";
import { withPilot } from "./pilot-source.js";

interface StartMessage {
  readonly type: "start";
  readonly input: RegulationInput;
  readonly profile: AgentProfile;
  readonly cwd: string;
  readonly directory: string;
}

const controller = new AbortController();
let started = false;

async function run(message: StartMessage) {
  const versions: Record<string, string> = {};
  function collect(spec: PilotSpec) {
    versions[spec.objectiveId] = spec.version;
    if (spec.prerequisite !== undefined) collect(spec.prerequisite);
  }
  collect(message.input.spec.pilot);
  let sessionId: string | undefined;
  let ahpSession: AhpSessionIdentity | undefined;
  const executions: Promise<AgentOutcome>[] = [];
  try {
    return await withPilot(
      message.input.spec.pilot.objectiveId,
      message.cwd,
      message.input.spec.pilot.version,
      async (spec, pilot) => {
        if (JSON.stringify(spec) !== JSON.stringify(message.input.spec.pilot))
          throw new RegulationError(
            "Pinned Pilot specification differs from the requested recipe.",
            409,
          );
        return Effect.runPromise(
          regulate(message.input, {
            pilot,
            executeAgent: (input, signal) => {
              const execution = executeAgent(
                input,
                signal,
                message.profile,
                message.cwd,
                async (update) => {
                  if (
                    update !== null &&
                    typeof update === "object" &&
                    "method" in update &&
                    update.method === "pguide/permission_decision" &&
                    "params" in update &&
                    update.params !== null &&
                    typeof update.params === "object" &&
                    "decision" in update.params &&
                    update.params.decision === "denied" &&
                    "request" in update.params
                  ) {
                    process.send?.({
                      type: "authorization-request",
                      request: update.params.request,
                    });
                    return;
                  }
                  if (
                    update !== null &&
                    typeof update === "object" &&
                    "method" in update &&
                    update.method === "pguide/ahp-interruption"
                  ) {
                    process.stderr.write(
                      `${JSON.stringify(safeAgentValue(update, message.profile))}\n`,
                    );
                    return;
                  }
                  if (
                    update === null ||
                    typeof update !== "object" ||
                    !("method" in update) ||
                    update.method !== "pguide/capability-request"
                  )
                    return;
                  const params = "params" in update ? update.params : undefined;
                  if (
                    params === null ||
                    typeof params !== "object" ||
                    !("capability" in params) ||
                    typeof params.capability !== "string" ||
                    !params.capability.trim() ||
                    !("reason" in params) ||
                    typeof params.reason !== "string" ||
                    !params.reason.trim()
                  )
                    throw new RegulationError("Malformed capability request from Agent.", 502);
                  if (params.capability.length > 128 || params.reason.length > 4096)
                    throw new RegulationError("Oversized capability request from Agent.", 502);
                  process.send?.(
                    safeAgentValue(
                      {
                        type: "capability-request",
                        capability: params.capability,
                        reason: params.reason,
                      },
                      message.profile,
                    ),
                  );
                },
                {
                  ...(sessionId === undefined ? {} : { sessionId }),
                  ...(ahpSession === undefined ? {} : { ahpSession }),
                  onSession: async (id, _mode, identity) => {
                    sessionId = id;
                    ahpSession = identity;
                  },
                },
              );
              executions.push(execution);
              return execution;
            },
          }),
          { signal: controller.signal },
        );
      },
      {
        versions,
        cacheDirectory: message.directory,
        probeTimeoutMs: message.input.spec.strategy?.probe?.timeoutMs,
      },
    );
  } finally {
    await Promise.allSettled(executions);
  }
}

process.on("message", (raw: unknown) => {
  if (raw === null || typeof raw !== "object" || !("type" in raw)) return;
  if (raw.type === "abort") {
    controller.abort(new Error("Supervisor requested regulation abort."));
  } else if (raw.type === "start" && !started) {
    started = true;
    void run(raw as StartMessage).then(
      (outcome) => process.send?.({ type: "outcome", outcome }),
      (error: unknown) =>
        process.send?.({
          type: "error",
          status: controller.signal.aborted
            ? 499
            : error instanceof RegulationError
              ? error.status
              : 500,
          message: error instanceof Error ? error.message : String(error),
        }),
    );
  }
});
process.on("disconnect", () => controller.abort(new Error("Supervisor disconnected.")));
