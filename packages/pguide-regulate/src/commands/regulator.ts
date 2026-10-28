import { randomUUID } from "node:crypto";
import { appendFile, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  type AcpAgentProfile,
  AcpClient,
  type AgentProfile,
  type AhpSessionIdentity,
  atomicWrite,
  CliError,
  digest,
  ensurePrivateDirectory,
  executeAhp,
  type GlobalOptions,
  type LegacyAcpAgentProfile,
  loadAgents,
  loadConfig,
  markdownInlineCode,
  markdownText,
  option,
  pruneExpiredRegulations,
  redactAgentValue,
  rejectUnknownOptions,
  reportOptions,
  requiredSetting,
  setting,
  showCommandHelp,
  stateRoot,
  validateAgentProfile,
  writeResult,
} from "@potential-guide/cli-core";
import { pilotSourceBudgets, withPilot } from "@potential-guide/cli-runtime";
import { Exit, startEffect } from "@potential-guide/effects";
import { selectObjective } from "@potential-guide/objective-declarations";
import type {
  Envelope,
  ObjectiveSource,
  PilotObservation,
  PilotRuntime,
  PilotSpec,
  Subject,
} from "@potential-guide/objective-pilot";
import {
  ObjectiveConfigurationError,
  objectiveSourceVersion,
  validatePilotSource,
} from "@potential-guide/objective-pilot";
import {
  type AgentInput,
  type AgentOutcome,
  type AuthorizationRequest,
  makeRegulationPermissions,
  makeRegulatorSpec,
  RegulationError,
  type RegulationOutcome,
  type RegulationPermissions,
  type RegulationStrategy,
  regulate,
} from "@potential-guide/objective-regulator";
import {
  createAcpPermissionPolicy,
  type PermissionDecision,
  unknownPermissionRequest,
} from "../acp-permissions.js";

export const defaultRegulationQuota = Object.freeze({
  timeoutMs: 300_000,
  maxAgentRuns: 10,
  maxStallRuns: 3,
});

interface Attempt {
  id: string;
  startedAt: string;
  completedAt?: string;
  status?: string;
  sessionId?: string;
  ahpSession?: AhpSessionIdentity;
  resumeMode?: "new" | "resumed" | "new-without-session-id" | "not-needed";
  observations: Envelope<PilotObservation>[];
  actions: AgentOutcome[];
  permissions?: RegulationPermissions;
}

interface Regulation {
  schemaVersion: 4 | 5 | 6 | 7;
  regulationId: string;
  createdAt: string;
  objectiveUri?: string;
  objectiveId?: string;
  objectiveCommit?: string;
  objectiveTree?: string;
  objectivePackageDigest?: string;
  objectiveArtifactDigest?: string;
  objectiveSource: ObjectiveSource;
  sourceBindings: Record<string, ObjectiveSource>;
  binding?: Awaited<ReturnType<typeof selectObjective>>["binding"];
  sourcePath?: string;
  subject: Subject;
  subjectDigest: string;
  targetLevel: string;
  language?: string;
  agentName: string;
  agentProfile: AgentProfile;
  agentExecutionLimits: { timeoutMs: number };
  regulationStrategy?: Partial<Pick<RegulationStrategy, "probe" | "quota">>;
  permissions?: RegulationPermissions;
  sessionId?: string;
  ahpSession?: AhpSessionIdentity;
  expiresAt?: string;
  attempts: Attempt[];
  history?: { stalledRuns: number };
}

function regulationObjective(regulation: Regulation): string {
  const id = regulation.schemaVersion !== 4 ? regulation.objectiveId : regulation.objectiveUri;
  if (typeof id !== "string")
    throw new CliError("Invalid persisted Objective identity.", 6, "io-error");
  return id;
}

export function agentPrompt(input: AgentInput): string {
  const permissions = makeRegulationPermissions(input.permissions);
  const active = new Set(permissions.grants);
  const authorization = { grants: permissions.ceiling.filter((rule) => active.has(rule.id)) };
  return `Potential Guide regulation\nTarget: ${JSON.stringify(input.target)}\nSubject: ${JSON.stringify(input.subject)}\nComplete observation: ${JSON.stringify(input.observation)}\nAgent execution limits: ${JSON.stringify(input.limits)}\nCurrent run authorization: ${JSON.stringify(authorization)}\nOnly the effective configured grants above apply to this run. Earlier session denials are historical, not current authorization decisions: when a current grant is relevant, you may request host permission evaluation again. These grants do not let you self-authorize or bypass protocol permission requests; the host must approve the exact operation and resources. Ungranted operations remain denied. Address the complete observation. Organize any repair tasks yourself. Do not claim objective progress; pguide re-observes after your execution.`;
}

