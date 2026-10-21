import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type AgentProfile,
  CliError,
  expectedCliError,
  type GlobalOptions,
  loadAgents,
  loadConfig,
  markdownInlineCode,
  markdownText,
  option,
  rejectUnknownOptions,
  resolveObjective,
  showCommandHelp,
  writeResult,
} from "@potential-guide/cli-core";
import { withPilot } from "@potential-guide/cli-runtime";
import { Effect, SubscriptionRef, startEffect, watchSnapshot } from "@potential-guide/effects";
import {
  attainedLevelRank,
  type GitObjectiveSource,
  levelRank,
  observe,
  type PilotRuntime,
  type Subject,
} from "@potential-guide/objective-pilot";
import {
  type AgentResource,
  type CoordinatorEvent,
  createPortfolioCoordinator,
  createPortfolioPlanner,
  type ObjectiveGoal,
  type PlannerPolicy,
  type PortfolioCoordinator,
  type PortfolioPlannerOptions,
  type RegulationRunner,
} from "@potential-guide/objective-portfolio-supervisor";
import {
  makeRegulationPermissions,
  type RegulationInput,
  type RegulationPermissions,
  type RegulationStrategy,
} from "@potential-guide/objective-regulator";
import {
  createProcessRegulationRunner,
  defaultRegulationQuota,
  type RegulationProcessEvent,
} from "@potential-guide/pguide-regulate";
import { createAgentPlannerPolicy } from "../acp-planner.js";

interface FileGoal {
  id: string;
  objective: string;
  revision?: string;
  subject: Subject;
  targetLevel: string;
  priority: number;
  observationIntervalMs: number;
  requirements?: string[];
}
interface FileResource {
  id: string;
  agent: string;
  capacity: number;
  capabilities: string[];
}
interface PortfolioFile {
  schemaVersion: 4;
  goals: FileGoal[];
  resources: FileResource[];
}

function runtimeKey(goal: Pick<ObjectiveGoal, "objective" | "bindingRevision">): string {
  return JSON.stringify([goal.objective, goal.bindingRevision ?? null]);
}

async function bindGoal(
  entry: FileGoal,
  cwd: string,
  probeTimeoutMs?: number,
  signal?: AbortSignal,
  source?: GitObjectiveSource,
) {
  const preparation = new AbortController();
  const cancel = () => preparation.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  let publish!: (value: { goal: ObjectiveGoal; runtime: PilotRuntime }) => void;
  let reject!: (error: unknown) => void;
  let release!: () => void;
  const ready = new Promise<{ goal: ObjectiveGoal; runtime: PilotRuntime }>((done, failed) => {
    publish = done;
    reject = failed;
  });
  const released = new Promise<void>((done) => {
    release = done;
  });
  const lifetime = withPilot(
    entry.objective,
    cwd,
    entry.revision,
    async (objective, runtime) => {
      if (
        entry.targetLevel !== "initial" &&
        entry.targetLevel !== "terminal" &&
        !objective.manifest.levels.some(({ id }) => id === entry.targetLevel)
      )
        throw new CliError(`Goal ${entry.id} has an unknown target level.`);
      publish({
        goal: {
          id: entry.id,
          objective,
          subject: entry.subject,
          targetLevel: entry.targetLevel,
          priority: entry.priority,
          observationIntervalMs: entry.observationIntervalMs,
          ...(objective.source === undefined
            ? {}
            : { sourceBindings: { [objective.objectiveId]: objective.source } }),
          ...(entry.requirements === undefined ? {} : { requirements: entry.requirements }),
        },
        runtime,
      });
      await released;
    },
    {
      probeTimeoutMs,
      signal: preparation.signal,
      ...(source === undefined
        ? {}
        : { versions: { [entry.objective]: source.tree }, sources: { [entry.objective]: source } }),
    },
  );
  void lifetime.catch(reject);
  const value = await ready.finally(() => signal?.removeEventListener("abort", cancel));
  return {
    ...value,
    async close() {
      release();
      await lifetime;
    },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(text) && new Set(value).size === value.length;
}
function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 2_147_483_647;
}

