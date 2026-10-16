import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  AcpClient,
  type AgentProfile,
  agentSecretValues,
  atomicWrite,
  CliError,
  type CommandMetadata,
  commandMain,
  digest,
  digestTree,
  duration,
  ensurePrivateDirectory,
  type GlobalOptions,
  loadConfig,
  option,
  pruneExpiredRegulations,
  readJsonSubject,
  redactSensitive,
  rejectUnknownOptions,
  stateRoot,
  validateAgentProfile,
  writeResult,
} from "@potential-guide/cli-core";
import {
  createObjectiveLoader,
  type JsonObject,
  type ObjectiveObservation,
} from "@potential-guide/objective-guide";
import {
  createObjectiveRegulator,
  ObjectiveRegulatorTimeoutError,
  type RegulationResult,
} from "@potential-guide/objective-regulator";

export const regulatorCommandVersion = "0.2.0-rc.2";

interface Attempt {
  id: string;
  startedAt: string;
  completedAt?: string;
  limits: { maxIterations: number; maxStalledIterations: number; timeoutMs: number };
  sessionId?: string;
  resumeMode?: "new" | "resumed" | "new-with-summary" | "not-needed";
  status?: string;
  errorCategory?: "input" | "configuration" | "guide" | "agent-spawn" | "acp" | "io" | "internal";
  errorSummary?: string;
  observations: ObjectiveObservation[];
  actions: { problemId: string; status: string; summary: string }[];
}

export class InvocationTimeoutError extends Error {}
export class InvocationCancelledError extends Error {}

function expectedFailure(error: unknown): {
  category: NonNullable<Attempt["errorCategory"]>;
  failure: CliError;
} {
  if (error instanceof CliError) {
    const category =
      error.status === "acp-error"
        ? "acp"
        : error.status === "guide-error"
          ? "guide"
          : error.status === "io-error"
            ? "io"
            : error.status === "configuration-error"
              ? "configuration"
              : "input";
    return { category, failure: error };
  }
  const nodeError = error as NodeJS.ErrnoException;
  if (
    typeof nodeError?.code === "string" &&
    ["EACCES", "EISDIR", "ENOENT", "ENOTDIR", "EPERM", "EPIPE"].includes(nodeError.code)
  ) {
    const category = nodeError.code === "EACCES" ? "agent-spawn" : "io";
    return {
      category,
      failure: new CliError(
        error instanceof Error ? error.message : "I/O operation failed.",
        6,
        category === "agent-spawn" ? "agent-spawn-error" : "io-error",
      ),
    };
  }
  return {
    category: "internal",
    failure: new CliError(
      error instanceof Error ? error.message : "Internal regulation failure.",
      70,
      "internal-error",
    ),
  };
}

type CancellationRegistration = (cancel: () => void) => () => void;

function processCancellation(cancel: () => void): () => void {
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  return () => {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  };
}

export async function withinInvocation<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal, deadline: number) => Promise<T>,
  registerCancellation: CancellationRegistration = processCancellation,
): Promise<T> {
  const controller = new AbortController();
  const deadline = performance.now() + timeoutMs;
  const state: { owner: "running" | "completed" | "timed-out" | "cancelled" } = {
    owner: "running",
  };
  let result: T | undefined;
  let failure: unknown;
  let release!: () => void;
  const settled = new Promise<void>((resolveSettled) => {
    release = resolveSettled;
  });
  const claim = (next: Exclude<(typeof state)["owner"], "running">, reason?: Error) => {
    if (state.owner !== "running") return;
    state.owner = next;
    if (reason !== undefined) controller.abort(reason);
    release();
  };
  const timer = setTimeout(
    () => claim("timed-out", new InvocationTimeoutError("Regulation invocation timed out.")),
    Math.min(timeoutMs, 2_147_483_647),
  );
  const unregister = registerCancellation(() =>
    claim("cancelled", new InvocationCancelledError("Regulation invocation cancelled.")),
  );
  const work = operation(controller.signal, deadline).then(
    (value) => {
      result = value;
      claim("completed");
    },
    (error: unknown) => {
      failure = error;
      claim("completed");
    },
  );
  try {
    await settled;
    await work;
    if (state.owner === "timed-out")
      throw new InvocationTimeoutError("Regulation invocation timed out.");
    if (state.owner === "cancelled")
      throw new InvocationCancelledError("Regulation invocation cancelled.");
    if (failure !== undefined) throw failure;
    return result as T;
  } finally {
    clearTimeout(timer);
    unregister();
  }
}

