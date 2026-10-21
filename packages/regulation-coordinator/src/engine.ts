import {
  type DependencyProblem,
  type GitObjectiveSource,
  parseDependencyProblem,
} from "@potential-guide/objective-pilot";
import {
  canonicalJson,
  levelRank,
  type RunHandle,
  supports,
} from "@potential-guide/objective-portfolio-supervisor";
import { makeRegulatorSpec, type RegulationOutcome } from "@potential-guide/objective-regulator";
import type {
  AgentResource,
  CoordinatorCommand,
  CoordinatorFact,
  CoordinatorFeedback,
  CoordinatorOptions,
  Regulation,
  ResolvedObjective,
  WorkRef,
} from "./types.js";
import {
  fields,
  identity,
  mergeSources,
  observation,
  priority,
  validateRegulation,
  validateResources,
  validateSpec,
} from "./validation.js";

interface Edge {
  readonly provider: string;
  readonly minimum: string;
}
interface Node {
  readonly uid: string;
  readonly work: WorkRef;
  readonly order: number;
  regulation: Regulation;
  state: "queued" | "running" | "waiting" | "resolving" | "blocked" | "done";
  target: string;
  priority: number;
  requirements: string[];
  sources: Record<string, GitObjectiveSource>;
  waits: Edge[];
  reached: number;
  stalledRuns: number;
  retiring: boolean;
  blockedReason?: string;
  lease?: ResolvedObjective;
  resolution?: AbortController;
}
interface Run {
  readonly id: string;
  readonly node: Node;
  readonly handle: RunHandle;
  readonly resource: AgentResource;
  readonly target: string;
  readonly requirements: readonly string[];
  status: "running" | "stopping";
  timer?: ReturnType<typeof setTimeout>;
}
interface Resolution {
  readonly requirement: DependencyProblem;
  readonly lease: ResolvedObjective;
}
export type Message =
  | {
      readonly type: "feedback";
      readonly runId: string;
      readonly work: WorkRef;
      readonly feedback: CoordinatorFeedback;
    }
  | { readonly type: "command"; readonly command: CoordinatorCommand }
  | { readonly type: "resources"; readonly resources: readonly AgentResource[] }
  | {
      readonly type: "input-failure";
      readonly input: "commands" | "resources";
      readonly error: unknown;
    }
  | { readonly type: "input-end"; readonly input: "commands" | "resources" }
  | {
      readonly type: "settled";
      readonly run: Run;
      readonly outcome?: RegulationOutcome;
      readonly error?: unknown;
    }
  | { readonly type: "kill"; readonly run: Run }
  | { readonly type: "killed"; readonly run: Run; readonly error?: unknown; readonly ok: boolean }
  | {
      readonly type: "resolved";
      readonly node: Node;
      readonly controller: AbortController;
      readonly resolutions: readonly Resolution[];
      readonly error?: unknown;
    }
  | { readonly type: "close" };

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
const goal = (node: Node) => ({
  ...node.regulation,
  targetLevel: node.target,
  priority: node.priority,
  requirements: node.requirements,
  observationIntervalMs: 1,
});

/** Only handle() writes scheduling state; asynchronous effects return mailbox messages. */
export class Engine {
  private readonly nodes = new Map<string, Node>();
  private readonly roots = new Map<string, string>();
  private readonly generations = new Map<string, number>();
  private readonly runs = new Map<string, Run>();
  private resources: readonly AgentResource[] = [];
  private resourcesValid = false;
  private counter = 0;
  private starts = 0;
  private reservedAgentRuns = 0;
  private reservedDuration = 0;
  private pendingResolutions = 0;
  private closing = false;
  private closed = false;
  private cleanupFailures = 0;
  private finishClose!: () => void;
  readonly drained = new Promise<void>((resolve) => {
    this.finishClose = resolve;
  });

  constructor(
    private readonly options: CoordinatorOptions,
    private readonly emit: (event: CoordinatorFact) => Promise<void>,
    private readonly post: (message: Message) => Promise<void>,
  ) {}

