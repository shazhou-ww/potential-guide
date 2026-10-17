import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CliError,
  type AgentProfile,
  type GlobalOptions,
  loadConfig,
  option,
  rejectUnknownOptions,
  writeResult,
} from "@potential-guide/cli-core";
import { Effect, startEffect, SubscriptionRef, watchSnapshot } from "@potential-guide/effects";
import {
  observe,
  type PilotRuntime,
  type PilotSpec,
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
import type { RegulationInput, RegulationStrategy } from "@potential-guide/objective-regulator";
import { createAcpPlannerPolicy } from "../acp-planner.js";
import { withPilot } from "../pilot-source.js";
import { type CapabilityRequest, createProcessRegulationRunner } from "../regulation-process.js";
import { defaultRegulationQuota } from "./regulator.js";

interface FileGoal {
  id: string;
  pilot: string;
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
  schemaVersion: 3;
  goals: FileGoal[];
  resources: FileResource[];
}

async function bindGoal(entry: FileGoal, cwd: string) {
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
  const lifetime = withPilot(entry.pilot, cwd, entry.revision, async (pilot, runtime) => {
    if (
      entry.targetLevel !== "terminal" &&
      !pilot.manifest.levels.some(({ id }) => id === entry.targetLevel)
    )
      throw new CliError(`Goal ${entry.id} has an unknown target level.`);
    publish({
      goal: {
        id: entry.id,
        pilot,
        subject: entry.subject,
        targetLevel: entry.targetLevel,
        priority: entry.priority,
        observationIntervalMs: entry.observationIntervalMs,
        ...(entry.requirements === undefined ? {} : { requirements: entry.requirements }),
      },
      runtime,
    });
    await released;
  });
  void lifetime.catch(reject);
  const value = await ready;
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
  if (!record(value) || value.schemaVersion !== 3)
    throw new CliError("Portfolio requires schemaVersion: 3; older portfolios are incompatible.");
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
            "pilot",
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
      !text(goal.pilot) ||
      (goal.revision !== undefined && !text(goal.revision)) ||
      !record(goal.subject) ||
      !text(goal.targetLevel) ||
      !Number.isSafeInteger(goal.priority) ||
      (goal.priority as number) < 0 ||
      !positive(goal.observationIntervalMs) ||
      (goal.requirements !== undefined && !strings(goal.requirements))
    )
      throw new CliError("Portfolio contains an invalid or duplicate goal.");
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
          report: (input: RegulationInput, request: CapabilityRequest) => void,
        ) => RegulationRunner);
    readonly quota: RegulationStrategy["quota"];
    readonly agentExecutionLimits: { readonly timeoutMs: number };
    readonly signal?: AbortSignal;
    readonly durationMs?: number;
    readonly refresh?: () => Promise<{
      readonly goals: readonly ObjectiveGoal[];
      readonly resources: readonly AgentResource[];
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
  }).catch((error: unknown) => {
    clearTimeout(timeout);
    throw error;
  });
  try {
    if (options.execute) {
      const resources = await Effect.runPromise(SubscriptionRef.make(options.resources));
      const failed = (state: { readonly error?: unknown }) => {
        if (state.error === undefined) return;
        failure ??= state.error;
        controller.abort();
      };
      watchers.push(watchSnapshot(planner.state, failed));
      const pendingRequests: { input: RegulationInput; request: CapabilityRequest }[] = [];
      const runner =
        typeof options.runner === "function"
          ? options.runner((input, request) => {
              if (coordinator === undefined) pendingRequests.push({ input, request });
              else coordinator.reportCapabilityRequest(input, request);
            })
          : options.runner;
      coordinator = await createPortfolioCoordinator({
        queue: planner.queue,
        resources,
        runner,
        maxConcurrency: Number.MAX_SAFE_INTEGER,
        quota: options.quota,
        agentExecutionLimits: options.agentExecutionLimits,
        abortGraceMs: 1_000,
        onEvent: async (event) => {
          events.push(event);
          if (events.length > 1_000) events.shift();
          await planner.feedback(event);
        },
      });
      for (const { input, request } of pendingRequests)
        coordinator.reportCapabilityRequest(input, request);
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
    schemaVersion: 3,
    status: options.execute ? "executed" : "planned",
    observations: state.observations,
    queue,
    events,
  };
}

export async function runSupervise(
  argv: string[],
  globals: GlobalOptions,
): Promise<number | undefined> {
  if (globals.help) {
    writeResult(
      { schemaVersion: 1, command: "supervise" },
      globals.format,
      "Usage: pguide supervise --portfolio-file <json> --planner <profile> [--execute] [--duration-ms <ms>]",
    );
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
  const profiles: Record<string, AgentProfile> = { ...loaded.value.agents };
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
  async function loadGoals(file: PortfolioFile) {
    const fresh: Awaited<ReturnType<typeof bindGoal>>[] = [];
    try {
      for (const entry of file.goals) {
        controller.signal.throwIfAborted();
        fresh.push(await bindGoal(entry, globals.cwd));
      }
      const next = fresh.map(({ goal }) => goal);
      if (JSON.stringify(next) === JSON.stringify(goals)) {
        await Promise.all(fresh.map((binding) => binding.close()));
        return { goals };
      }
      for (const { goal, runtime } of fresh) {
        for (
          let current: PilotSpec | undefined = goal.pilot;
          current !== undefined;
          current = current.prerequisite
        ) {
          runtimes.set(JSON.stringify(current), runtime);
        }
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
            for (
              let spec: PilotSpec | undefined = binding.goal.pilot;
              spec !== undefined;
              spec = spec.prerequisite
            )
              retained.add(JSON.stringify(spec));
          }
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
    if (durationMs !== undefined) durationTimer = setTimeout(cancel, durationMs);
    const result = await supervisePortfolio({
      goals,
      policy: (signal) => (input) =>
        createAcpPlannerPolicy(plannerProfile, globals.cwd, {
          signal,
          timeoutMs: agentExecutionLimits.timeoutMs,
        })(input),
      observe: (goal, signal) => {
        const runtime = runtimes.get(JSON.stringify(goal.pilot));
        if (runtime === undefined) throw new CliError("Missing pinned Pilot runtime.");
        return startEffect(
          observe({ spec: goal.pilot, subject: goal.subject }, runtime),
          AbortSignal.any([signal, controller.signal]),
        ).await();
      },
      execute,
      resources,
      runner: (report) => createProcessRegulationRunner(profiles, globals.cwd, report),
      quota: loaded.value.regulationStrategy?.quota ?? defaultRegulationQuota,
      agentExecutionLimits,
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
        const agents = config.value.agents ?? {};
        const nextPlanner = agents[plannerName];
        if (nextPlanner === undefined) throw new CliError("--planner profile was removed.");
        const nextResources = resolveResources(nextPortfolio, agents);
        const nextGoals = await loadGoals(nextPortfolio);
        for (const name of Object.keys(profiles)) delete profiles[name];
        Object.assign(profiles, agents);
        plannerProfile = nextPlanner;
        return { ...nextGoals, resources: nextResources };
      },
    });
    writeResult(
      result,
      globals.format,
      `${execute ? "Supervised" : "Planned"} ${goals.length} goals; ${result.queue.demands.length} queued demands.`,
    );
    return result.events.some((event) => event.type === "failed") ? 6 : 0;
  } finally {
    clearTimeout(durationTimer);
    controller.abort();
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    await Promise.all([...bindings].map((binding) => binding.close()));
  }
}
