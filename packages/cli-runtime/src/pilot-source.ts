import { CliError } from "@potential-guide/cli-core";
import type { ObjectiveSource, PilotRuntime, PilotSpec } from "@potential-guide/objective-pilot";
import type { PackagePreparationOptions } from "./package-source.js";

export async function withPilot<T>(
  _location: string,
  _cwd: string,
  _revision: string | undefined,
  _use: (spec: PilotSpec, runtime: PilotRuntime) => Promise<T>,
  options: PilotSourceOptions = {},
): Promise<T> {
  options.signal?.throwIfAborted();
  throw pilotExecutionError();
}

export function assertPilotExecutionSupported(): void {
  throw pilotExecutionError();
}

function pilotExecutionError(): CliError {
  return new CliError(
    "Legacy Pilot execution is retired. The old probe/scaffold/validate CLI is removed; legacy regulate and continue do not execute or migrate Task Bundles.",
    2,
    "pilot-error",
    {
      nextAction:
        "Build Task Bundles with pguide task-bundle build and submit their exact references to the Task Engine.",
      existingRecords: "Existing regulation records are not migrated or replayed.",
    },
  );
}

export interface PilotSourceOptions {
  readonly propagateError?: (cause: unknown) => boolean;
  readonly signal?: AbortSignal;
  readonly reports?: { readonly enabled?: boolean; readonly directory?: string } | undefined;
  readonly versions?: Readonly<Record<string, string>>;
  readonly sources?: Readonly<Record<string, ObjectiveSource>>;
  readonly packagePreparation?: Omit<PackagePreparationOptions, "cacheDirectory" | "signal">;
  readonly packageSpecs?: Readonly<Record<string, string>>;
  readonly cacheDirectory?: string;
  readonly probeTimeoutMs?: number | undefined;
  readonly preparationTimeoutMs?: number;
  readonly observationBudget?: PilotRuntime["observationBudget"];
}

export function pilotSourceBudgets(probe?: {
  readonly timeoutMs: number;
  readonly checkTimeoutMs?: number;
  readonly preparationTimeoutMs?: number;
  readonly observationBudget?: PilotRuntime["observationBudget"];
}): Pick<PilotSourceOptions, "probeTimeoutMs" | "preparationTimeoutMs" | "observationBudget"> {
  return {
    ...(probe === undefined ? {} : { probeTimeoutMs: probe.checkTimeoutMs ?? probe.timeoutMs }),
    ...(probe?.preparationTimeoutMs === undefined
      ? {}
      : { preparationTimeoutMs: probe.preparationTimeoutMs }),
    ...(probe?.observationBudget === undefined
      ? {}
      : { observationBudget: probe.observationBudget }),
  };
}