  async handle(message: Message): Promise<void> {
    if (this.closed) return;
    switch (message.type) {
      case "feedback": {
        const run = this.runs.get(message.runId);
        if (run?.status !== "running" || run.node.retiring) {
          await this.emit({
            type: "stale-result",
            work: message.work,
            runId: message.runId,
            reason: "obsolete-execution-feedback",
          });
          break;
        }
        try {
          const feedback = structuredClone(message.feedback);
          if (feedback.type === "capability-request") {
            fields(feedback, ["type", "capability", "reason"]);
            if (!feedback.capability?.trim() || !feedback.reason?.trim())
              throw new TypeError("Capability feedback requires a capability and reason.");
          } else if (feedback.type === "authorization-request") {
            fields(feedback, ["type", "request"]);
            fields(feedback.request, ["id", "operation", "resources", "reason"], ["command"]);
            if (
              !feedback.request.id?.trim() ||
              !feedback.request.operation?.trim() ||
              !feedback.request.reason?.trim() ||
              !Array.isArray(feedback.request.resources) ||
              feedback.request.resources.some((value) => typeof value !== "string")
            )
              throw new TypeError("Invalid authorization feedback.");
          } else throw new TypeError("Unknown execution feedback.");
          canonicalJson(feedback);
          await this.emit({ ...feedback, work: run.node.work, runId: run.id });
        } catch (error) {
          await this.emit({
            type: "failure",
            stage: "feedback",
            work: run.node.work,
            runId: run.id,
            reason: reason(error),
          });
        }
        break;
      }
      case "command":
        if (!this.closing) await this.command(message.command);
        break;
      case "resources":
        if (!this.closing) await this.updateResources(message.resources);
        break;
      case "input-failure":
        if (message.input === "resources") {
          this.resourcesValid = false;
          await this.stopInvalidRuns();
        }
        await this.emit({
          type: "failure",
          stage: message.input === "commands" ? "command-input" : "resource-input",
          reason: reason(message.error),
        });
        break;
      case "input-end":
        await this.emit({ type: "input-ended", input: message.input });
        break;
      case "settled":
        await this.settled(message);
        break;
      case "resolved":
        await this.resolved(message);
        break;
      case "kill":
        if (this.runs.get(message.run.id) === message.run) {
          void Promise.resolve()
            .then(() => message.run.handle.kill())
            .then(
              () => this.post({ type: "killed", run: message.run, ok: true }),
              (error: unknown) => this.post({ type: "killed", run: message.run, ok: false, error }),
            );
        }
        break;
      case "killed":
        if (message.ok) await this.terminated(message.run, "kill-confirmed");
        else
          await this.emit({
            type: "failure",
            stage: "kill",
            work: message.run.node.work,
            runId: message.run.id,
            reason: reason(message.error),
          });
        break;
      case "close":
        this.closing = true;
        this.roots.clear();
        break;
    }
    await this.reconcile();
    if (this.closing && !this.closed && this.runs.size === 0 && this.pendingResolutions === 0) {
      this.closed = true;
      await this.emit({ type: "closed", cleanupFailures: this.cleanupFailures });
      this.finishClose();
    }
  }

  private makeNode(regulation: Regulation, work: WorkRef, lease?: ResolvedObjective): Node {
    const order = ++this.counter;
    const node: Node = {
      uid: `node:${order}`,
      work,
      order,
      regulation,
      state: "queued",
      target: regulation.targetLevel,
      priority: regulation.priority,
      requirements: [...(regulation.requirements ?? [])],
      sources: mergeSources(
        { [regulation.objective.objectiveId]: regulation.objective.source as GitObjectiveSource },
        regulation.sourceBindings ?? {},
      ),
      waits: [],
      reached: -1,
      stalledRuns: 0,
      retiring: false,
      ...(lease === undefined ? {} : { lease }),
    };
    return node;
  }

