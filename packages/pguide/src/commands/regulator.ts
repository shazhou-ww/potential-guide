import { randomUUID } from "node:crypto";
import { appendFile, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  AcpClient,
  type AgentProfile,
  agentSecretValues,
  atomicWrite,
  CliError,
  digest,
  ensurePrivateDirectory,
  type GlobalOptions,
  loadConfig,
  option,
  type PguideConfig,
  pruneExpiredRegulations,
  readJsonSubject,
  redactSensitive,
  rejectUnknownOptions,
  stateRoot,
  validateAgentProfile,
  writeResult,
} from "@potential-guide/cli-core";
import { Exit, startEffect } from "@potential-guide/effects";
import type {
  Envelope,
  PilotObservation,
  PilotRuntime,
  PilotSpec,
  Subject,
} from "@potential-guide/objective-pilot";
import {
  type AgentInput,
  type AgentOutcome,
  makeRegulatorSpec,
  type RegulationOutcome,
  regulate,
} from "@potential-guide/objective-regulator";
import { withPilot } from "../pilot-source.js";

export const regulatorCommandVersion = "0.3.0-rc.0";

interface Attempt {
  id: string;
  startedAt: string;
  completedAt?: string;
  status?: string;
  sessionId?: string;
  resumeMode?: "new" | "resumed" | "new-without-session-id" | "not-needed";
  observations: Envelope<PilotObservation>[];
  actions: AgentOutcome[];
}

interface Regulation {
  schemaVersion: 2;
  regulationId: string;
  createdAt: string;
  pilotUri: string;
  pilotCommit: string;
  sourcePath?: string;
  subject: Subject;
  subjectDigest: string;
  targetLevel: string;
  language?: string;
  agentName: string;
  agentProfile: AgentProfile;
  agentExecutionLimits: { timeoutMs: number };
  regulationStrategy?: PguideConfig["regulationStrategy"];
  sessionId?: string;
  expiresAt?: string;
  attempts: Attempt[];
}

export function agentPrompt(input: AgentInput): string {
  return `Potential Guide regulation\nTarget: ${JSON.stringify(input.target)}\nSubject: ${JSON.stringify(input.subject)}\nComplete observation: ${JSON.stringify(input.observation)}\nAgent execution limits: ${JSON.stringify(input.limits)}\nAddress the complete observation. Organize any repair tasks yourself. Do not claim objective progress; pguide re-observes after your execution.`;
}

function safeAgentValue<T>(value: T, profile: AgentProfile): T {
  const secrets = agentSecretValues(profile);
  const visit = (current: unknown): unknown => {
    if (typeof current === "string") {
      let safe = current;
      for (const secret of secrets) safe = safe.split(secret).join("[REDACTED]");
      return safe;
    }
    if (Array.isArray(current)) return current.map(visit);
    if (current !== null && typeof current === "object")
      return Object.fromEntries(Object.entries(current).map(([key, entry]) => [key, visit(entry)]));
    return current;
  };
  return redactSensitive(visit(value) as T);
}

export async function executeAcpAgent(
  input: AgentInput,
  signal: AbortSignal,
  profile: AgentProfile,
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
  const client = new AcpClient(profile, onUpdate);
  let sessionId: string | undefined;
  let stopping: Promise<void> | undefined;
  const abort = () => {
    stopping = sessionId === undefined ? client.stop() : client.cancelAndStop(sessionId);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const initialized = await client.initialize(profile.connection.protocolVersion);
    signal.throwIfAborted();
    if (
      initialized.protocolVersion !== undefined &&
      String(initialized.protocolVersion) !== profile.connection.protocolVersion
    )
      throw new CliError(
        "ACP protocol negotiation selected an unsupported version.",
        6,
        "acp-error",
      );
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
    return response.status === "completed"
      ? { status: "completed", summary: response.summary }
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
  }
}

async function save(root: string, regulation: Regulation, attempt: Attempt): Promise<void> {
  const safe = {
    ...redactSensitive({ ...regulation, subject: undefined }),
    subject: regulation.subject,
  };
  await atomicWrite(join(root, "regulation.json"), `${JSON.stringify(safe, null, 2)}\n`);
  await atomicWrite(
    join(root, "attempts", `${attempt.id}.json`),
    `${JSON.stringify(redactSensitive(attempt), null, 2)}\n`,
  );
}