export function safeAgentValue<T>(value: T, profile: AgentProfile | LegacyAcpAgentProfile): T {
  return redactAgentValue(value, profile);
}

export async function executeAcpAgent(
  input: AgentInput,
  signal: AbortSignal,
  profile: AcpAgentProfile | LegacyAcpAgentProfile,
  cwd: string,
  onUpdate?: (update: unknown) => Promise<void>,
  session: {
    sessionId?: string;
    continuing?: boolean;
    onSession?: (id: string, mode: "new" | "resumed" | "new-without-session-id") => Promise<void>;
  } = {},
): Promise<AgentOutcome> {
  signal.throwIfAborted();
  if (
    session.sessionId !== undefined &&
    (session.sessionId.trim() === "" ||
      safeAgentValue(session.sessionId, profile) !== session.sessionId)
  )
    throw new CliError(
      "Persisted ACP session ID is invalid or contains credential material.",
      6,
      "acp-error",
    );
  if (session.continuing && session.sessionId === undefined && profile.requirements?.sessionResume)
    throw new CliError(
      "Cannot continue: no real ACP session ID was persisted and this Agent requires session resume. Start a new regulation.",
      6,
      "acp-error",
    );
  const decisions: PermissionDecision[] = [];
  const policy = await createAcpPermissionPolicy(input.permissions, cwd, (decision) =>
    decisions.push(decision),
  );
  signal.throwIfAborted();
  const client = new AcpClient(
    profile,
    async (update) => {
      if (update.method === "pguide/request_denied" && policy.denied.length === 0)
        policy.noteDenied("invalid-or-cancelled-request");
      await onUpdate?.(update);
    },
    { permissionHandler: policy.handler },
  );
  let sessionId: string | undefined;
  let stopping: Promise<void> | undefined;
  const abort = () => {
    stopping = sessionId === undefined ? client.stop() : client.cancelAndStop(sessionId);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const initialized = await client.initialize(profile.connection.protocolVersion);
    signal.throwIfAborted();
    const capabilities = initialized.agentCapabilities;
    if (
      (profile.requirements?.sessionResume === true || session.sessionId !== undefined) &&
      (capabilities === null ||
        typeof capabilities !== "object" ||
        (capabilities as Record<string, unknown>).loadSession !== true)
    )
      throw new CliError(
        "ACP Agent did not advertise required session-resume capability.",
        6,
        "acp-error",
      );
    let resumeMode: "new" | "resumed" | "new-without-session-id";
    if (session.sessionId !== undefined) {
      await client.resumeSession(session.sessionId, cwd);
      sessionId = session.sessionId;
      resumeMode = "resumed";
    } else {
      sessionId = await client.newSession(cwd);
      resumeMode = session.continuing ? "new-without-session-id" : "new";
    }
    signal.throwIfAborted();
    if (safeAgentValue(sessionId, profile) !== sessionId)
      throw new CliError("ACP sessionId contained credential material.", 6, "acp-error");
    await session.onSession?.(sessionId, resumeMode);
    signal.throwIfAborted();
    const response = safeAgentValue(await client.prompt(sessionId, agentPrompt(input)), profile);
    signal.throwIfAborted();
    const authorizationRequests = safeAgentValue(policy.denied, profile);
    return response.status === "completed"
      ? {
          status: "completed",
          summary: response.summary,
          ...(authorizationRequests.length === 0 ? {} : { authorizationRequests }),
        }
      : authorizationRequests.length > 0
        ? {
            status: "authorization-required",
            reason: "Agent requires explicit authorization.",
            authorizationRequests,
          }
        : { status: "blocked", reason: response.summary };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw new CliError(
      safeAgentValue(error instanceof Error ? error.message : "ACP invocation failed.", profile),
      6,
      "acp-error",
    );
  } finally {
    signal.removeEventListener("abort", abort);
    await (stopping ?? client.stop());
    for (const decision of decisions)
      await onUpdate?.({
        timestamp: new Date().toISOString(),
        method: "pguide/permission_decision",
        params: safeAgentValue(decision, profile),
      });
  }
}

export interface AgentSession {
  sessionId?: string;
  ahpSession?: AhpSessionIdentity;
  continuing?: boolean;
  onSession?: (
    id: string,
    mode: "new" | "resumed" | "new-without-session-id",
    ahpSession?: AhpSessionIdentity,
  ) => Promise<void>;
}