export function parsePortfolioFile(value: unknown): PortfolioFile {
  if (!record(value) || value.schemaVersion !== 4)
    throw new CliError(
      "Portfolio requires schemaVersion: 4 with explicitly reviewed attainment targets; older portfolios and pinned evidence are incompatible.",
    );
  if (
    Object.keys(value).some((key) => !["schemaVersion", "goals", "resources"].includes(key)) ||
    !Array.isArray(value.goals) ||
    value.goals.length === 0 ||
    !Array.isArray(value.resources)
  )
    throw new CliError("Portfolio requires goals and resources arrays.");
  const goalIds = new Set<string>();
  for (const goal of value.goals) {
    if (
      !record(goal) ||
      Object.keys(goal).some(
        (key) =>
          ![
            "id",
            "objective",
            "revision",
            "subject",
            "targetLevel",
            "priority",
            "observationIntervalMs",
            "requirements",
          ].includes(key),
      ) ||
      !text(goal.id) ||
      goalIds.has(goal.id) ||
      !text(goal.objective) ||
      (goal.revision !== undefined && !text(goal.revision)) ||
      !record(goal.subject) ||
      !text(goal.targetLevel) ||
      !Number.isSafeInteger(goal.priority) ||
      (goal.priority as number) < 0 ||
      !positive(goal.observationIntervalMs) ||
      (goal.requirements !== undefined && !strings(goal.requirements))
    )
      throw new CliError(
        "Portfolio contains an invalid or duplicate goal. Legacy pilot references require explicit objective-contract-migrate --format portfolio migration; pinned sources must be deliberately rebound after committing the migrated Objective.",
      );
    goalIds.add(goal.id);
  }
  const resourceIds = new Set<string>();
  for (const resource of value.resources) {
    if (
      !record(resource) ||
      Object.keys(resource).some(
        (key) => !["id", "agent", "capacity", "capabilities"].includes(key),
      ) ||
      !text(resource.id) ||
      resourceIds.has(resource.id) ||
      !text(resource.agent) ||
      !positive(resource.capacity) ||
      !strings(resource.capabilities)
    )
      throw new CliError("Portfolio contains an invalid or duplicate resource.");
    resourceIds.add(resource.id);
  }
  return value as unknown as PortfolioFile;
}

