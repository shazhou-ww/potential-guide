export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Subject = { [key: string]: Json };
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
