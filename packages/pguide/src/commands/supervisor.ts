import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CliError,
  type GlobalOptions,
  loadConfig,
  option,
  rejectUnknownOptions,
  writeResult,
} from "@potential-guide/cli-core";
import type { Subject } from "@potential-guide/objective-pilot";
import {
  createObjectivePortfolioSupervisor,
  type ObjectiveRegistration,
} from "@potential-guide/objective-portfolio-supervisor";
import { makeRegulatorSpec } from "@potential-guide/objective-regulator";
import { withPilot } from "../pilot-source.js";
import { executeAcpAgent } from "./regulator.js";

export async function runSupervise(
  argv: string[],
  globals: GlobalOptions,
): Promise<number | undefined> {
  if (globals.help) {
    writeResult(
      { schemaVersion: 1, command: "supervise" },
      globals.format,
      "Usage: pguide supervise --portfolio-file <json> [--execute] [--agent <profile>]",
    );
    return;
  }
  rejectUnknownOptions(argv, {
    "--portfolio-file": "value",
    "--execute": "flag",
    "--agent": "value",
  });
  const path = resolve(globals.cwd, option(argv, "--portfolio-file", { required: true }) as string);
  const raw = JSON.parse(await readFile(path, "utf8")) as {
    schemaVersion?: number;
    objectives?: {
      id: string;
      pilot: string;
      revision?: string;
      subject: Subject;
      defensiveThreshold: string;
      defensiveTarget: string;
    }[];
  };
  if (raw.schemaVersion !== 2)
    throw new CliError(
      "Portfolio requires schemaVersion: 2 and Pilot entries; legacy Guide portfolios are incompatible.",
    );
  if (!Array.isArray(raw.objectives) || raw.objectives.length === 0)
    throw new CliError("Portfolio requires objectives.");
  const objectives = raw.objectives;
  const loaded = await loadConfig(globals.cwd, globals.config);
  const agentName = (option(argv, "--agent") as string | undefined) ?? loaded.value.defaultAgent;
  const profile = agentName === undefined ? undefined : loaded.value.agents?.[agentName];
  if (argv.includes("--execute") && profile === undefined)
    throw new CliError("An existing --agent profile is required for --execute.");
  const agentExecutionLimits = {
    timeoutMs: loaded.value.agentExecutionLimits?.timeoutMs ?? 30_000,
  };
  const registrations: ObjectiveRegistration[] = [];
  async function load(index: number): Promise<number | undefined> {
    const entry = objectives[index];
    if (entry !== undefined) {
      if (typeof entry.pilot !== "string")
        throw new CliError("Portfolio objective requires pilot.");
      return withPilot(entry.pilot, globals.cwd, entry.revision, async (pilot, runtime) => {
        registrations.push({
          id: entry.id,
          input: {
            spec: makeRegulatorSpec(
              pilot,
              {
                ...loaded.value.regulationStrategy,
                targetLevel: entry.defensiveTarget,
                agentExecutionLimits,
              },
              { id: agentName ?? "unbound" },
            ),
            subject: entry.subject,
          },
          runtime: {
            pilot: runtime,
            executeAgent: async (input, signal) => {
              if (profile === undefined) throw new CliError("Agent is not configured.");
              return executeAcpAgent(input, signal, profile, globals.cwd);
            },
          },
          safety: {
            defensiveThresholdId: entry.defensiveThreshold,
            defensiveTargetLevelId: entry.defensiveTarget,
          },
        });
        return load(index + 1);
      });
    }
    const supervisor = createObjectivePortfolioSupervisor(registrations, async (observation) => ({
      directives: observation.entries.map((value) => ({
        registrationId: value.registrationId,
        targetLevelId: value.safety.defensiveTargetLevelId,
        trigger: "defensive",
        rationale: "Configured defensive target",
        agentExecutionLimits,
      })),
      deferred: [],
    }));
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    try {
      const observation = await supervisor.observe(controller.signal);
      const plan = await supervisor.plan(observation);
      if (argv.includes("--execute")) {
        const results = await supervisor.execute(plan, controller.signal);
        writeResult(
          { schemaVersion: 2, status: "executed", plan, observation, results },
          globals.format,
          `Executed ${results.results.length} portfolio directives.`,
        );
        return results.results.some(({ result }) => result.stopReason !== "target-reached") ? 3 : 0;
      }
      writeResult(
        { schemaVersion: 2, status: "planned", observation, plan },
        globals.format,
        `Planned ${plan.directives.length} portfolio directives.`,
      );
      return 0;
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
  }
  return load(0);
}