interface Regulation {
  schemaVersion: 1;
  regulationId: string;
  createdAt: string;
  guidePath: string;
  guideRevision: string;
  subject: JsonObject;
  subjectDigest: string;
  targetLevelId: string;
  language?: string;
  agentName: string;
  agentProfile: AgentProfile;
  retentionDays?: number;
  expiresAt?: string;
  attempts: Attempt[];
}

function limits(argv: string[], config: Awaited<ReturnType<typeof loadConfig>>["value"]) {
  const maxIterations = Number(
    option(argv, "--max-iterations") ?? config.limits?.maxIterations ?? 8,
  );
  const maxStalledIterations = Number(
    option(argv, "--max-stalled-iterations") ?? config.limits?.maxStalledIterations ?? 2,
  );
  const timeoutMs =
    option(argv, "--timeout") === undefined
      ? (config.limits?.timeoutMs ?? 1_800_000)
      : duration(option(argv, "--timeout") as string);
  if (
    !Number.isSafeInteger(maxIterations) ||
    maxIterations < 1 ||
    !Number.isSafeInteger(maxStalledIterations) ||
    maxStalledIterations < 1
  )
    throw new CliError("Regulation limits must be positive integers.");
  return { maxIterations, maxStalledIterations, timeoutMs };
}

function exitCode(status: string): number {
  if (status === "target-reached" || status === "still-satisfied") return 0;
  if (status === "action-blocked" || status === "no-actionable-problem") return 3;
  if (status === "no-progress" || status === "max-iterations") return 4;
  if (status === "timed-out" || status === "cancelled") return 5;
  return 6;
}

async function save(root: string, regulation: Regulation, attempt: Attempt): Promise<void> {
  const safeRegulation = {
    ...redactSensitive({ ...regulation, subject: undefined }),
    subject: regulation.subject,
    subjectDigest: regulation.subjectDigest,
  };
  const safeAttempt = redactSensitive(attempt);
  await atomicWrite(join(root, "regulation.json"), `${JSON.stringify(safeRegulation, null, 2)}\n`);
  await atomicWrite(
    join(root, "attempts", `${attempt.id}.json`),
    `${JSON.stringify(safeAttempt, null, 2)}\n`,
  );
}

function actionPrompt(regulation: Regulation, observation: ObjectiveObservation): string {
  const problem = observation.problems[0];
  const history = regulation.attempts
    .flatMap((attempt) => attempt.actions)
    .slice(-5)
    .map((action) => `${action.problemId}: ${action.status} (${action.summary})`)
    .join("\n");
  return `Potential Guide regulation ${regulation.regulationId}\nTarget level: ${regulation.targetLevelId}\nCurrent level: ${observation.current.id}\nProblem: ${problem?.id ?? "none"}\nParameters: ${JSON.stringify(problem?.parameters ?? {})}\nRecent protocol-visible action summary:\n${history || "(none)"}\nPerform only the action needed for this problem. Do not claim objective progress; pguide will re-probe.`;
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
    if (current !== null && typeof current === "object") {
      return Object.fromEntries(Object.entries(current).map(([key, entry]) => [key, visit(entry)]));
    }
    return current;
  };
  return redactSensitive(visit(value) as T);
}

async function acpCall<T>(operation: Promise<T>, profile: AgentProfile): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof CliError) {
      throw new CliError(safeAgentValue(error.message, profile), error.exitCode, error.status);
    }
    throw new CliError(
      safeAgentValue(error instanceof Error ? error.message : "ACP operation failed.", profile),
      6,
      "acp-error",
    );
  }
}