export async function executeAgent(
  input: AgentInput,
  signal: AbortSignal,
  profile: AgentProfile,
  cwd: string,
  onUpdate?: (update: unknown) => Promise<void>,
  session: AgentSession = {},
): Promise<AgentOutcome> {
  if (profile.type === "acp")
    return executeAcpAgent(input, signal, profile, cwd, onUpdate, session);
  if (session.sessionId !== undefined && session.ahpSession?.sessionUri !== session.sessionId)
    throw new CliError(
      "Persisted AHP session identity is missing or inconsistent; no replacement was created.",
      6,
      "ahp-error",
    );
  const authorizationRequests: AuthorizationRequest[] = [];
  const response = safeAgentValue(
    await executeAhp(profile, agentPrompt(input), cwd, signal, {
      ...(session.ahpSession === undefined ? {} : { session: session.ahpSession }),
      ...(session.continuing === undefined ? {} : { continuing: session.continuing }),
      onSession: async (identity, mode) => {
        await session.onSession?.(identity.sessionUri, mode, identity);
      },
      onUpdate: async (update) => {
        await onUpdate?.(safeAgentValue(update, profile));
      },
      onPermission: async (pending) => {
        if (profile.confirmations === "external") {
          await onUpdate?.(
            safeAgentValue(
              {
                timestamp: new Date().toISOString(),
                method: "pguide/ahp-external-confirmation",
                params: { ...pending, status: "awaiting-external-decision" },
              },
              profile,
            ),
          );
          return;
        }
        const request = unknownPermissionRequest(
          authorizationRequests.length + 1,
          "unsupported-ahp-operation-and-once-semantics",
        );
        authorizationRequests.push(request);
        await onUpdate?.({
          timestamp: new Date().toISOString(),
          method: "pguide/permission_decision",
          params: { decision: "denied", request },
        });
      },
    }),
    profile,
  );
  if (profile.confirmations === "external" && (response.permissionDenials ?? 0) > 0)
    authorizationRequests.push(
      unknownPermissionRequest(
        authorizationRequests.length + 1,
        "external-ahp-confirmation-denied",
      ),
    );
  if (response.status === "completed")
    return {
      status: "completed",
      summary: response.summary,
      ...(authorizationRequests.length === 0 ? {} : { authorizationRequests }),
    };
  if (authorizationRequests.length > 0)
    return {
      status: "authorization-required",
      reason: "AHP requests explicit authorization with unsupported operation/once semantics.",
      authorizationRequests,
    };
  if (response.status === "blocked") return { status: "blocked", reason: response.summary };
  return { status: "failed", reason: response.summary };
}

async function save(root: string, regulation: Regulation, attempt: Attempt): Promise<void> {
  const safe = {
    ...safeAgentValue({ ...regulation, subject: undefined }, regulation.agentProfile),
    subject: regulation.subject,
  };
  await atomicWrite(join(root, "regulation.json"), `${JSON.stringify(safe, null, 2)}\n`);
  await atomicWrite(
    join(root, "attempts", `${attempt.id}.json`),
    `${JSON.stringify(safeAgentValue(attempt, regulation.agentProfile), null, 2)}\n`,
  );
}

function code(reason: string): number {
  if (reason === "target-reached") return 0;
  if (reason === "dependency-required") return 3;
  if (reason === "authorization-required") return 3;
  if (reason === "exhausted" || reason === "cancelled") return 5;
  return 6;
}

export function regulationInputGuidance(error: RegulationError): string | undefined {
  const visited = new Set<unknown>();
  let cause = error.cause;
  while (cause instanceof Error && !visited.has(cause)) {
    visited.add(cause);
    if (cause instanceof CliError && cause.humanMessage !== undefined) return cause.humanMessage;
    if (
      cause instanceof ObjectiveConfigurationError &&
      "details" in cause &&
      cause.details !== null &&
      typeof cause.details === "object" &&
      "kind" in cause.details &&
      cause.details.kind === "language" &&
      "supported" in cause.details &&
      Array.isArray(cause.details.supported) &&
      cause.details.supported.every((language): language is string => typeof language === "string")
    )
      return [
        `Supported languages: ${cause.details.supported.map(markdownInlineCode).join(", ")}.`,
        "Next: choose a supported --language for a new regulation, or omit it to use the Objective default. Continue retains the original language.",
      ].join("\n\n");
    cause = cause.cause;
  }
  return undefined;
}

