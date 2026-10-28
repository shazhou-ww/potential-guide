import type { SubscriptionRef } from "@potential-guide/effects";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Subject = { [key: string]: Json };
export type CheckState =
  | { checkId: string; state: "Queued" | "Running" | "Cancelling"; progress?: Json }
  | { checkId: string; state: "Completed"; result: Json }
  | { checkId: string; state: "Failed"; error: string }
  | { checkId: string; state: "Cancelled" };
export interface Execution {
  readonly checkId: string;
  readonly state: SubscriptionRef.SubscriptionRef<CheckState>;
}
export interface StartCheck {
  checkId: string;
  directory: string;
  revision: string;
  subject: Subject;
  context?: Subject;
}
export interface WorkerContext {
  readonly signal: AbortSignal;
  readonly data: Subject;
  readonly deadline: number;
  readonly progress: (value: Json) => void;
  readonly defer: (cleanup: () => void | Promise<void>) => void;
}
export interface WorkerModule {
  initialize?: () => void | Promise<void>;
  execute: (subject: Subject, context: WorkerContext) => Json | Promise<Json>;
  dispose?: () => void | Promise<void>;
}
export const terminal = (state: CheckState): boolean =>
  ["Completed", "Failed", "Cancelled"].includes(state.state);
export { HostError } from "@potential-guide/check-runtime-files";
export const defaults = {
  workers: 4,
  queue: 64,
  records: 256,
  directories: 64,
  retireAfter: 100,
  deadlineMs: 30_000,
  cleanupMs: 5_000,
  retentionMs: 60_000,
  messageBytes: 8 * 1024 * 1024,
  observers: 64,
};