export async function supervisePortfolio(
  options: Omit<PortfolioPlannerOptions, "policy"> & {
    readonly policy: (signal: AbortSignal) => PlannerPolicy;
    readonly execute: boolean;
    readonly resources: readonly AgentResource[];
    readonly runner:
      | RegulationRunner
      | ((
          report: (input: RegulationInput, request: RegulationProcessEvent) => void,
        ) => RegulationRunner);
    readonly quota: RegulationStrategy["quota"];
    readonly agentExecutionLimits: { readonly timeoutMs: number };
    readonly permissions?: RegulationPermissions;
    readonly signal?: AbortSignal;
    readonly durationMs?: number;
    readonly refresh?: () => Promise<{
      readonly goals: readonly ObjectiveGoal[];
      readonly resources: readonly AgentResource[];
      readonly permissions?: RegulationPermissions;
      readonly releasePrevious?: () => Promise<void>;
    }>;
    readonly refreshIntervalMs?: number;
  },
) {
  if (options.durationMs !== undefined && (!options.execute || !positive(options.durationMs)))
    throw new CliError("A supervision duration requires execution and a positive integer.");
  const controller = new AbortController();
  const signal =
    options.signal === undefined
      ? controller.signal
      : AbortSignal.any([controller.signal, options.signal]);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let failure: unknown;
  let coordinator: PortfolioCoordinator | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshing: Promise<void> | undefined;
  const events: CoordinatorEvent[] = [];
  const watchers: ReturnType<typeof watchSnapshot>[] = [];
  if (options.durationMs !== undefined)
    timeout = setTimeout(() => controller.abort(), options.durationMs);
  const planner = await createPortfolioPlanner({
    goals: options.goals,
    observe: options.observe,
    policy: options.policy(signal),
    periodic: options.execute,
    ...(options.resolveObjective === undefined
      ? {}
      : { resolveObjective: options.resolveObjective }),
    ...(options.releaseObjective === undefined
      ? {}
      : { releaseObjective: options.releaseObjective }),
  }).catch((error: unknown) => {
    clearTimeout(timeout);
    throw error;
  });
  try {
    if (options.execute) {
      const resources = await Effect.runPromise(SubscriptionRef.make(options.resources));
      const permissionUpdates = await Effect.runPromise(
        SubscriptionRef.make<RegulationPermissions | undefined>(
          makeRegulationPermissions(options.permissions),
        ),
      );
      const failed = (state: { readonly error?: unknown }) => {
        if (state.error === undefined) return;
        failure ??= state.error;
        controller.abort();
      };
      watchers.push(watchSnapshot(planner.state, failed));
      const pendingRequests: { input: RegulationInput; request: RegulationProcessEvent }[] = [];
      const reportRequest = (input: RegulationInput, request: RegulationProcessEvent) => {
        if (request.type === "authorization-request")
          coordinator?.reportAuthorizationRequest(input, request.request);
        else coordinator?.reportCapabilityRequest(input, request);
      };
      const runner =
        typeof options.runner === "function"
          ? options.runner((input, request) => {
              if (coordinator === undefined) pendingRequests.push({ input, request });
              else reportRequest(input, request);
            })
          : options.runner;
      coordinator = await createPortfolioCoordinator({
        queue: planner.queue,
        resources,
        runner,
        maxConcurrency: Number.MAX_SAFE_INTEGER,
        quota: options.quota,
        agentExecutionLimits: options.agentExecutionLimits,
        permissionUpdates,
        abortGraceMs: 1_000,
        onEvent: async (event) => {
          events.push(event);
          if (events.length > 1_000) events.shift();
          await planner.feedback(event);
        },
      });
      for (const { input, request } of pendingRequests) reportRequest(input, request);
      watchers.push(watchSnapshot(coordinator.state, failed));
      let goalSignature = JSON.stringify(options.goals);
      let resourceSignature = JSON.stringify(options.resources);
      const scheduleRefresh = () => {
        const refresh = options.refresh;
        if (refresh === undefined || signal.aborted) return;
        refreshTimer = setTimeout(() => {
          refreshing = (async () => {
            const next = await refresh();
            if (signal.aborted) return;
            if ("permissions" in next)
              await Effect.runPromise(
                SubscriptionRef.set(permissionUpdates, makeRegulationPermissions(next.permissions)),
              );
            const nextGoalSignature = JSON.stringify(next.goals);
            const nextResourceSignature = JSON.stringify(next.resources);
            if (nextGoalSignature !== goalSignature) {
              await planner.updateGoals(next.goals);
              goalSignature = nextGoalSignature;
            }
            if (signal.aborted) return;
            if (nextResourceSignature !== resourceSignature) {
              await Effect.runPromise(SubscriptionRef.set(resources, next.resources));
              resourceSignature = nextResourceSignature;
            }
            await next.releasePrevious?.();
          })()
            .catch((error: unknown) => {
              if (!signal.aborted) failed({ error });
            })
            .finally(scheduleRefresh);
        }, options.refreshIntervalMs ?? 1_000);
      };
      scheduleRefresh();
      await new Promise<void>((done) => {
        if (signal.aborted) done();
        else signal.addEventListener("abort", () => done(), { once: true });
      });
    }
  } finally {
    clearTimeout(timeout);
    clearTimeout(refreshTimer);
    controller.abort();
    for (const watcher of watchers) watcher.cancel();
    await Promise.all(watchers.map((watcher) => watcher.exit()));
    await refreshing;
    try {
      await coordinator?.close();
    } finally {
      await planner.close();
    }
  }
  if (failure !== undefined) throw failure;
  const queue = await Effect.runPromise(SubscriptionRef.get(planner.queue));
  const state = await Effect.runPromise(SubscriptionRef.get(planner.state));
  return {
    schemaVersion: 4,
    status: options.execute ? "executed" : "planned",
    observations: state.observations,
    queue,
    events,
  };
}