  private async command(input: CoordinatorCommand): Promise<void> {
    let commandId: string | undefined;
    try {
      const command = structuredClone(input);
      commandId = command?.commandId;
      if (typeof commandId !== "string" || !commandId.trim())
        throw new TypeError("Command correlation ID is required.");
      const expected =
        command.type === "add"
          ? ["type", "commandId", "regulation"]
          : command.type === "replace"
            ? ["type", "commandId", "generation", "regulation"]
            : command.type === "priority"
              ? ["type", "commandId", "id", "generation", "priority"]
              : ["type", "commandId", "id", "generation"];
      fields(command, expected);
      if (!["add", "replace", "cancel", "priority", "retry"].includes(command.type))
        throw new TypeError("Unknown command type.");
      if (command.type === "add" || command.type === "replace")
        validateRegulation(command.regulation);
      const id =
        command.type === "add" || command.type === "replace" ? command.regulation.id : command.id;
      const uid = this.roots.get(id);
      const previous =
        uid === undefined && command.type === "retry"
          ? [...this.nodes.values()].find((node) => node.work.id === id && !node.retiring)
          : uid === undefined
            ? undefined
            : this.nodes.get(uid);
      if (command.type === "add") {
        if (previous) throw new TypeError("Regulation already exists.");
      } else if (!previous || previous.work.generation !== command.generation) {
        throw new TypeError("Unknown Regulation or stale generation.");
      }
      let work: WorkRef;
      if (command.type === "add" || command.type === "replace") {
        const generation = (this.generations.get(id) ?? 0) + 1;
        work = { id, generation };
        const node = this.makeNode(command.regulation, work);
        this.generations.set(id, generation);
        if (previous) {
          previous.waits = [];
          previous.resolution?.abort();
        }
        this.nodes.set(node.uid, node);
        this.roots.set(id, node.uid);
      } else {
        if (!previous) throw new Error("Validated root disappeared.");
        work = previous.work;
        switch (command.type) {
          case "cancel":
            this.roots.delete(id);
            previous.waits = [];
            previous.resolution?.abort();
            break;
          case "priority":
            if (!priority(command.priority)) throw new TypeError("Invalid priority.");
            // Root intent is immutable except for the explicitly mutable priority.
            previous.regulation = { ...previous.regulation, priority: command.priority };
            break;
          case "retry":
            if (previous.state !== "blocked")
              throw new TypeError("Only blocked work can be explicitly retried.");
            previous.state = "queued";
            previous.waits = [];
            delete previous.blockedReason;
            break;
        }
      }
      await this.emit({ type: "accepted", commandId, operation: command.type, work });
    } catch (error) {
      await this.emit({
        type: "rejected",
        ...(typeof commandId === "string" ? { commandId } : {}),
        reason: reason(error),
      });
    }
  }

  private async updateResources(input: readonly AgentResource[]): Promise<void> {
    try {
      const resources = structuredClone(input);
      validateResources(resources);
      this.resources = resources;
      this.resourcesValid = true;
      await this.emit({ type: "resources-accepted", resourceIds: resources.map(({ id }) => id) });
    } catch (error) {
      this.resourcesValid = false;
      await this.emit({ type: "failure", stage: "resources", reason: reason(error) });
    }
    await this.stopInvalidRuns();
  }

  private async stopInvalidRuns(): Promise<void> {
    const kept = new Map<string, number>();
    const runs = [...this.runs.values()].sort(
      (a, b) => a.node.priority - b.node.priority || a.node.order - b.node.order,
    );
    for (const run of runs) {
      const resource = this.resourcesValid
        ? this.resources.find(({ id }) => id === run.resource.id)
        : undefined;
      const load = kept.get(run.resource.id) ?? 0;
      const valid =
        resource &&
        canonicalJson(resource.binding) === canonicalJson(run.resource.binding) &&
        run.requirements.every((item) => resource.capabilities.includes(item)) &&
        load < resource.capacity;
      if (valid) kept.set(run.resource.id, load + 1);
      else await this.stop(run, "resource-revoked-or-shrunk");
    }
  }

  private async stop(run: Run, why: string): Promise<void> {
    if (run.status === "stopping") return;
    run.status = "stopping";
    await this.emit({ type: "stopping", work: run.node.work, runId: run.id, reason: why });
    try {
      run.handle.abort();
    } catch (error) {
      await this.emit({
        type: "failure",
        stage: "abort",
        work: run.node.work,
        runId: run.id,
        reason: reason(error),
      });
    }
    run.timer = setTimeout(() => {
      void this.post({ type: "kill", run });
    }, this.options.abortGraceMs);
  }

