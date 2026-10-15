import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  AcpClient,
  type AgentProfile,
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
} from "./index.js";

export const regulatorCommandVersion = "0.1.0";

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

class InvocationTimeoutError extends Error {}

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

async function withinInvocation<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal, deadline: number) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const deadline = performance.now() + timeoutMs;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => {
        reject(new InvocationTimeoutError("Regulation invocation timed out."));
        controller.abort();
      },
      Math.min(timeoutMs, 2_147_483_647),
    );
  });
  const work = operation(controller.signal, deadline);
  work.catch(() => undefined);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
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
  await atomicWrite(join(root, "regulation.json"), `${JSON.stringify(regulation, null, 2)}\n`);
  await atomicWrite(
    join(root, "attempts", `${attempt.id}.json`),
    `${JSON.stringify(attempt, null, 2)}\n`,
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
  let source = JSON.stringify(value);
  for (const name of profile.transport.env ?? []) {
    const secret = process.env[name];
    if (secret !== undefined && secret !== "") source = source.split(secret).join("[REDACTED]");
  }
  return JSON.parse(source) as T;
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

async function acpCall<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(
      error instanceof Error ? error.message : "ACP operation failed.",
      6,
      "acp-error",
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
  const throwIfAborted = () => {
    if (signal.aborted) throw new InvocationTimeoutError("Regulation invocation timed out.");
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
    if (signal.aborted) throw new InvocationTimeoutError("Regulation invocation timed out.");
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
  const abort = () => client.close();
  signal.addEventListener("abort", abort, { once: true });
  let sessionId: string;
  try {
    const initialized = await acpCall(
      client.initialize(regulation.agentProfile.connection.protocolVersion),
    );
    throwIfAborted();
    if (
      initialized.protocolVersion !== undefined &&
      String(initialized.protocolVersion) !== regulation.agentProfile.connection.protocolVersion
    ) {
      throw new CliError(
        `ACP protocol negotiation selected unsupported version ${String(initialized.protocolVersion)}.`,
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
    const previous = regulation.attempts.at(-2)?.sessionId;
    if (resume && previous !== undefined) {
      try {
        await acpCall(client.resumeSession(previous, cwd));
        throwIfAborted();
        sessionId = previous;
        attempt.resumeMode = "resumed";
      } catch {
        sessionId = await acpCall(client.newSession(cwd));
        throwIfAborted();
        attempt.resumeMode = "new-with-summary";
      }
    } else {
      sessionId = await acpCall(client.newSession(cwd));
      throwIfAborted();
      attempt.resumeMode = "new";
    }
    attempt.sessionId = sessionId;
    const onSignal = () => client.cancel(sessionId);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    try {
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
              client.prompt(sessionId, actionPrompt(regulation, request.observation)),
            );
            throwIfAborted();
            const safeResponse = safeAgentValue(response, regulation.agentProfile);
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
          signal.aborted
        ) {
          throw error;
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
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    client.close();
  }
}

async function finish(
  regulation: Regulation,
  attempt: Attempt,
  root: string,
  result: Awaited<ReturnType<typeof runAttempt>>,
  globals: GlobalOptions,
  reportPath?: string,
): Promise<number> {
  attempt.completedAt = new Date().toISOString();
  attempt.status = result.status;
  await save(root, regulation, attempt);
  const value = {
    schemaVersion: 1,
    regulationId: regulation.regulationId,
    status: result.status,
    targetLevelId: regulation.targetLevelId,
    iterations: result.iterations,
    latestObservation: result.latestObservation,
  };
  const report = `# Regulation ${regulation.regulationId}\n\nStatus: \`${result.status}\`\n\nTarget: \`${regulation.targetLevelId}\`\n\nIterations: ${result.iterations}`;
  if (reportPath !== undefined) {
    await atomicWrite(resolve(globals.cwd, reportPath), `${JSON.stringify(value, null, 2)}\n`);
  }
  writeResult(value, globals.format, report);
  return exitCode(result.status);
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
    return await withinInvocation(attempt.limits.timeoutMs, async (signal, deadline) =>
      finish(
        regulation,
        attempt,
        root,
        await runAttempt(regulation, attempt, root, globals.cwd, false, signal, deadline),
        globals,
        reportPath,
      ),
    );
  } catch (error) {
    if (
      error instanceof ObjectiveRegulatorTimeoutError ||
      error instanceof InvocationTimeoutError
    ) {
      attempt.status = "timed-out";
      attempt.completedAt = new Date().toISOString();
      await save(root, regulation, attempt);
      const value = { schemaVersion: 1, regulationId, status: "timed-out" };
      if (reportPath !== undefined) {
        await atomicWrite(resolve(globals.cwd, reportPath), `${JSON.stringify(value, null, 2)}\n`);
      }
      writeResult(value, globals.format, `Regulation ${regulationId} timed out.`);
      return 5;
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
    return await withinInvocation(attempt.limits.timeoutMs, async (signal, deadline) =>
      finish(
        regulation,
        attempt,
        root,
        await runAttempt(regulation, attempt, root, globals.cwd, true, signal, deadline),
        globals,
        reportPath,
      ),
    );
  } catch (error) {
    if (
      error instanceof ObjectiveRegulatorTimeoutError ||
      error instanceof InvocationTimeoutError
    ) {
      attempt.status = "timed-out";
      attempt.completedAt = new Date().toISOString();
      await save(root, regulation, attempt);
      const value = { schemaVersion: 1, regulationId: id, status: "timed-out" };
      if (reportPath !== undefined) {
        await atomicWrite(resolve(globals.cwd, reportPath), `${JSON.stringify(value, null, 2)}\n`);
      }
      writeResult(value, globals.format, `Regulation ${id} timed out.`);
      return 5;
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