export function supervisionMarkdown(
  result: Awaited<ReturnType<typeof supervisePortfolio>>,
  goals: readonly ObjectiveGoal[],
  resources: readonly AgentResource[],
  boundary: string,
): string {
  const execute = result.status === "executed";
  const failed = result.events.filter((event) => event.type === "failed");
  const lines = [
    "# Portfolio supervision",
    "",
    `- Mode: ${execute ? "execution" : "planning only - no repairs dispatched"}.`,
    `- Status: ${failed.length > 0 ? "execution failures recorded" : execute ? "supervision cycle ended" : "plan created"}.`,
    `- Goals: ${goals.length} ${goals.length === 1 ? "goal" : "goals"}.`,
    `- Remaining demands: ${result.queue.demands.length} ${result.queue.demands.length === 1 ? "demand" : "demands"}.`,
    `- Resources: ${resources.length} ${resources.length === 1 ? "resource" : "resources"}; total capacity ${resources.reduce((total, resource) => total + resource.capacity, 0)}.`,
    `- Termination boundary: ${markdownText(boundary)}.`,
    "- Completion: a completed cycle or empty queue does not prove all goals are reached; see the latest observations below.",
    "",
    "## Goals",
    "",
  ];
  for (const goal of goals) {
    const observation = result.observations[goal.id];
    const current = observation?.payload?.current.levelId;
    const reached =
      current !== undefined &&
      attainedLevelRank(goal.objective, current) >= levelRank(goal.objective, goal.targetLevel);
    lines.push(
      `- Goal: ${markdownInlineCode(goal.id)}; Objective: ${markdownInlineCode(goal.objective.objectiveId)}; target: ${markdownInlineCode(goal.targetLevel)}; current: ${current === undefined ? "not observed" : markdownInlineCode(current)}; status: ${reached ? "target reached" : current === undefined ? "target not established" : "target not reached"}.`,
    );
    if (observation?.payload === null)
      lines.push(`  - Observation failure: ${markdownText(observation.message)}`);
  }
  if (result.queue.demands.length > 0) {
    lines.push("", "## Remaining demands", "");
    for (const demand of result.queue.demands) {
      const eligible = resources.filter((resource) =>
        (demand.requirements ?? []).every((requirement) =>
          resource.capabilities.includes(requirement),
        ),
      );
      lines.push(
        `- Demand: ${markdownInlineCode(demand.id)}; target: ${markdownInlineCode(demand.targetLevel)}; requirements: ${demand.requirements?.length ? demand.requirements.map(markdownInlineCode).join(", ") : "none"}; pending reason: ${!execute ? "planning only; execution was not requested" : eligible.length === 0 ? "no resource matches the required capabilities" : "still queued at the termination boundary; matching capacity does not establish dispatch or completion"}.`,
      );
    }
  }
  if (resources.length > 0) {
    lines.push("", "## Resources", "");
    for (const resource of resources)
      lines.push(
        `- Resource: ${markdownInlineCode(resource.id)}; Agent: ${markdownInlineCode(resource.binding.id)}; capacity: ${resource.capacity}; capabilities: ${resource.capabilities.length ? resource.capabilities.map(markdownInlineCode).join(", ") : "none"}.`,
      );
  }
  if (failed.length > 0) {
    lines.push("", "## Failures", "");
    for (const event of failed)
      lines.push(
        `- Goal: ${markdownInlineCode(event.demand.id)}; failure: ${markdownText(
          (event.error instanceof Error
            ? event.error.message
            : typeof event.error === "string"
              ? event.error
              : record(event.error) && typeof event.error.message === "string"
                ? event.error.message
                : "regulation worker failed; inspect persisted state and check reports"
          )
            .split(/\r?\n/u)[0]
            ?.slice(0, 300) ?? "regulation worker failed",
        )}.`,
      );
  }
  for (const event of result.events) {
    if (event.type === "result" && event.outcome.stopReason !== "target-reached")
      lines.push(
        `- Goal stop reason: ${markdownInlineCode(event.demand.id)} - ${markdownText(event.outcome.stopReason)}${event.outcome.exhaustedBy === undefined ? "" : ` (${markdownText(event.outcome.exhaustedBy)})`}.`,
      );
    if (event.type === "authorization-request")
      lines.push(
        `- Action required: goal ${markdownInlineCode(event.demand.id)} needs explicit permission grants.`,
      );
    if (event.type === "capability-request")
      lines.push(
        `- Action required: goal ${markdownInlineCode(event.demand.id)} needs capabilities ${event.requirements.map(markdownInlineCode).join(", ")}.`,
      );
  }
  lines.push(
    "",
    `- Next action: ${!execute ? "review the plan and resources, then rerun the same command with --execute and an optional --duration-ms bound." : "review unmet goals and stop conditions, adjust resources or permissions if needed, then rerun supervision to obtain fresh observations."}`,
  );
  return lines.join("\n");
}