  private async release(lease: ResolvedObjective, work: WorkRef): Promise<void> {
    try {
      await lease.release();
    } catch (error) {
      this.cleanupFailures++;
      await this.emit({ type: "failure", stage: "release", work, reason: reason(error) });
    }
  }

  private async reclaim(node: Node): Promise<void> {
    if (this.nodes.get(node.uid) !== node) return;
    this.nodes.delete(node.uid);
    if (node.lease) await this.release(node.lease, node.work);
    await this.emit({ type: "reclaimed", work: node.work });
  }

  private async reconcile(): Promise<void> {
    const reachable = new Set<string>();
    const visit = (uid: string) => {
      if (reachable.has(uid)) return;
      reachable.add(uid);
      for (const edge of this.nodes.get(uid)?.waits ?? []) visit(edge.provider);
    };
    for (const uid of this.roots.values()) visit(uid);
    for (const node of this.nodes.values()) {
      if (!reachable.has(node.uid)) {
        node.retiring = true;
        node.resolution?.abort();
        const run = [...this.runs.values()].find((entry) => entry.node.uid === node.uid);
        if (run) await this.stop(run, "unreachable");
        else if (!node.resolution) await this.reclaim(node);
      }
    }
    const live = [...this.nodes.values()].filter((node) => !node.retiring);
    for (const node of live) {
      const root = this.roots.get(node.work.id) === node.uid;
      node.target = root
        ? node.regulation.targetLevel
        : node.regulation.objective.manifest.levels[0].id;
      node.priority = root ? node.regulation.priority : Number.MAX_SAFE_INTEGER;
      node.requirements = root ? [...(node.regulation.requirements ?? [])] : [];
    }
    // Acyclic graph: at most |V| passes propagate all inherited constraints.
    for (let pass = 0; pass < live.length; pass++) {
      for (const consumer of live)
        for (const edge of consumer.waits) {
          const provider = this.nodes.get(edge.provider);
          if (!provider || provider.retiring) continue;
          if (
            levelRank(provider.regulation.objective, edge.minimum) >
            levelRank(provider.regulation.objective, provider.target)
          )
            provider.target = edge.minimum;
          provider.priority = Math.min(provider.priority, consumer.priority);
          provider.requirements = [
            ...new Set([...provider.requirements, ...consumer.requirements]),
          ];
        }
    }
    for (const node of live) {
      if (
        node.state === "waiting" &&
        node.waits.every((edge) => {
          const provider = this.nodes.get(edge.provider);
          return (
            provider && provider.reached >= levelRank(provider.regulation.objective, edge.minimum)
          );
        })
      )
        node.state = "queued";
      if (node.state === "done" && node.reached < levelRank(node.regulation.objective, node.target))
        node.state = "queued";
      const run = [...this.runs.values()].find((entry) => entry.node.uid === node.uid);
      if (
        run &&
        (levelRank(node.regulation.objective, run.target) <
          levelRank(node.regulation.objective, node.target) ||
          node.requirements.some((item) => !run.requirements.includes(item)))
      )
        await this.stop(run, "requirements-strengthened");
    }
    if (this.closing || !this.resourcesValid) return;
    for (const node of live
      .filter((entry) => entry.state === "queued")
      .sort((a, b) => a.priority - b.priority || a.order - b.order)) {
      if (this.budgetExhausted()) {
        await this.block(node, "trusted-budget-exhausted");
        continue;
      }
      const resource = this.choose(node, [...this.runs.values()]);
      if (resource) {
        await this.start(node, resource);
      } else {
        await this.emitBlockedOnce(
          node,
          this.resources.some((entry) => supports(entry, goal(node)))
            ? "capacity-unavailable"
            : "capability-unavailable",
        );
        if (node.priority === 0) {
          for (const victim of this.victims(node)) await this.stop(victim, "p0-preemption");
        }
      }
    }
  }

