import type { CheckManifest } from "@potential-guide/check-artifacts";
import type { Json, Subject } from "./types.js";

export type Freshness = "started-after-request" | "completed-after-request";
export interface CheckRequest {
  check: { url: string; digest?: string };
  subject: Subject;
  context?: Subject;
  freshness?: Freshness;
  timeoutMs?: number;
}
export type TaskState =
  | "accepted"
  | "preparing"
  | "waiting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export interface TaskError {
  code: string;
  stage: string;
  message: string;
}
export interface ArtifactMetadata {
  digest: string;
  revision: string;
  source: string;
  checkedAt: string;
  transportDigest?: string;
  manifest: CheckManifest;
}
export interface CheckTaskSnapshot {
  taskId: string;
  hostInstance: string;
  revision: number;
  state: TaskState;
  acceptedAt: string;
  freshness: Freshness;
  artifact?: ArtifactMetadata;
  executionId?: string;
  executionStartedAt?: string;
  executionCompletedAt?: string;
  result?: Json;
  error?: TaskError;
}
export interface TaskEvent {
  taskId: string;
  snapshot: CheckTaskSnapshot;
  unavailable?: TaskError;
}
export interface CheckObservation extends CheckTaskSnapshot {
  state: "completed";
  artifact: ArtifactMetadata;
  executionId: string;
  executionStartedAt: string;
  executionCompletedAt: string;
  result: Json;
}
export const taskTerminal = (state: CheckTaskSnapshot) =>
  state.state === "completed" || state.state === "failed" || state.state === "cancelled";
export class TaskProtocolError extends Error {
  constructor(
    readonly status: number,
    readonly detail: TaskError,
  ) {
    super(detail.message);
  }
}
export function canonicalJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`)
      .join(",")}}`;
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite JSON.");
  return JSON.stringify(value);
}
export const v2Limits = {
  records: 256,
  executions: 256,
  artifacts: 32,
  preparations: 4,
  observers: 64,
  filterTasks: 64,
  timeoutMs: 30_000,
  maxTimeoutMs: 120_000,
  retentionMs: 60_000,
  preparationMs: 30_000,
};