function safeSessionId(sessionId: string, profile: AgentProfile): string {
  const safe = safeAgentValue(sessionId, profile);
  if (safe !== sessionId) {
    throw new CliError("ACP sessionId contained credential material.", 6, "acp-error");
  }
  return sessionId;
}

async function loadGuide(path: string) {
  try {
    return await createObjectiveLoader().load(path);
  } catch (error) {
    throw new CliError(
      error instanceof Error ? error.message : "Guide could not be loaded.",
      2,
      "guide-error",
    );
  }
}

async function runAttempt(
  regulation: Regulation,
  attempt: Attempt,
  root: string,
  cwd: string,
  resume: boolean,
  signal: AbortSignal,
  deadline: number,
): Promise<
  | RegulationResult
  | {
      status: "still-satisfied";
      iterations: 0;
      latestObservation: ObjectiveObservation;
      targetLevelId: string;
    }
> {
  const abortedError = () =>
    signal.reason instanceof InvocationCancelledError
      ? signal.reason
      : new InvocationTimeoutError("Regulation invocation timed out.");
  const throwIfAborted = () => {
    if (signal.aborted) throw abortedError();
  };
  if ((await digestTree(regulation.guidePath)) !== regulation.guideRevision)
    throw new CliError("Guide revision changed; create a new Regulation.", 2, "guide-error");
  throwIfAborted();
  if (digest(regulation.subject) !== regulation.subjectDigest)
    throw new CliError("Stored subject digest mismatch.", 6, "io-error");
  const guide = await loadGuide(regulation.guidePath);
  throwIfAborted();
  const created = guide.createInstance({
    subject: regulation.subject,
    ...(regulation.language ? { language: regulation.language } : {}),
  });
  if (!created.ok) throw new CliError(`Cannot restore Guide instance: ${created.error.type}.`);
  const regulator = createObjectiveRegulator(created.instance);
  let initial: ObjectiveObservation;
  try {
    initial = await created.instance.probe(signal);
  } catch (error) {
    if (signal.aborted) throw abortedError();
    throw new CliError(
      error instanceof Error ? error.message : "Guide probe failed.",
      2,
      "guide-error",
    );
  }
  throwIfAborted();
  attempt.observations.push(initial);
  await save(root, regulation, attempt);
  const levels = created.instance.describeLevels();
  const currentIndex = levels.findIndex((level) => level.id === initial.current.id);
  const targetIndex = levels.findIndex((level) => level.id === regulation.targetLevelId);
  if (targetIndex < 0) throw new CliError("Stored target level is no longer available.");
  if (currentIndex >= targetIndex) {
    attempt.resumeMode = "not-needed";
    return {
      status: resume ? "still-satisfied" : "target-reached",
      iterations: 0,
      latestObservation: initial,
      targetLevelId: regulation.targetLevelId,
    };
  }
  const transcriptPath = join(root, "transcript.jsonl");
  const client = new AcpClient(regulation.agentProfile, async (update) => {
    const handle = await import("node:fs/promises");
    await handle.appendFile(
      transcriptPath,
      `${JSON.stringify(safeAgentValue(update, regulation.agentProfile))}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
  });
  let sessionId: string | undefined;
  let abortWork: Promise<void> | undefined;
  const abort = () => {
    abortWork = sessionId === undefined ? client.stop() : client.cancelAndStop(sessionId);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const initialized = await acpCall(
      client.initialize(regulation.agentProfile.connection.protocolVersion),
      regulation.agentProfile,
    );
    throwIfAborted();
    if (
      initialized.protocolVersion !== undefined &&
      String(initialized.protocolVersion) !== regulation.agentProfile.connection.protocolVersion
    ) {
      throw new CliError(
        safeAgentValue(
          `ACP protocol negotiation selected unsupported version ${String(initialized.protocolVersion)}.`,
          regulation.agentProfile,
        ),
        6,
        "acp-error",
      );
    }
    const capabilities = initialized.agentCapabilities;
    if (
      regulation.agentProfile.requirements?.sessionResume === true &&
      (capabilities === null ||
        typeof capabilities !== "object" ||
        (capabilities as Record<string, unknown>).loadSession !== true)
    )
      throw new CliError("ACP Agent did not advertise required capabilities.", 6, "acp-error");
    const previous = regulation.attempts
      .slice(0, -1)
      .reverse()
      .find(({ sessionId: priorSessionId }) => priorSessionId !== undefined)?.sessionId;
    if (resume && previous !== undefined) {
      try {
        await acpCall(client.resumeSession(previous, cwd), regulation.agentProfile);
        throwIfAborted();
        sessionId = previous;
        attempt.resumeMode = "resumed";
      } catch {
        if (signal.aborted) throw abortedError();
        sessionId = safeSessionId(
          await acpCall(client.newSession(cwd), regulation.agentProfile),
          regulation.agentProfile,
        );
        throwIfAborted();
        attempt.resumeMode = "new-with-summary";
      }
    } else {
      sessionId = safeSessionId(
        await acpCall(client.newSession(cwd), regulation.agentProfile),
        regulation.agentProfile,
      );
      throwIfAborted();
      attempt.resumeMode = "new";
    }
    attempt.sessionId = sessionId;
    const activeSessionId = sessionId;
    let result: RegulationResult;
    try {
      result = await regulator.regulate(
        {
          targetLevelId: regulation.targetLevelId,
          limits: {
            ...attempt.limits,
            timeoutMs: Math.max(1, deadline - performance.now()),
          },
          signal,
        },
        async (request) => {
          attempt.observations.push(request.observation);
          const response = await acpCall(
            client.prompt(activeSessionId, actionPrompt(regulation, request.observation)),
            regulation.agentProfile,
          );
          throwIfAborted();
          const safeResponse = safeAgentValue(response, regulation.agentProfile);
          if (safeResponse.status === "cancelled") {
            throw new InvocationCancelledError("ACP session was cancelled.");
          }
          attempt.actions.push({
            problemId: request.problem.id,
            status: safeResponse.status,
            summary: safeResponse.summary,
          });
          await save(root, regulation, attempt);
          return safeResponse.status === "completed"
            ? { status: "completed", summary: safeResponse.summary }
            : { status: "blocked", reason: safeResponse.summary };
        },
      );
    } catch (error) {
      if (
        error instanceof CliError ||
        error instanceof ObjectiveRegulatorTimeoutError ||
        error instanceof InvocationCancelledError ||
        signal.aborted
      ) {
        throw signal.aborted ? abortedError() : error;
      }
      throw new CliError(
        error instanceof Error ? error.message : "Guide re-probe failed.",
        2,
        "guide-error",
      );
    }
    attempt.observations.push(result.latestObservation);
    return result;
  } finally {
    signal.removeEventListener("abort", abort);
    await (abortWork ?? client.stop());
  }
}

function reportValue(regulation: Regulation, finalStatus: string) {
  return redactSensitive({
    schemaVersion: 1,
    regulationId: regulation.regulationId,
    targetLevelId: regulation.targetLevelId,
    status: finalStatus,
    finalStatus,
    attempts: regulation.attempts.map((entry) => ({
      id: entry.id,
      startedAt: entry.startedAt,
      completedAt: entry.completedAt,
      status: entry.status,
      resumeMode: entry.resumeMode,
      actions: entry.actions,
      rounds: entry.observations.map((observation, index) => ({
        round: index + 1,
        currentLevelId: observation.current.id,
        problemIds: observation.problems.map((problem) => problem.id),
      })),
    })),
    recovery: {
      regulationId: regulation.regulationId,
      command: `pguide continue ${regulation.regulationId}`,
    },
  });
}

interface FinishedInvocation {
  code: number;
  value: ReturnType<typeof reportValue>;
  markdown: string;
}

async function finish(
  regulation: Regulation,
  attempt: Attempt,
  root: string,
  result: Awaited<ReturnType<typeof runAttempt>>,
  globals: GlobalOptions,
  reportPath?: string,
): Promise<FinishedInvocation> {
  attempt.completedAt = new Date().toISOString();
  attempt.status = result.status;
  await save(root, regulation, attempt);
  const value = reportValue(regulation, result.status);
  const report = `# Regulation ${regulation.regulationId}\n\nStatus: \`${result.status}\`\n\nTarget: \`${regulation.targetLevelId}\`\n\nIterations: ${result.iterations}`;
  if (reportPath !== undefined) {
    await atomicWrite(resolve(globals.cwd, reportPath), `${JSON.stringify(value, null, 2)}\n`);
  }
  return { code: exitCode(result.status), value, markdown: report };
}

async function finishInterrupted(
  regulation: Regulation,
  attempt: Attempt,
  root: string,
  status: "timed-out" | "cancelled",
  globals: GlobalOptions,
  reportPath?: string,
): Promise<number> {
  attempt.status = status;
  attempt.completedAt = new Date().toISOString();
  await save(root, regulation, attempt);
  const value = reportValue(regulation, status);
  if (reportPath !== undefined) {
    await atomicWrite(resolve(globals.cwd, reportPath), `${JSON.stringify(value, null, 2)}\n`);
  }
  writeResult(value, globals.format, `Regulation ${regulation.regulationId} ${status}.`);
  return 5;
}

export async function runRegulate(
  argv: string[],
  globals: GlobalOptions,
): Promise<number | undefined> {
  if (globals.help) {
    writeResult(
      { schemaVersion: 1, command: "regulate" },
      globals.format,
      "Usage: pguide regulate --guide <path> --subject-file <path|-> --target <level> [--agent <profile>]",
    );
    return;
  }
  rejectUnknownOptions(argv, {
    "--guide": "value",
    "--subject-file": "value",
    "--target": "value",
    "--agent": "value",
    "--language": "value",
    "--max-iterations": "value",
    "--max-stalled-iterations": "value",
    "--timeout": "value",
    "--report": "value",
  });
  const loaded = await loadConfig(globals.cwd, globals.config);
  await pruneExpiredRegulations(stateRoot(loaded.value));
  const guidePath = resolve(globals.cwd, option(argv, "--guide", { required: true }) as string);
  const subject = (await readJsonSubject(
    option(argv, "--subject-file", { required: true }) as string,
    globals.cwd,
  )) as JsonObject;
  const targetLevelId = option(argv, "--target", { required: true }) as string;
  const agentName = (option(argv, "--agent") as string | undefined) ?? loaded.value.defaultAgent;
  if (agentName === undefined)
    throw new CliError("--agent is required when defaultAgent is not configured.");
  const profile = loaded.value.agents?.[agentName];
  if (profile === undefined) throw new CliError(`Unknown Agent profile: ${agentName}.`);
  validateAgentProfile(profile);
  const guideRevision = await digestTree(guidePath);
  const regulationId = randomUUID();
  const root = join(stateRoot(loaded.value), "regulations", regulationId);
  await ensurePrivateDirectory(root);
  const attempt: Attempt = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    limits: limits(argv, loaded.value),
    observations: [],
    actions: [],
  };
  const regulation: Regulation = {
    schemaVersion: 1,
    regulationId,
    createdAt: new Date().toISOString(),
    guidePath,
    guideRevision,
    subject,
    subjectDigest: digest(subject),
    targetLevelId,
    ...(option(argv, "--language") === undefined
      ? {}
      : { language: option(argv, "--language") as string }),
    agentName,
    agentProfile: profile,
    ...(loaded.value.retentionDays === undefined
      ? {}
      : {
          retentionDays: loaded.value.retentionDays,
          expiresAt: new Date(Date.now() + loaded.value.retentionDays * 86_400_000).toISOString(),
        }),
    attempts: [attempt],
  };
  await save(root, regulation, attempt);
  const reportPath = option(argv, "--report") as string | undefined;
  try {
    const finished = await withinInvocation(attempt.limits.timeoutMs, async (signal, deadline) =>
      finish(
        regulation,
        attempt,
        root,
        await runAttempt(regulation, attempt, root, globals.cwd, false, signal, deadline),
        globals,
        reportPath,
      ),
    );
    writeResult(finished.value, globals.format, finished.markdown);
    return finished.code;
  } catch (error) {
    if (
      error instanceof ObjectiveRegulatorTimeoutError ||
      error instanceof InvocationTimeoutError
    ) {
      return finishInterrupted(regulation, attempt, root, "timed-out", globals, reportPath);
    }
    if (error instanceof InvocationCancelledError) {
      return finishInterrupted(regulation, attempt, root, "cancelled", globals, reportPath);
    }
    const expected = expectedFailure(error);
    attempt.status = "failed";
    attempt.completedAt = new Date().toISOString();
    attempt.errorCategory = expected.category;
    attempt.errorSummary = `${expected.category} failure`;
    await save(root, regulation, attempt);
    throw expected.failure;
  }
}

export async function runContinue(
  argv: string[],
  globals: GlobalOptions,
): Promise<number | undefined> {
  if (globals.help) {
    writeResult(
      { schemaVersion: 1, command: "continue" },
      globals.format,
      "Usage: pguide continue <regulation-id>",
    );
    return;
  }
  rejectUnknownOptions(argv, { "--report": "value" }, 1);
  let id: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--report") {
      index += 1;
    } else {
      id = argv[index];
      break;
    }
  }
  if (id === undefined || !/^[0-9a-f-]{36}$/.test(id))
    throw new CliError("A valid regulation ID is required.");
  const loaded = await loadConfig(globals.cwd, globals.config);
  await pruneExpiredRegulations(stateRoot(loaded.value));
  const root = join(stateRoot(loaded.value), "regulations", id);
  let regulation: Regulation;
  try {
    regulation = JSON.parse(await readFile(join(root, "regulation.json"), "utf8")) as Regulation;
  } catch {
    throw new CliError(`Regulation not found: ${id}.`, 6, "io-error");
  }
  const previousLimits = regulation.attempts.at(-1)?.limits;
  if (previousLimits === undefined)
    throw new CliError("Regulation has no prior Attempt.", 6, "io-error");
  const attempt: Attempt = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    limits: previousLimits,
    observations: [],
    actions: [],
  };
  regulation.attempts.push(attempt);
  await save(root, regulation, attempt);
  const reportPath = option(argv, "--report") as string | undefined;
  try {
    const finished = await withinInvocation(attempt.limits.timeoutMs, async (signal, deadline) =>
      finish(
        regulation,
        attempt,
        root,
        await runAttempt(regulation, attempt, root, globals.cwd, true, signal, deadline),
        globals,
        reportPath,
      ),
    );
    writeResult(finished.value, globals.format, finished.markdown);
    return finished.code;
  } catch (error) {
    if (
      error instanceof ObjectiveRegulatorTimeoutError ||
      error instanceof InvocationTimeoutError
    ) {
      return finishInterrupted(regulation, attempt, root, "timed-out", globals, reportPath);
    }
    if (error instanceof InvocationCancelledError) {
      return finishInterrupted(regulation, attempt, root, "cancelled", globals, reportPath);
    }
    const expected = expectedFailure(error);
    attempt.status = "failed";
    attempt.completedAt = new Date().toISOString();
    attempt.errorCategory = expected.category;
    attempt.errorSummary = `${expected.category} failure`;
    await save(root, regulation, attempt);
    throw expected.failure;
  }
}

export function launchRegulatorCommand(
  metadata: CommandMetadata,
  run: (argv: string[], globals: GlobalOptions) => Promise<number | undefined>,
): void {
  void commandMain(metadata, run);
}