  private choose(node: Node, runs: readonly Run[]): AgentResource | undefined {
    if (
      runs.length >= this.options.maxConcurrency ||
      runs.some((run) => identity(run.node.regulation) === identity(node.regulation))
    )
      return undefined;
    return this.resources
      .filter(
        (resource) =>
          supports(resource, goal(node)) &&
          runs.filter((run) => run.resource.id === resource.id).length < resource.capacity,
      )
      .sort((a, b) => {
        const load = (entry: AgentResource) =>
          runs.filter((run) => run.resource.id === entry.id).length / entry.capacity;
        return load(a) - load(b) || a.id.localeCompare(b.id);
      })[0];
  }

  private victims(node: Node): readonly Run[] {
    let best: Run[] | undefined;
    for (const resource of this.resources.filter((entry) => supports(entry, goal(node)))) {
      const remaining = [...this.runs.values()];
      const removed: Run[] = [];
      const remove = (run: Run | undefined): boolean => {
        if (!run || run.status === "stopping" || run.node.priority === 0) return false;
        remaining.splice(remaining.indexOf(run), 1);
        removed.push(run);
        return true;
      };
      const same = remaining.find(
        (run) => identity(run.node.regulation) === identity(node.regulation),
      );
      if (same && !remove(same)) continue;
      const candidates = () =>
        remaining
          .filter((run) => run.status === "running" && run.node.priority > 0)
          .sort((a, b) => b.node.priority - a.node.priority || b.node.order - a.node.order);
      while (
        remaining.filter((run) => run.resource.id === resource.id).length >= resource.capacity
      ) {
        if (!remove(candidates().find((run) => run.resource.id === resource.id))) break;
      }
      while (remaining.length >= this.options.maxConcurrency) {
        if (!remove(candidates()[0])) break;
      }
      if (
        remaining.filter((run) => run.resource.id === resource.id).length < resource.capacity &&
        remaining.length < this.options.maxConcurrency &&
        !remaining.some((run) => identity(run.node.regulation) === identity(node.regulation)) &&
        (!best || removed.length < best.length)
      )
        best = removed;
    }
    return best ?? [];
  }

  private budgetExhausted(): boolean {
    return (
      this.starts >= this.options.budget.maxStarts ||
      this.reservedAgentRuns + this.options.quota.maxAgentRuns > this.options.budget.maxAgentRuns ||
      this.reservedDuration + this.options.quota.timeoutMs > this.options.budget.maxDurationMs
    );
  }

  private async emitBlockedOnce(node: Node, why: string): Promise<void> {
    if (node.blockedReason === why) return;
    node.blockedReason = why;
    await this.emit({ type: "blocked", work: node.work, reason: why });
  }

  private async block(node: Node, why: string): Promise<void> {
    node.state = "blocked";
    await this.emitBlockedOnce(node, why);
  }

  private async start(node: Node, resource: AgentResource): Promise<void> {
    this.starts++;
    this.reservedAgentRuns += this.options.quota.maxAgentRuns;
    this.reservedDuration += this.options.quota.timeoutMs;
    const id = `run:${++this.counter}`;
    delete node.blockedReason;
    try {
      const input = {
        spec: makeRegulatorSpec(
          node.regulation.objective,
          {
            targetLevel: node.target,
            quota: this.options.quota,
            agentExecutionLimits: this.options.agentExecutionLimits,
          },
          resource.binding,
        ),
        subject: structuredClone(node.regulation.subject),
        permissions: this.options.permissions,
        history: { stalledRuns: node.stalledRuns },
        sourceBindings: structuredClone(node.sources),
        ...(node.regulation.language === undefined ? {} : { language: node.regulation.language }),
      };
      const handle = this.options.runner.start(
        input,
        structuredClone(resource),
        Object.freeze({
          runId: id,
          work: Object.freeze({ ...node.work }),
          report: (feedback: CoordinatorFeedback) =>
            this.post({ type: "feedback", runId: id, work: node.work, feedback }),
        }),
      );
      const run: Run = {
        id,
        node,
        resource,
        handle,
        target: node.target,
        requirements: [...node.requirements],
        status: "running",
      };
      this.runs.set(id, run);
      node.state = "running";
      void Promise.resolve(handle.result).then(
        (outcome) => this.post({ type: "settled", run, outcome }),
        (error: unknown) => this.post({ type: "settled", run, error }),
      );
      await this.emit({
        type: "started",
        work: node.work,
        runId: id,
        resourceId: resource.id,
        priority: node.priority,
        targetLevel: node.target,
        requirements: [...node.requirements],
      });
    } catch (error) {
      await this.emit({
        type: "failure",
        stage: "start",
        work: node.work,
        runId: id,
        reason: reason(error),
      });
      await this.block(node, "start-failed-explicit-retry-required");
    }
  }