export function regulationMarkdown(input: {
  regulationId: string;
  objectiveId: string;
  targetLevel: string;
  status: string;
  outcome?: RegulationOutcome;
  quota: {
    readonly timeoutMs: number;
    readonly maxAgentRuns: number;
    readonly maxStallRuns: number;
  };
  statePath: string;
  reportPath?: string;
  recoveryCommand: string;
}): string {
  const observation = input.outcome?.latestObservation;
  const lines = [
    "# Regulation",
    "",
    `- Run: ${markdownInlineCode(input.regulationId)}`,
    `- Objective: ${markdownInlineCode(input.objectiveId)}`,
    `- Status: ${markdownText(input.status)}`,
    `- Target level: ${markdownInlineCode(input.targetLevel)}`,
    `- Current level: ${observation?.payload == null ? "not available" : markdownInlineCode(observation.payload.current.levelId)}`,
    `- Stop reason: ${markdownText(input.status)}${input.outcome?.exhaustedBy === undefined ? "" : ` (${markdownText(input.outcome.exhaustedBy)})`}.`,
    `- Iterations: ${input.outcome?.iterations ?? "not available"}`,
    `- Stalled runs: ${input.outcome?.stalledRuns ?? "not available"} (retained across attempts).`,
    `- Attempt quota: ${input.quota.timeoutMs} ms; ${input.quota.maxAgentRuns} Agent ${input.quota.maxAgentRuns === 1 ? "run" : "runs"}; ${input.quota.maxStallRuns} additional stalled ${input.quota.maxStallRuns === 1 ? "run" : "runs"}.`,
    `- State: ${markdownInlineCode(input.statePath)}`,
  ];
  if (input.reportPath !== undefined)
    lines.push(`- Report: ${markdownInlineCode(input.reportPath)}`);
  if (input.outcome?.stopReason === "dependency-required")
    for (const dependency of input.outcome.dependencies)
      lines.push(
        `- Required dependency: ${markdownInlineCode(dependency.objectiveId)}; current ${markdownInlineCode(dependency.currentLevelId)}; required ${markdownInlineCode(dependency.expectedLevelId)}.`,
      );
  if (input.status === "authorization-required")
    lines.push("- Action required: review configured permission grants before continuing.");
  if (input.status === "exhausted")
    lines.push("- Outcome: target not reached within this attempt's quota.");
  else if (input.status === "target-reached")
    lines.push(
      input.targetLevel === "terminal"
        ? "- Outcome: Objective complete - terminal reached."
        : "- Outcome: requested target reached; the Objective is not necessarily terminal.",
    );
  else if (input.status === "cancelled")
    lines.push("- Outcome: attempt cancelled; target completion is not established.");
  if (observation?.payload === null)
    lines.push(`- Observation failure: ${markdownText(observation.message)}`);
  lines.push(
    `- Continue command: ${markdownInlineCode(input.recoveryCommand)}`,
    `- Next action: ${input.status === "target-reached" ? "no continuation is needed for this target." : "resolve the stop condition, then use the continue command with the same configuration and working directory."}`,
  );
  return lines.join("\n");
}

