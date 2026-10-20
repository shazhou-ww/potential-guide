import type { SubscriptionRef } from "@potential-guide/effects";
import type {
  Envelope,
  PilotObservation,
  PilotSpec,
  Subject,
} from "@potential-guide/objective-pilot";
import type {
  AgentBinding,
  AgentExecutionLimits,
  AuthorizationRequest,
  RegulationInput,
  RegulationOutcome,
  RegulationPermissions,
  RegulationStrategy,
} from "@potential-guide/objective-regulator";

export interface ObjectiveGoal {
  readonly id: string;
  readonly pilot: PilotSpec;
  readonly subject: Subject;
  readonly targetLevel: string;
  readonly priority: number;
  readonly observationIntervalMs: number;
  readonly requirements?: readonly string[];
  readonly language?: string;
}
export interface QueueDemand extends ObjectiveGoal {
  readonly revision: number;
}
export interface PriorityQueueSnapshot {
  readonly revision: number;
  readonly demands: readonly QueueDemand[];
}
export interface AgentResource {
  readonly id: string;
  readonly binding: AgentBinding;
  readonly capacity: number;
  readonly capabilities: readonly string[];
}
export interface RunHandle {
  readonly result: Promise<RegulationOutcome>;
  abort(): void;
  /** Resolves only after the execution has actually terminated. */
  kill(): Promise<void>;
}
export interface RegulationRunner {
  start(input: RegulationInput, resource: AgentResource): RunHandle;
}
export interface CapabilityRequest {
  readonly capability: string;
  readonly reason: string;
}
export type CoordinatorEvent =
  | { readonly type: "started"; readonly demand: QueueDemand; readonly resourceId: string }
  | { readonly type: "result"; readonly demand: QueueDemand; readonly outcome: RegulationOutcome }
  | { readonly type: "failed"; readonly demand: QueueDemand; readonly error: unknown }
  | { readonly type: "stopping" | "killed"; readonly demand: QueueDemand }
  | { readonly type: "p0-queued"; readonly demand: QueueDemand }
  | {
      readonly type: "authorization-request";
      readonly demand: QueueDemand;
      readonly request: AuthorizationRequest;
    }
  | {
      readonly type: "capability-request";
      readonly demand: QueueDemand;
      readonly requirements: readonly string[];
      readonly reason?: string;
    };
export interface PlannerPolicyInput {
  readonly goals: readonly ObjectiveGoal[];
  readonly candidates: readonly ObjectiveGoal[];
  readonly observations: Readonly<Record<string, Envelope<PilotObservation>>>;
  readonly previousQueue: PriorityQueueSnapshot;
  readonly events: readonly CoordinatorEvent[];
}
export interface PlannerDirective {
  readonly goalId: string;
  readonly priority: number;
  readonly targetLevel?: string;
  readonly requirements?: readonly string[];
}
export interface PlannerPlan {
  readonly directives: readonly PlannerDirective[];
}
export type PlannerPolicy = (input: PlannerPolicyInput) => Promise<PlannerPlan>;
export interface PlannerState {
  readonly goals: readonly ObjectiveGoal[];
  readonly observations: Readonly<Record<string, Envelope<PilotObservation>>>;
  readonly error?: unknown;
}
export interface PortfolioPlannerOptions {
  readonly goals: readonly ObjectiveGoal[];
  readonly policy?: PlannerPolicy;
  readonly periodic?: boolean;
  readonly resolveObjective?: (
    objectiveId: string,
    version: string,
    signal: AbortSignal,
  ) => Promise<PilotSpec>;
  readonly releaseObjective?: (spec: PilotSpec) => Promise<void>;
  readonly observe: (
    goal: ObjectiveGoal,
    signal: AbortSignal,
  ) => Promise<Envelope<PilotObservation>>;
}
export interface PortfolioPlanner {
  readonly queue: SubscriptionRef.SubscriptionRef<PriorityQueueSnapshot>;
  readonly state: SubscriptionRef.SubscriptionRef<PlannerState>;
  updateGoals(goals: readonly ObjectiveGoal[]): Promise<void>;
  feedback(event: CoordinatorEvent): Promise<void>;
  refresh(): Promise<void>;
  close(): Promise<void>;
}
export interface ActiveRun {
  readonly demand: QueueDemand;
  readonly resourceId: string;
  readonly status: "running" | "stopping";
}
export interface CoordinatorState {
  readonly runs: readonly ActiveRun[];
  readonly events: readonly CoordinatorEvent[];
  readonly error?: unknown;
}
export interface PortfolioCoordinatorOptions {
  readonly queue: SubscriptionRef.SubscriptionRef<PriorityQueueSnapshot>;
  readonly resources: SubscriptionRef.SubscriptionRef<readonly AgentResource[]>;
  readonly runner: RegulationRunner;
  readonly maxConcurrency: number;
  readonly quota: RegulationStrategy["quota"];
  readonly agentExecutionLimits: AgentExecutionLimits;
  readonly abortGraceMs: number;
  readonly permissions?: RegulationPermissions;
  readonly permissionUpdates?: SubscriptionRef.SubscriptionRef<RegulationPermissions | undefined>;
  readonly onEvent?: (event: CoordinatorEvent) => void | Promise<void>;
}
export interface PortfolioCoordinator {
  readonly state: SubscriptionRef.SubscriptionRef<CoordinatorState>;
  reportCapabilityRequest(input: RegulationInput, request: CapabilityRequest): void;
  reportAuthorizationRequest(input: RegulationInput, request: AuthorizationRequest): void;
  close(): Promise<void>;
}