  private async terminated(run: Run, why: string): Promise<void> {
    if (this.runs.get(run.id) !== run) return;
    if (run.timer) clearTimeout(run.timer);
    this.runs.delete(run.id);
    const node = this.nodes.get(run.node.uid);
    if (node && !node.retiring) node.state = "queued";
    await this.emit({ type: "terminated", work: run.node.work, runId: run.id, reason: why });
  }

  private async settled(message: Extract<Message, { type: "settled" }>): Promise<void> {
    const { run } = message;
    const node = this.nodes.get(run.node.uid);
    if (this.runs.get(run.id) !== run || !node || node.retiring || run.status === "stopping") {
      await this.emit({
        type: "stale-result",
        work: run.node.work,
        runId: run.id,
        reason: "obsolete-or-stopping-execution",
      });
      await this.terminated(run, "result-settled");
      return;
    }
    if (run.timer) clearTimeout(run.timer);
    this.runs.delete(run.id);
    if (!message.outcome) {
      await this.emit({
        type: "failure",
        stage: "execution",
        work: node.work,
        runId: run.id,
        reason: reason(message.error),
      });
      await this.block(node, "execution-failed-explicit-retry-required");
      return;
    }
    const outcome = message.outcome;
    try {
      const value = observation({ ...node.regulation, sourceBindings: node.sources }, outcome);
      if (outcome.iterations > this.options.quota.maxAgentRuns)
        throw new TypeError("Execution exceeds reserved agent budget.");
      if (
        !["target-reached", "dependency-required", "authorization-required", "exhausted"].includes(
          outcome.stopReason,
        )
      )
        throw new TypeError("Unknown Regulation outcome.");
      if (
        outcome.stopReason === "target-reached" &&
        levelRank(node.regulation.objective, value.current.levelId) <
          levelRank(node.regulation.objective, node.target)
      )
        throw new TypeError("Target-reached outcome is below the requested level.");
      node.sources = mergeSources(node.sources, value.sources ?? {});
      node.stalledRuns = Math.max(node.stalledRuns, outcome.stalledRuns);
      await this.emit({
        type: "result",
        work: node.work,
        runId: run.id,
        outcome: structuredClone(outcome),
      });
      switch (outcome.stopReason) {
        case "dependency-required":
          this.resolve(node, outcome.dependencies, value.versions, value.sources ?? {});
          break;
        case "target-reached":
          node.reached = levelRank(node.regulation.objective, value.current.levelId);
          node.waits = [];
          node.state = "done";
          break;
        case "authorization-required":
          await this.block(node, "authorization-required");
          break;
        case "exhausted":
          await this.block(node, "quota-exhausted-explicit-retry-required");
          break;
        default:
          throw new TypeError("Unknown Regulation outcome.");
      }
    } catch (error) {
      await this.emit({
        type: "failure",
        stage: "evidence",
        work: node.work,
        runId: run.id,
        reason: reason(error),
      });
      await this.block(node, "invalid-evidence-explicit-retry-required");
    }
  }

  private resolve(
    node: Node,
    dependencies: readonly DependencyProblem[],
    versions: Readonly<Record<string, string>>,
    sources: Readonly<Record<string, GitObjectiveSource>>,
  ): void {
    node.state = "resolving";
    const controller = new AbortController();
    node.resolution = controller;
    this.pendingResolutions++;
    void (async () => {
      const resolutions: Resolution[] = [];
      try {
        for (const value of dependencies) {
          const requirement = parseDependencyProblem(value);
          const version = versions[requirement.objectiveId];
          const source = sources[requirement.objectiveId];
          if (!version || !source) throw new TypeError("Missing exact dependency source/version.");
          if (controller.signal.aborted) throw new Error("Obsolete dependency resolution.");
          const lease = await this.options.resolveObjective(
            requirement.objectiveId,
            version,
            structuredClone(source),
            controller.signal,
          );
          resolutions.push({ requirement, lease });
          if (controller.signal.aborted) throw new Error("Obsolete dependency resolution.");
          if (
            lease.spec.objectiveId !== requirement.objectiveId ||
            lease.spec.version !== version ||
            canonicalJson(lease.spec.source) !== canonicalJson(source)
          )
            throw new TypeError("Resolver returned a different exact source/version.");
          validateSpec(lease.spec, requirement.subject);
          if (
            levelRank(lease.spec, requirement.currentLevelId) >=
            levelRank(lease.spec, requirement.expectedLevelId)
          )
            throw new TypeError("Dependency current level must be below required level.");
        }
        await this.post({ type: "resolved", node, controller, resolutions });
      } catch (error) {
        await this.post({ type: "resolved", node, controller, resolutions, error });
      }
    })();
  }