async function run(
  regulation: Regulation,
  globals: GlobalOptions,
  reportPath?: string,
  prepared?: { spec: PilotSpec; runtime: PilotRuntime },
  continuing = false,
): Promise<number> {
  const config = (await loadConfig(globals.cwd, ["regulate", "pilot", "cli-core"])).value;
  // Persisted ceilings are audit snapshots, never authority for a new attempt.
  const permissions = makeRegulationPermissions(
    requiredSetting<RegulationPermissions>(config, "regulate.permissions"),
  );
  regulation.permissions = permissions;
  const root = join(stateRoot(config), "regulations", regulation.regulationId);
  await ensurePrivateDirectory(root);
  if (digest(regulation.subject) !== regulation.subjectDigest)
    throw new CliError("Stored subject digest mismatch.", 6, "io-error");
  regulation.agentProfile = validateAgentProfile(regulation.agentProfile);
  const attempt: Attempt = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    observations: [],
    actions: [],
    resumeMode: "not-needed",
    permissions,
  };
  regulation.attempts.push(attempt);
  await save(root, regulation, attempt);
  // Observation callbacks are synchronous; drain serialized writes before execution/finalization.
  let persistence = Promise.resolve();
  const persist = () => {
    persistence = persistence.then(() => save(root, regulation, attempt));
    void persistence.catch(() => {});
    return persistence;
  };
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Regulation cancelled."));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  let outcome: RegulationOutcome | undefined;
  const executions: Promise<AgentOutcome>[] = [];
  try {
    const execute = async (objective: PilotSpec, runtime: PilotRuntime) => {
      if (
        objective.objectiveId !== regulationObjective(regulation) ||
        objective.version !== objectiveSourceVersion(regulation.objectiveSource) ||
        JSON.stringify(objective.source) !== JSON.stringify(regulation.objectiveSource)
      )
        throw new CliError(
          "Recovery source does not match the pinned Pilot identity and commit; no newer version was selected.",
          6,
          "pilot-error",
        );
      const quota = regulation.regulationStrategy?.quota ?? defaultRegulationQuota;
      const spec = makeRegulatorSpec(
        objective,
        {
          ...regulation.regulationStrategy,
          quota: {
            ...quota,
            maxStallRuns: quota.maxStallRuns + (regulation.history?.stalledRuns ?? 0),
          },
          targetLevel: regulation.targetLevel,
          agentExecutionLimits: regulation.agentExecutionLimits,
        },
        { id: regulation.agentName },
      );
      const operation = startEffect(
        regulate(
          {
            spec,
            subject: regulation.subject,
            permissions,
            ...(regulation.history === undefined ? {} : { history: regulation.history }),
            ...(regulation.language === undefined ? {} : { language: regulation.language }),
          },
          {
            pilot: runtime,
            executeAgent: async (input, signal) => {
              await persistence;
              const execution = executeAgent(
                input,
                signal,
                regulation.agentProfile,
                globals.cwd,
                async (update) => {
                  await appendFile(
                    join(root, "transcript.jsonl"),
                    `${JSON.stringify(safeAgentValue(update, regulation.agentProfile))}\n`,
                    { mode: 0o600 },
                  );
                },
                {
                  ...(regulation.sessionId === undefined
                    ? {}
                    : { sessionId: regulation.sessionId }),
                  ...(regulation.ahpSession === undefined
                    ? {}
                    : { ahpSession: regulation.ahpSession }),
                  continuing,
                  onSession: async (id, mode, ahpSession) => {
                    regulation.sessionId = id;
                    attempt.sessionId = id;
                    attempt.resumeMode = mode;
                    if (ahpSession !== undefined) {
                      regulation.ahpSession = ahpSession;
                      attempt.ahpSession = ahpSession;
                    }
                    await persist();
                  },
                },
              );
              executions.push(execution);
              const result = await execution;
              attempt.actions.push(result);
              await persist();
              return result;
            },
            onObservation: (observation) => {
              for (const bound of runtime.boundObjectives?.() ?? []) {
                if (bound.source !== undefined)
                  regulation.sourceBindings[bound.objectiveId] = bound.source;
              }
              attempt.observations.push(observation);
              void persist();
            },
          },
        ),
        controller.signal,
      );
      const exit = await operation.exit();
      return Exit.hasInterrupts(exit) ? undefined : operation.await();
    };
    if (prepared === undefined) {
      let location = regulationObjective(regulation);
      if (regulation.sourcePath !== undefined) {
        try {
          await stat(regulation.sourcePath);
          location = regulation.sourcePath;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      try {
        outcome = await withPilot(location, globals.cwd, regulation.objectiveCommit, execute, {
          propagateError: (cause) => cause instanceof RegulationError,
          versions: Object.fromEntries(
            Object.entries(regulation.sourceBindings).map(([id, source]) => [
              id,
              objectiveSourceVersion(source),
            ]),
          ),
          sources: regulation.sourceBindings,
          ...pilotSourceBudgets(regulation.regulationStrategy?.probe),
          signal: controller.signal,
          reports: reportOptions([], config, globals.cwd),
          packageSpecs: requiredSetting<Record<string, string>>(config, "objectives.aliases"),
        });
      } catch (cause) {
        if (controller.signal.aborted) throw cause;
        if (cause instanceof RegulationError) throw cause;
        const message = `Cannot restore pinned Pilot commit ${regulation.objectiveCommit}: ${cause instanceof Error ? cause.message : String(cause)} No source version was substituted.`;
        throw new CliError(
          message,
          6,
          "pilot-error",
          undefined,
          cause instanceof CliError && cause.humanMessage !== undefined
            ? `${markdownText(message)}\n\n${cause.humanMessage}`
            : undefined,
        );
      }
    } else outcome = await execute(prepared.spec, prepared.runtime);
    attempt.status = outcome?.stopReason ?? "cancelled";
    if (outcome !== undefined) regulation.history = { stalledRuns: outcome.stalledRuns };
  } catch (error) {
    attempt.status = controller.signal.aborted ? "cancelled" : "failed";
    if (error instanceof RegulationError) {
      const inputGuidance = regulationInputGuidance(error);
      throw new CliError(
        error.message,
        error.status < 500 ? 2 : 6,
        "regulation-error",
        undefined,
        safeAgentValue(
          `Regulation failed for Objective ${markdownInlineCode(regulationObjective(regulation))}, target ${markdownInlineCode(regulation.targetLevel)}: ${markdownText(safeAgentValue(error.message, regulation.agentProfile))} State: ${markdownInlineCode(join(root, "regulation.json"))}.${inputGuidance === undefined ? ` Inspect the failing check/report before running ${markdownInlineCode(`pguide continue ${regulation.regulationId}`)} with the same configuration and working directory.` : `\n\n${safeAgentValue(inputGuidance, regulation.agentProfile)}`}`,
          regulation.agentProfile,
        ),
      );
    }
    if (!controller.signal.aborted) throw error;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    // The feedback-loop deadline can finish before protocol cancellation cleanup.
    await Promise.allSettled(executions);
    await persistence;
    attempt.completedAt = new Date().toISOString();
    await save(root, regulation, attempt);
  }
  const value = safeAgentValue(
    {
      schemaVersion: 2,
      regulationId: regulation.regulationId,
      status: attempt.status,
      outcome,
      attempts: regulation.attempts,
      recovery: { command: `pguide continue ${regulation.regulationId}` },
    },
    regulation.agentProfile,
  );
  if (reportPath !== undefined)
    await atomicWrite(resolve(globals.cwd, reportPath), `${JSON.stringify(value, null, 2)}\n`);
  writeResult(
    value,
    globals.format,
    globals.format === "json"
      ? ""
      : regulationMarkdown(
          safeAgentValue(
            {
              regulationId: regulation.regulationId,
              objectiveId: regulationObjective(regulation),
              targetLevel: regulation.targetLevel,
              status: attempt.status ?? "failed",
              ...(outcome === undefined ? {} : { outcome }),
              quota: regulation.regulationStrategy?.quota ?? defaultRegulationQuota,
              statePath: join(root, "regulation.json"),
              ...(reportPath === undefined ? {} : { reportPath: resolve(globals.cwd, reportPath) }),
              recoveryCommand: value.recovery.command,
            },
            regulation.agentProfile,
          ),
        ),
  );
  return code(attempt.status ?? "failed");
}

export async function runRegulate(
  argv: string[],
  globals: GlobalOptions,
): Promise<number | undefined> {
  if (globals.help) {
    showCommandHelp("regulate", globals);
    return;
  }
  rejectUnknownOptions(argv, {
    "--pilot": "value",
    "--objective": "value",
    "--scope": "value",
    "--input-file": "value",
    "--subject-file": "value",
    "--target": "value",
    "--agent": "value",
    "--language": "value",
    "--agent-timeout-ms": "value",
    "--revision": "value",
    "--report": "value",
  });
  const loaded = await loadConfig(globals.cwd, [
    "regulate",
    "pilot",
    "cli-core",
    "agents",
    "objectives",
  ]);
  await pruneExpiredRegulations(stateRoot(loaded.value));
  const targetLevel = option(argv, "--target", { required: true }) as string;
  const intrinsic = targetLevel === "initial";
  const agentName = intrinsic
    ? "$intrinsic-initial"
    : ((option(argv, "--agent") as string | undefined) ??
      setting<string>(loaded.value, "agents.defaultAgent"));
  if (agentName === undefined)
    throw new CliError("--agent is required when agents.defaultAgent is not configured.");
  // Retain the ordinary durable Regulation lifecycle without requiring an Agent
  // profile for intrinsic validation. This defensive binding is never executed.
  const profile: AgentProfile | undefined = intrinsic
    ? {
        type: "acp",
        connection: { protocolVersion: "1" },
        transport: {
          type: "stdio",
          command: process.execPath,
          args: ["-e", "throw new Error('initial must never execute an Agent')"],
        },
      }
    : (await loadAgents(globals.cwd)).agents[agentName];
  if (profile === undefined) throw new CliError(`Unknown Agent profile: ${agentName}.`);
  validateAgentProfile(profile);
  const language = option(argv, "--language") as string | undefined;
  const timeout = option(argv, "--agent-timeout-ms") as string | undefined;
  const timeoutMs =
    timeout === undefined
      ? requiredSetting<number>(loaded.value, "regulate.agentTimeoutMs")
      : Number(timeout);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    throw new CliError("--agent-timeout-ms must be a positive integer no greater than 2147483647.");
  const selected = await selectObjective(argv, globals, loaded.value);
  const location = selected.location;
  return withPilot(
    location,
    globals.cwd,
    option(argv, "--revision") as string | undefined,
    async (spec, runtime) => {
      const subject = await selected.subject(spec);
      if (spec.source === undefined)
        throw new CliError("Regulation requires Git directory source evidence.");
      const initialSources: Record<string, ObjectiveSource> = {};
      for (const bound of runtime.boundObjectives?.() ?? [spec])
        if (bound.source !== undefined) initialSources[bound.objectiveId] = bound.source;
      const regulation: Regulation = {
        schemaVersion:
          spec.source.kind === "artifact-service-v1"
            ? 7
            : spec.source.kind === "objective-artifact"
              ? 6
              : spec.source.kind === "npm-package"
                ? 5
                : 4,
        regulationId: randomUUID(),
        createdAt: new Date().toISOString(),
        ...(spec.source.kind === "objective-artifact" || spec.source.kind === "artifact-service-v1"
          ? { objectiveId: spec.objectiveId, objectiveArtifactDigest: spec.version }
          : spec.source.kind === "npm-package"
            ? { objectiveId: spec.objectiveId, objectivePackageDigest: spec.version }
            : {
                objectiveUri: spec.objectiveId,
                objectiveCommit: spec.source.commit,
                objectiveTree: spec.version,
              }),
        objectiveSource: spec.source,
        sourceBindings: initialSources,
        ...(selected.binding === undefined ? {} : { binding: selected.binding }),
        ...(spec.source.kind !== "git-tree" || location.startsWith("git+")
          ? {}
          : { sourcePath: resolve(globals.cwd, location) }),
        subject,
        subjectDigest: digest(subject),
        targetLevel,
        ...(language === undefined ? {} : { language }),
        agentName,
        agentProfile: profile,
        agentExecutionLimits: { timeoutMs },
        regulationStrategy: {
          probe: requiredSetting<NonNullable<RegulationStrategy["probe"]>>(
            loaded.value,
            "pilot.probe",
          ),
          quota: requiredSetting<RegulationStrategy["quota"]>(loaded.value, "regulate.quota"),
        },
        ...(setting<number>(loaded.value, "regulate.retentionDays") === undefined
          ? {}
          : {
              expiresAt: new Date(
                Date.now() +
                  requiredSetting<number>(loaded.value, "regulate.retentionDays") * 86_400_000,
              ).toISOString(),
            }),
        attempts: [],
      };
      return run(regulation, globals, option(argv, "--report") as string | undefined, {
        spec,
        runtime,
      });
    },
    {
      ...pilotSourceBudgets(
        requiredSetting<NonNullable<RegulationStrategy["probe"]>>(loaded.value, "pilot.probe"),
      ),
      propagateError: (cause) => cause instanceof RegulationError,
      reports: reportOptions([], loaded.value, globals.cwd),
      packageSpecs: requiredSetting<Record<string, string>>(loaded.value, "objectives.aliases"),
    },
  );
}

export async function runContinue(
  argv: string[],
  globals: GlobalOptions,
): Promise<number | undefined> {
  if (globals.help) {
    showCommandHelp("continue", globals);
    return;
  }
  rejectUnknownOptions(argv, { "--report": "value" }, 1);
  const id = argv[0];
  if (id === undefined || !/^[0-9a-f-]{36}$/.test(id))
    throw new CliError("A valid regulation ID is required.");
  const loaded = await loadConfig(globals.cwd, ["cli-core", "pilot", "regulate"]);
  await loadAgents(globals.cwd);
  await pruneExpiredRegulations(stateRoot(loaded.value));
  const path = join(stateRoot(loaded.value), "regulations", id, "regulation.json");
  const record: unknown = JSON.parse(await readFile(path, "utf8"));
  if (
    record === null ||
    typeof record !== "object" ||
    !("schemaVersion" in record) ||
    (record.schemaVersion !== 4 &&
      record.schemaVersion !== 5 &&
      record.schemaVersion !== 6 &&
      record.schemaVersion !== 7)
  )
    throw new CliError(
      "Legacy continue records are incompatible with cumulative attainment or missing directory tree/commit evidence. Review the v2 Objective and target, then start a new regulation with --pilot <directory> or --objective; pinned evidence is not rebound.",
    );
  const regulation = record as Regulation;
  if (
    ["pilot", "pilotUri", "pilotCommit", "pilotTree", "pilotSource"].some((key) =>
      Object.hasOwn(record, key),
    ) ||
    (regulation.binding !== undefined &&
      (regulation.binding === null ||
        !Object.hasOwn(Object(regulation.binding.entry), "objective") ||
        Object.hasOwn(Object(regulation.binding.entry), "pilot") ||
        !Object.hasOwn(Object(regulation.binding.context), "repo") ||
        !Object.hasOwn(Object(regulation.binding.context), "path")))
  )
    throw new CliError(
      "Legacy Objective references/context in recovery records are incompatible. Explicitly migrate and commit the Objective, then start a new regulation; never rewrite or substitute pinned commit/tree/source evidence.",
      6,
      "io-error",
    );
  const objectiveId =
    regulation.schemaVersion !== 4 ? regulation.objectiveId : regulation.objectiveUri;
  if (
    regulation.regulationId !== id ||
    typeof objectiveId !== "string" ||
    (regulation.schemaVersion === 7
      ? regulation.objectiveUri !== undefined ||
        regulation.objectiveSource?.kind !== "artifact-service-v1" ||
        regulation.objectiveSource.digest !== regulation.objectiveArtifactDigest ||
        regulation.objectivePackageDigest !== undefined ||
        regulation.objectiveCommit !== undefined ||
        regulation.objectiveTree !== undefined
      : regulation.schemaVersion === 6
        ? regulation.objectiveUri !== undefined ||
          regulation.objectiveSource?.kind !== "objective-artifact" ||
          regulation.objectiveSource.artifactDigest !== regulation.objectiveArtifactDigest ||
          regulation.objectivePackageDigest !== undefined ||
          regulation.objectiveCommit !== undefined ||
          regulation.objectiveTree !== undefined
        : regulation.objectiveArtifactDigest !== undefined ||
          (regulation.schemaVersion === 4
            ? regulation.objectiveId !== undefined ||
              regulation.objectivePackageDigest !== undefined ||
              !objectiveId.startsWith("git+") ||
              !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(regulation.objectiveCommit ?? "") ||
              regulation.objectiveSource?.kind !== "git-tree" ||
              regulation.objectiveSource.commit !== regulation.objectiveCommit ||
              regulation.objectiveSource.tree !== regulation.objectiveTree
            : regulation.objectiveUri !== undefined ||
              regulation.objectiveSource?.kind !== "npm-package" ||
              regulation.objectiveSource.packageDigest !== regulation.objectivePackageDigest ||
              regulation.objectiveCommit !== undefined ||
              regulation.objectiveTree !== undefined)) ||
    JSON.stringify(regulation.sourceBindings?.[objectiveId]) !==
      JSON.stringify(regulation.objectiveSource) ||
    !Array.isArray(regulation.attempts) ||
    !Number.isSafeInteger(regulation.agentExecutionLimits?.timeoutMs) ||
    regulation.agentExecutionLimits.timeoutMs < 1
  )
    throw new CliError("Invalid Pilot regulation recovery record.", 6, "io-error");
  try {
    validatePilotSource(
      objectiveId,
      objectiveSourceVersion(regulation.objectiveSource),
      regulation.objectiveSource,
    );
    if (
      regulation.sourceBindings === null ||
      typeof regulation.sourceBindings !== "object" ||
      Array.isArray(regulation.sourceBindings)
    )
      throw new Error("Invalid source binding table.");
    for (const [id, source] of Object.entries(regulation.sourceBindings))
      validatePilotSource(id, objectiveSourceVersion(source), source);
  } catch {
    throw new CliError(
      "Invalid directory commit/tree recovery evidence. Start a new regulation; no source version was substituted.",
      6,
      "io-error",
    );
  }
  if (
    regulation.sourcePath !== undefined &&
    (typeof regulation.sourcePath !== "string" || !isAbsolute(regulation.sourcePath))
  )
    throw new CliError(
      "Recovery sourcePath must be an absolute local path, not an Objective identity.",
      6,
      "io-error",
    );
  const sessionId =
    regulation.sessionId ??
    [...regulation.attempts].reverse().find((attempt) => attempt.sessionId !== undefined)
      ?.sessionId;
  if (sessionId !== undefined) {
    if (typeof sessionId !== "string" || sessionId.trim() === "")
      throw new CliError("Invalid persisted Agent session ID.", 6, "io-error");
    regulation.sessionId = sessionId;
  }
  return run(regulation, globals, option(argv, "--report") as string | undefined, undefined, true);
}
