import type { Stream } from "@potential-guide/effects";
import type {
  Envelope,
  ObjectiveSource,
  PilotObservation,
  PilotSpec,
  Subject,
} from "@potential-guide/objective-pilot";
import type { AgentResource, RunHandle } from "@potential-guide/objective-portfolio-supervisor";
import type {
  AgentExecutionLimits,
  AuthorizationRequest,
  RegulationInput,
  RegulationOutcome,
  RegulationPermissions,
  RegulationQuota,
} from "@potential-guide/objective-regulator";

export type { AgentResource, RunHandle };

export type CoordinatorFeedback =
  | { readonly type: "capability-request"; readonly capability: string; readonly reason: string }
  | { readonly type: "authorization-request"; readonly request: AuthorizationRequest }
  | { readonly type: "observation"; readonly observation: Envelope<PilotObservation> };

export interface ExecutionContext {
  readonly runId: string;
  readonly work: WorkRef;
  /** Serializes requests or exact run observations; never grants authority. */
  readonly report: (feedback: CoordinatorFeedback) => Promise<void>;
}

export interface RegulationRunner {
  start(input: RegulationInput, resource: AgentResource, execution: ExecutionContext): RunHandle;
}

export interface Regulation {
  readonly id: string;
  readonly objective: PilotSpec;
  readonly subject: Subject;
  readonly targetLevel: string;
  readonly priority: number;
  readonly requirements?: readonly string[];
  readonly language?: string;
  readonly sourceBindings?: Readonly<Record<string, ObjectiveSource>>;
}

export type CoordinatorCommand =
  | { readonly type: "add"; readonly commandId: string; readonly regulation: Regulation }
  | {
      readonly type: "replace";
      readonly commandId: string;
      readonly generation: number;
      readonly regulation: Regulation;
    }
  | {
      readonly type: "cancel" | "retry";
      readonly commandId: string;
      readonly id: string;
      readonly generation: number;
    }
  | {
      readonly type: "priority";
      readonly commandId: string;
      readonly id: string;
      readonly generation: number;
      readonly priority: number;
    };

export interface WorkRef {
  readonly id: string;
  readonly generation: number;
}

export type CoordinatorFact =
  | {
      readonly type: "accepted";
      readonly commandId: string;
      readonly operation: CoordinatorCommand["type"];
      readonly work: WorkRef;
    }
  | { readonly type: "rejected"; readonly commandId?: string; readonly reason: string }
  | {
      readonly type: "started";
      readonly work: WorkRef;
      readonly runId: string;
      readonly resourceId: string;
      readonly priority: number;
      readonly targetLevel: string;
      readonly requirements: readonly string[];
    }
  | {
      readonly type: "result";
      readonly work: WorkRef;
      readonly runId: string;
      readonly outcome: RegulationOutcome;
    }
  | {
      readonly type: "dependencies";
      readonly work: WorkRef;
      readonly providers: readonly (WorkRef & { readonly minimumLevel: string })[];
    }
  | {
      readonly type: "blocked";
      readonly work: WorkRef;
      readonly reason: string;
    }
  | (CoordinatorFeedback & {
      readonly work: WorkRef;
      readonly runId: string;
    })
  | {
      readonly type: "stopping" | "terminated" | "stale-result";
      readonly work: WorkRef;
      readonly runId: string;
      readonly reason: string;
    }
  | { readonly type: "reclaimed"; readonly work: WorkRef }
  | {
      readonly type: "failure";
      readonly stage:
        | "command-input"
        | "resource-input"
        | "resources"
        | "start"
        | "execution"
        | "evidence"
        | "dependency"
        | "abort"
        | "kill"
        | "release"
        | "feedback"
        | "infrastructure";
      readonly reason: string;
      readonly work?: WorkRef;
      readonly runId?: string;
    }
  | { readonly type: "input-ended"; readonly input: "commands" | "resources" }
  | { readonly type: "resources-accepted"; readonly resourceIds: readonly string[] }
  | { readonly type: "closed"; readonly cleanupFailures: number };

export type CoordinatorEvent = CoordinatorFact & { readonly sequence: number };

/** One acquisition, one release; even duplicate resolutions must return their own lease. */
export interface ResolvedObjective {
  readonly spec: PilotSpec;
  readonly release: () => Promise<void>;
}

export interface CoordinatorOptions {
  readonly runner: RegulationRunner;
  readonly resolveObjective: (
    objectiveId: string,
    version: string,
    source: ObjectiveSource,
    signal: AbortSignal,
  ) => Promise<ResolvedObjective>;
  readonly permissions: RegulationPermissions;
  readonly quota: RegulationQuota;
  readonly agentExecutionLimits: AgentExecutionLimits;
  readonly maxConcurrency: number;
  readonly abortGraceMs: number;
  /** Reservations never replenish, including replace, retry, and derived work. */
  readonly budget: {
    readonly maxStarts: number;
    readonly maxAgentRuns: number;
    readonly maxDurationMs: number;
  };
  readonly bufferSize?: number;
}

export interface RegulationCoordinator {
  /** Live, bounded, lossless multicast while subscribed; no replay before subscription. */
  readonly events: Stream.Stream<CoordinatorEvent>;
}