export async function runSupervise(
  argv: string[],
  globals: GlobalOptions,
): Promise<number | undefined> {
  if (globals.help) {
    showCommandHelp("supervise", globals);
    return;
  }
  rejectUnknownOptions(argv, {
    "--portfolio-file": "value",
    "--planner": "value",
    "--execute": "flag",
    "--duration-ms": "value",
  });
  const path = resolve(globals.cwd, option(argv, "--portfolio-file", { required: true }) as string);
  const portfolio = parsePortfolioFile(JSON.parse(await readFile(path, "utf8")) as unknown);
  const execute = argv.includes("--execute");
  const duration = option(argv, "--duration-ms") as string | undefined;
  const durationMs = duration === undefined ? undefined : Number(duration);
  if (durationMs !== undefined && (!execute || !positive(durationMs)))
    throw new CliError("--duration-ms requires --execute and a positive integer.");
  const loaded = await loadConfig(globals.cwd, globals.config);
  const profiles: Record<string, AgentProfile> = Object.assign(
    Object.create(null),
    (await loadAgents(globals.cwd)).agents,
  );
  const plannerName = option(argv, "--planner", { required: true }) as string;
  const profile = profiles[plannerName];
  if (profile === undefined) throw new CliError("--planner must name an existing Agent profile.");
  let plannerProfile = profile;
  function resolveResources(file: PortfolioFile, agents: Readonly<Record<string, AgentProfile>>) {
    return file.resources.map((resource): AgentResource => {
      if (agents[resource.agent] === undefined)
        throw new CliError(`Resource ${resource.id} requires an existing Agent profile.`);
      return {
        id: resource.id,
        binding: { id: resource.agent },
        capacity: resource.capacity,
        capabilities: resource.capabilities,
      };
    });
  }
  const resources = resolveResources(portfolio, profiles);
  let currentResources = resources;
  const agentExecutionLimits = {
    timeoutMs: loaded.value.agentExecutionLimits?.timeoutMs ?? 30_000,
  };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  let durationTimer: ReturnType<typeof setTimeout> | undefined;
  const bindings = new Set<Awaited<ReturnType<typeof bindGoal>>>();
  let activeBindings: Awaited<ReturnType<typeof bindGoal>>[] = [];
  const runtimes = new Map<string, PilotRuntime>();
  let goals: readonly ObjectiveGoal[] = [];
  let boundary = execute
    ? "cancellation requested; active work was stopped"
    : "planning pass finished";
  let failedObservation: { goal: ObjectiveGoal; message: string } | undefined;
  async function loadGoals(file: PortfolioFile, config = loaded.value) {
    const fresh: Awaited<ReturnType<typeof bindGoal>>[] = [];
    try {
      for (const entry of file.goals) {
        controller.signal.throwIfAborted();
        const binding = await bindGoal(
          { ...entry, objective: resolveObjective(entry.objective, config) },
          globals.cwd,
          config.regulationStrategy?.probe?.timeoutMs,
        );
        fresh.push(binding);
        const previous = activeBindings.find(({ goal }) => goal.id === entry.id);
        const dependencies =
          previous?.runtime
            .boundObjectives?.()
            .filter((spec) => spec.objectiveId !== binding.goal.objective.objectiveId) ?? [];
        const versions: Record<string, unknown> = {};
        for (const dependency of [...dependencies].sort((a, b) =>
          a.objectiveId.localeCompare(b.objectiveId),
        )) {
          if (binding.runtime.resolveObjective === undefined)
            throw new CliError("Missing dependency source resolver.");
          const next = await binding.runtime.resolveObjective(
            dependency.objectiveId,
            undefined,
            controller.signal,
          );
          if (next.spec.source === undefined)
            throw new CliError("Missing dependency snapshot evidence.");
          versions[dependency.objectiveId] = next.spec.source;
        }
        if (dependencies.length > 0) {
          const sourceBindings: Record<string, GitObjectiveSource> = {};
          for (const spec of [...(binding.runtime.boundObjectives?.() ?? [])].sort((a, b) =>
            a.objectiveId.localeCompare(b.objectiveId),
          )) {
            if (spec.source !== undefined) sourceBindings[spec.objectiveId] = spec.source;
          }
          binding.goal = {
            ...binding.goal,
            bindingRevision: JSON.stringify(versions),
            sourceBindings,
          };
        }
      }
      const next = fresh.map(({ goal }) => goal);
      if (JSON.stringify(next) === JSON.stringify(goals)) {
        await Promise.all(fresh.map((binding) => binding.close()));
        return { goals };
      }
      for (const { goal, runtime } of fresh) {
        runtimes.set(runtimeKey(goal), runtime);
      }
      const previous = activeBindings;
      activeBindings = fresh;
      for (const binding of fresh) bindings.add(binding);
      goals = next;
      return {
        goals,
        async releasePrevious() {
          await Promise.all(
            previous.map(async (binding) => {
              await binding.close();
              bindings.delete(binding);
            }),
          );
          const retained = new Set<string>();
          for (const binding of activeBindings) {
            retained.add(runtimeKey(binding.goal));
          }
          for (const binding of bindings) retained.add(runtimeKey(binding.goal));
          for (const key of runtimes.keys()) if (!retained.has(key)) runtimes.delete(key);
        },
      };
    } catch (error) {
      await Promise.all(fresh.map((binding) => binding.close()));
      throw error;
    }
  }
  try {
    await loadGoals(portfolio);
    if (durationMs !== undefined)
      durationTimer = setTimeout(() => {
        boundary = `duration limit reached (${durationMs} ms); active work was stopped`;
        cancel();
      }, durationMs);
    const result = await supervisePortfolio({
      goals,
      async resolveObjective(objectiveId, version, signal, source) {
        signal.throwIfAborted();
        if (source === undefined || source.tree !== version)
          throw new CliError("Dependency binding requires exact commit/tree source evidence.");
        const binding = await bindGoal(
          {
            id: `binding:${objectiveId}`,
            objective: objectiveId,
            revision: source.commit,
            subject: {},
            targetLevel: "terminal",
            priority: 0,
            observationIntervalMs: 1_000,
          },
          globals.cwd,
          loaded.value.regulationStrategy?.probe?.timeoutMs,
          signal,
          source,
        );
        if (signal.aborted) {
          await binding.close();
          signal.throwIfAborted();
        }
        bindings.add(binding);
        runtimes.set(runtimeKey(binding.goal), binding.runtime);
        return binding.goal.objective;
      },
      async releaseObjective(spec) {
        for (const binding of [...bindings]) {
          if (
            activeBindings.includes(binding) ||
            JSON.stringify(binding.goal.objective) !== JSON.stringify(spec)
          )
            continue;
          await binding.close();
          bindings.delete(binding);
        }
        const retained = new Set([...bindings].map((binding) => runtimeKey(binding.goal)));
        for (const key of runtimes.keys()) if (!retained.has(key)) runtimes.delete(key);
      },
      policy: (signal) => (input) =>
        createAgentPlannerPolicy(plannerProfile, globals.cwd, {
          signal,
          timeoutMs: agentExecutionLimits.timeoutMs,
        })(input),
      observe: (goal, signal) => {
        const runtime = runtimes.get(runtimeKey(goal));
        if (runtime === undefined) throw new CliError("Missing pinned Pilot runtime.");
        return (async () => {
          for (const [id, source] of Object.entries(goal.sourceBindings ?? {})) {
            if (id === goal.objective.objectiveId) continue;
            if (runtime.resolveObjective === undefined)
              throw new CliError("Missing source binding resolver.");
            await runtime.resolveObjective(id, source.tree, signal, source);
          }
          const observation = await startEffect(
            observe(
              {
                spec: goal.objective,
                subject: goal.subject,
                ...(goal.targetLevel === "initial" ? { targetLevel: "initial" as const } : {}),
              },
              runtime,
            ),
            AbortSignal.any([signal, controller.signal]),
          ).await();
          if (observation.payload === null)
            failedObservation = { goal, message: observation.message };
          return observation;
        })();
      },
      execute,
      resources,
      runner: (report) => createProcessRegulationRunner(profiles, globals.cwd, report),
      quota: loaded.value.regulationStrategy?.quota ?? defaultRegulationQuota,
      agentExecutionLimits,
      permissions: makeRegulationPermissions(loaded.value.regulationPermissions),
      signal: controller.signal,
      refreshIntervalMs: Math.min(
        1_000,
        Math.max(250, ...goals.map((goal) => goal.observationIntervalMs)),
      ),
      refresh: async () => {
        const nextPortfolio = parsePortfolioFile(
          JSON.parse(await readFile(path, "utf8")) as unknown,
        );
        const config = await loadConfig(globals.cwd, globals.config);
        const agents = (await loadAgents(globals.cwd)).agents;
        const nextPlanner = agents[plannerName];
        if (nextPlanner === undefined) throw new CliError("--planner profile was removed.");
        const nextResources = resolveResources(nextPortfolio, agents);
        currentResources = nextResources;
        const nextGoals = await loadGoals(nextPortfolio, config.value);
        for (const name of Object.keys(profiles)) delete profiles[name];
        Object.assign(profiles, agents);
        plannerProfile = nextPlanner;
        return {
          ...nextGoals,
          resources: nextResources,
          permissions: makeRegulationPermissions(config.value.regulationPermissions),
        };
      },
    });
    writeResult(
      result,
      globals.format,
      globals.format === "json"
        ? ""
        : supervisionMarkdown(result, goals, currentResources, boundary),
    );
    return result.events.some((event) => event.type === "failed") ? 6 : 0;
  } catch (error) {
    if (globals.format !== "json" && failedObservation !== undefined) {
      const compatibility = expectedCliError(error);
      throw new CliError(
        compatibility.message,
        compatibility.exitCode,
        compatibility.status,
        compatibility.guidance,
        `Observation failed for goal ${markdownInlineCode(failedObservation.goal.id)}, Objective ${markdownInlineCode(failedObservation.goal.objective.objectiveId)}, target ${markdownInlineCode(failedObservation.goal.targetLevel)}: ${markdownText(failedObservation.message)}. Inspect the failing check/report, then rerun supervision. Goal completion could not be determined.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(durationTimer);
    controller.abort();
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    await Promise.all([...bindings].map((binding) => binding.close()));
  }
}