function code(reason: string): number {
  if (reason === "target-reached") return 0;
  if (reason === "agent-blocked" || reason === "no-actionable-problem") return 3;
  if (reason === "agent-limit-reached" || reason === "cancelled" || reason === "effect-ttl-reached")
    return 5;
  return 6;
}

async function run(
  regulation: Regulation,
  globals: GlobalOptions,
  reportPath?: string,
  prepared?: { spec: PilotSpec; runtime: PilotRuntime },
  continuing = false,
): Promise<number> {
  const root = join(
    stateRoot((await loadConfig(globals.cwd, globals.config)).value),
    "regulations",
    regulation.regulationId,
  );
  await ensurePrivateDirectory(root);
  if (digest(regulation.subject) !== regulation.subjectDigest)
    throw new CliError("Stored subject digest mismatch.", 6, "io-error");
  validateAgentProfile(regulation.agentProfile);
  const attempt: Attempt = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    observations: [],
    actions: [],
    resumeMode: "not-needed",
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
  try {
    const execute = async (pilot: PilotSpec, runtime: PilotRuntime) => {
      if (pilot.objectiveId !== regulation.pilotUri || pilot.version !== regulation.pilotCommit)
        throw new CliError(
          "Recovery source does not match the pinned Pilot identity and commit; no newer version was selected.",
          6,
          "pilot-error",
        );
      const spec = makeRegulatorSpec(
        pilot,
        {
          ...regulation.regulationStrategy,
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
            ...(regulation.language === undefined ? {} : { language: regulation.language }),
          },
          {
            pilot: runtime,
            executeAgent: async (input, signal) => {
              await persistence;
              const result = await executeAcpAgent(
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
                  continuing,
                  onSession: async (id, mode) => {
                    regulation.sessionId = id;
                    attempt.sessionId = id;
                    attempt.resumeMode = mode;
                    await persist();
                  },
                },
              );
              attempt.actions.push(result);
              await persist();
              return result;
            },
            onObservation: (observation) => {
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
      let location = regulation.pilotUri;
      if (regulation.sourcePath !== undefined) {
        try {
          await stat(regulation.sourcePath);
          location = regulation.sourcePath;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      try {
        outcome = await withPilot(location, globals.cwd, regulation.pilotCommit, execute);
      } catch (cause) {
        if (controller.signal.aborted) throw cause;
        throw new CliError(
          `Cannot restore pinned Pilot commit ${regulation.pilotCommit}: ${cause instanceof Error ? cause.message : String(cause)} No source version was substituted.`,
          6,
          "pilot-error",
        );
      }
    } else outcome = await execute(prepared.spec, prepared.runtime);
    attempt.status =
      outcome?.stopReason ??
      (controller.signal.aborted || regulation.regulationStrategy?.effectTtlMs === undefined
        ? "cancelled"
        : "effect-ttl-reached");
  } catch (error) {
    attempt.status = controller.signal.aborted ? "cancelled" : "failed";
    if (!controller.signal.aborted) throw error;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    await persistence;
    attempt.completedAt = new Date().toISOString();
    await save(root, regulation, attempt);
  }
  const value = redactSensitive({
    schemaVersion: 2,
    regulationId: regulation.regulationId,
    status: attempt.status,
    outcome,
    attempts: regulation.attempts,
    recovery: { command: `pguide continue ${regulation.regulationId}` },
  });
  if (reportPath !== undefined)
    await atomicWrite(resolve(globals.cwd, reportPath), `${JSON.stringify(value, null, 2)}\n`);
  writeResult(value, globals.format, `Regulation ${regulation.regulationId}: ${attempt.status}.`);
  return code(attempt.status ?? "failed");
}

export async function runRegulate(
  argv: string[],
  globals: GlobalOptions,
): Promise<number | undefined> {
  if (globals.help) {
    writeResult(
      { schemaVersion: 1, command: "regulate" },
      globals.format,
      "Usage: pguide regulate --pilot <path|Git URI> --subject-file <path|-> --target <level> [--agent <profile>] [--agent-timeout-ms <positive integer>] [--revision <ref|commit>]",
    );
    return;
  }
  rejectUnknownOptions(argv, {
    "--pilot": "value",
    "--subject-file": "value",
    "--target": "value",
    "--agent": "value",
    "--language": "value",
    "--agent-timeout-ms": "value",
    "--revision": "value",
    "--report": "value",
  });
  const loaded = await loadConfig(globals.cwd, globals.config);
  await pruneExpiredRegulations(stateRoot(loaded.value));
  const agentName = (option(argv, "--agent") as string | undefined) ?? loaded.value.defaultAgent;
  if (agentName === undefined)
    throw new CliError("--agent is required when defaultAgent is not configured.");
  const profile = loaded.value.agents?.[agentName];
  if (profile === undefined) throw new CliError(`Unknown Agent profile: ${agentName}.`);
  validateAgentProfile(profile);
  const subject = (await readJsonSubject(
    option(argv, "--subject-file", { required: true }) as string,
    globals.cwd,
  )) as Subject;
  const language = option(argv, "--language") as string | undefined;
  const timeout = option(argv, "--agent-timeout-ms") as string | undefined;
  const timeoutMs =
    timeout === undefined
      ? (loaded.value.agentExecutionLimits?.timeoutMs ?? 1_800_000)
      : Number(timeout);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    throw new CliError("--agent-timeout-ms must be a positive integer no greater than 2147483647.");
  const location = option(argv, "--pilot", { required: true }) as string;
  return withPilot(
    location,
    globals.cwd,
    option(argv, "--revision") as string | undefined,
    async (spec, runtime) => {
      const regulation: Regulation = {
        schemaVersion: 2,
        regulationId: randomUUID(),
        createdAt: new Date().toISOString(),
        pilotUri: spec.objectiveId,
        pilotCommit: spec.version,
        ...(location.startsWith("git+") ? {} : { sourcePath: resolve(globals.cwd, location) }),
        subject,
        subjectDigest: digest(subject),
        targetLevel: option(argv, "--target", { required: true }) as string,
        ...(language === undefined ? {} : { language }),
        agentName,
        agentProfile: profile,
        agentExecutionLimits: { timeoutMs },
        ...(loaded.value.regulationStrategy === undefined
          ? {}
          : { regulationStrategy: loaded.value.regulationStrategy }),
        ...(loaded.value.retentionDays === undefined
          ? {}
          : {
              expiresAt: new Date(
                Date.now() + loaded.value.retentionDays * 86_400_000,
              ).toISOString(),
            }),
        attempts: [],
      };
      return run(regulation, globals, option(argv, "--report") as string | undefined, {
        spec,
        runtime,
      });
    },
  );
}

export async function runContinue(
  argv: string[],
  globals: GlobalOptions,
): Promise<number | undefined> {
  if (globals.help) {
    writeResult(
      { schemaVersion: 1, command: "continue" },
      globals.format,
      "Usage: pguide continue <regulation-id> [--report <path>]",
    );
    return;
  }
  rejectUnknownOptions(argv, { "--report": "value" }, 1);
  const id = argv[0];
  if (id === undefined || !/^[0-9a-f-]{36}$/.test(id))
    throw new CliError("A valid regulation ID is required.");
  const loaded = await loadConfig(globals.cwd, globals.config);
  await pruneExpiredRegulations(stateRoot(loaded.value));
  const path = join(stateRoot(loaded.value), "regulations", id, "regulation.json");
  const record: unknown = JSON.parse(await readFile(path, "utf8"));
  if (
    record === null ||
    typeof record !== "object" ||
    !("schemaVersion" in record) ||
    record.schemaVersion !== 2
  )
    throw new CliError(
      "Legacy continue records are incompatible with Pilot regulation. Start a new regulation with --pilot.",
    );
  const regulation = record as Regulation;
  if (
    regulation.regulationId !== id ||
    typeof regulation.pilotUri !== "string" ||
    !regulation.pilotUri.startsWith("git+") ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(regulation.pilotCommit) ||
    !Array.isArray(regulation.attempts) ||
    !Number.isSafeInteger(regulation.agentExecutionLimits?.timeoutMs) ||
    regulation.agentExecutionLimits.timeoutMs < 1
  )
    throw new CliError("Invalid Pilot regulation recovery record.", 6, "io-error");
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
      throw new CliError("Invalid persisted ACP session ID.", 6, "io-error");
    regulation.sessionId = sessionId;
  }
  return run(regulation, globals, option(argv, "--report") as string | undefined, undefined, true);
}
