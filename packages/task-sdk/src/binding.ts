import type { ResolvedTaskBundle } from "@potential-guide/task-protocol/worker";

export interface TaskBinding {
  declaration: ResolvedTaskBundle;
}

/** Replaced by the Bundle builder, never supplied by author code or workerData. */
export const binding: TaskBinding | undefined = undefined;
