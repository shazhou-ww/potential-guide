import type { ResolvedTaskBundle } from "@potential-guide/task-protocol/worker";

export interface TaskBinding {
  declaration: ResolvedTaskBundle;
  validators: {
    input: (value: unknown) => boolean;
    result: (value: unknown) => boolean;
    message: (value: unknown) => boolean;
  };
}

/** Replaced by the Bundle builder, never supplied by author code or workerData. */
export const binding: TaskBinding | undefined = undefined;