  private async resolved(message: Extract<Message, { type: "resolved" }>): Promise<void> {
    const { node, controller, resolutions } = message;
    this.pendingResolutions--;
    const current = this.nodes.get(node.uid);
    const stale =
      !current ||
      current.retiring ||
      current.resolution !== controller ||
      controller.signal.aborted ||
      this.closing;
    if (current?.resolution === controller) {
      delete current.resolution;
      if (stale && !current.retiring && !this.closing) current.state = "queued";
    }
    const retained = new Set<ResolvedObjective>();
    try {
      if (stale) return;
      if (message.error !== undefined) throw message.error;
      const additions = new Map<string, Node>();
      const sourceUpdates = new Map<Node, Record<string, GitObjectiveSource>>();
      const waits: Edge[] = [];
      for (const { requirement, lease } of resolutions) {
        const regulation: Regulation = {
          id: `$dependency:${++this.counter}`,
          objective: structuredClone(lease.spec),
          subject: structuredClone(requirement.subject),
          targetLevel: requirement.expectedLevelId,
          priority: current.priority,
          ...(current.regulation.language === undefined
            ? {}
            : { language: current.regulation.language }),
          sourceBindings: current.sources,
        };
        let provider = [...this.nodes.values(), ...additions.values()].find(
          (entry) => !entry.retiring && identity(entry.regulation) === identity(regulation),
        );
        if (!provider) {
          provider = this.makeNode(regulation, { id: regulation.id, generation: 1 }, lease);
          additions.set(provider.uid, provider);
        }
        const merged = mergeSources(
          sourceUpdates.get(provider) ?? provider.sources,
          current.sources,
        );
        sourceUpdates.set(provider, merged);
        waits.push({ provider: provider.uid, minimum: requirement.expectedLevelId });
      }
      const graph = new Map(
        [...this.nodes.values(), ...additions.values()].map((entry) => [entry.uid, entry.waits]),
      );
      graph.set(current.uid, waits);
      const visiting = new Set<string>();
      const visited = new Set<string>();
      const visit = (uid: string) => {
        if (visiting.has(uid)) throw new TypeError("Dependency cycle candidate rejected.");
        if (visited.has(uid)) return;
        visiting.add(uid);
        for (const edge of graph.get(uid) ?? []) visit(edge.provider);
        visiting.delete(uid);
        visited.add(uid);
      };
      for (const uid of graph.keys()) visit(uid);
      // No state above this point is installed until the complete candidate passes.
      for (const entry of additions.values()) {
        this.nodes.set(entry.uid, entry);
        if (entry.lease) retained.add(entry.lease);
      }
      for (const [provider, sources] of sourceUpdates) provider.sources = sources;
      current.waits = waits;
      current.state = "waiting";
      await this.emit({
        type: "dependencies",
        work: current.work,
        providers: waits.map((edge) => ({
          ...(this.nodes.get(edge.provider) as Node).work,
          minimumLevel: edge.minimum,
        })),
      });
    } catch (error) {
      if (current && !stale) {
        await this.emit({
          type: "failure",
          stage: "dependency",
          work: current.work,
          reason: reason(error),
        });
        await this.block(current, "dependency-failed-explicit-retry-required");
      }
    } finally {
      for (const { lease } of resolutions)
        if (!retained.has(lease)) await this.release(lease, node.work);
    }
  }
}
