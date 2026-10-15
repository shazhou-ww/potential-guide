import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createObjectiveLoader, type JsonObject } from "@potential-guide/objective-guide";
import { createObjectiveRegulator } from "@potential-guide/objective-regulator";
import {
  AcpClient,
  CliError,
  commandMain,
  loadConfig,
  option,
  writeResult,
  type GlobalOptions,
} from "@potential-guide/cli-core";
import { createObjectivePortfolioSupervisor, type ObjectiveRegistration } from "./index.js";

export async function runSupervise(
  argv: string[],
  globals: GlobalOptions,
): Promise<number | undefined> {
  if (globals.help) {
    writeResult(
      { schemaVersion: 1, command: "supervise" },
      globals.format,
      "Usage: pguide supervise --portfolio-file <json> [--execute]",
    );
    return;
  }
  const path = resolve(globals.cwd, option(argv, "--portfolio-file", { required: true }) as string);
  const raw = JSON.parse(await readFile(path, "utf8")) as {
    objectives?: {
      id: string;
      guide: string;
      subject: Record<string, unknown>;
      defensiveThreshold: string;
      defensiveTarget: string;
    }[];
  };
  if (!Array.isArray(raw.objectives) || raw.objectives.length === 0)
    throw new CliError("Portfolio requires objectives.");
  const registrations: ObjectiveRegistration[] = [];
  for (const entry of raw.objectives) {
    const guide = await createObjectiveLoader().load(resolve(globals.cwd, entry.guide));
    const created = guide.createInstance({ subject: entry.subject as JsonObject });
    if (!created.ok) throw new CliError(`Invalid subject for ${entry.id}.`);
    registrations.push({
      id: entry.id,
      regulator: createObjectiveRegulator(created.instance),
      safety: {
        defensiveThresholdId: entry.defensiveThreshold,
        defensiveTargetLevelId: entry.defensiveTarget,
      },
    });
  }
  const supervisor = createObjectivePortfolioSupervisor(registrations, async (observation) => ({
    directives: observation.entries.map((entry) => ({
      registrationId: entry.registrationId,
      targetLevelId: entry.safety.defensiveTargetLevelId,
      trigger: "defensive" as const,
      rationale: "Configured defensive target",
      limits: { maxIterations: 1, maxStalledIterations: 1, timeoutMs: 30_000 },
    })),
    deferred: [],
  }));
  const observation = await supervisor.observe();
  const plan = await supervisor.plan(observation);
  const summary = observation.entries.map((entry) => ({
    registrationId: entry.registrationId,
    currentLevelId: entry.observation.current.id,
    problems: entry.observation.problems,
    gapSummary: entry.observation.gapSummary,
  }));
  if (argv.includes("--execute")) {
    const loaded = await loadConfig(globals.cwd, globals.config);
    const agentName = (option(argv, "--agent") as string | undefined) ?? loaded.value.defaultAgent;
    if (agentName === undefined) throw new CliError("--agent is required for --execute.");
    const profile = loaded.value.agents?.[agentName];
    if (profile === undefined) throw new CliError(`Unknown Agent profile: ${agentName}.`);
    const client = new AcpClient(profile);
    try {
      await client.initialize(profile.connection.protocolVersion);
      const sessionId = await client.newSession(globals.cwd);
      const result = await supervisor.execute(plan, async (request) => {
        const response = await client.prompt(
          sessionId,
          `Portfolio target: ${request.targetLevelId}\nCurrent level: ${request.observation.current.id}\nProblem: ${request.problem.id}\nParameters: ${JSON.stringify(request.problem.parameters)}\nPerform only this action; pguide will re-probe.`,
        );
        return response.status === "completed"
          ? { status: "completed", summary: response.summary }
          : { status: "blocked", reason: response.summary };
      });
      const results = result.results.map((entry) => ({
        registrationId: entry.registrationId,
        status: entry.result.status,
        iterations: entry.result.iterations,
        currentLevelId: entry.result.latestObservation.current.id,
      }));
      writeResult(
        { schemaVersion: 1, status: "executed", plan, observation: summary, results },
        globals.format,
        `Executed ${result.results.length} portfolio directives.`,
      );
      return result.results.some(
        ({ result: directiveResult }) => directiveResult.status !== "target-reached",
      )
        ? 3
        : 0;
    } finally {
      client.close();
    }
  }
  writeResult(
    { schemaVersion: 1, status: "planned", observation: summary, plan },
    globals.format,
    `Planned ${plan.directives.length} portfolio directives.`,
  );
}

void commandMain(
  {
    protocol: "pguide-command-v1",
    command: "supervise",
    description: "Supervise an Objective portfolio",
    version: "0.1.0",
  },
  runSupervise,
);
