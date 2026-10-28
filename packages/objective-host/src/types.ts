import type {
  ArtifactReference,
  CheckerProblem,
  JsonObject,
} from "@potential-guide/check-artifacts";
import type { CheckerSnapshot, ServiceSnapshot, TaskOptions } from "@potential-guide/checker-host";

export interface ProbeRequest extends TaskOptions {
  objective: { url: string; digest?: string };
  subject: JsonObject;
  context?: JsonObject;
  language?: string;
  bindings?: Record<string, string>;
  targetLevel?: "initial";
}
export type ExactObjective = ArtifactReference & { kind: "objective"; digest: string };
export interface ObjectiveObservation {
  current: { objective: ExactObjective; levelId: string };
  problems: {
    objective: ExactObjective;
    levelId: string;
    checker: string;
    problem: CheckerProblem;
  }[];
  gapSummary: string;
  observedAt: string;
  bindings: Record<string, string>;
}
export interface InvocationProgress {
  id: string;
  observationId: string;
  objective: ExactObjective;
  level: string;
  checker: string;
  taskId?: string;
  executionId?: string;
  state: CheckerSnapshot["state"] | "mapping";
}
export interface ObservationProgress {
  id: string;
  parentInvocation?: string;
  objective: ExactObjective;
  currentLevel: string;
  attainedLevel: string;
  levels: { id: string; state: "pending" | "running" | "passed" | "blocked" }[];
}
export interface ProbeProgress {
  observations: ObservationProgress[];
  invocations: InvocationProgress[];
}
export interface ProbeEvidence {
  bindings: Record<string, string>;
  checks: { invocationId: string; snapshot: CheckerSnapshot }[];
}
export type ProbeSnapshot = ServiceSnapshot<ObjectiveObservation, ProbeProgress, ProbeEvidence>;
