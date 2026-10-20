import type { JSONSchema } from "json-schema-typed";

export type { JSONSchema } from "json-schema-typed";
export type SubjectSchema = Exclude<JSONSchema, boolean> & { readonly type: "object" };
export type ObjectiveId = string;
export type SpecVersion = string;
export interface GitObjectiveSource {
  readonly kind: "git-tree";
  readonly repository: string;
  readonly directory: string;
  readonly commit: string;
  readonly tree: string;
  /** Independent evidence for repository-external-to-folder files materialized with this Pilot. */
  readonly repositoryTree: string;
}
export type LevelId = string;
export type CheckId = string;
export type ProblemId = string;
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;
export type JsonObject = Readonly<{ [key: string]: JsonValue }>;
export type Subject = JsonObject;
export type ObjectiveContext = {
  readonly repo: { readonly rootPath: string; readonly origin: string | null } | null;
  readonly path: string;
};
export interface LevelRef {
  readonly objectiveId: ObjectiveId;
  readonly levelId: LevelId;
}
export interface CheckRef extends LevelRef {
  readonly checkId: CheckId;
}
export interface ProblemRef extends CheckRef {
  readonly problemId: ProblemId;
}
export interface InternalProblem {
  readonly kind: "internal";
  readonly ref: ProblemRef;
  readonly parameters: JsonObject;
}
export interface DependencyProblem {
  readonly kind: "dependency";
  readonly objectiveId: ObjectiveId;
  readonly subject: Subject;
  readonly expectedLevelId: LevelId;
  readonly currentLevelId: LevelId;
}
export type Problem = InternalProblem | DependencyProblem;
export type CheckProblem =
  | { readonly kind: "internal"; readonly id: ProblemId; readonly parameters: JsonObject }
  | DependencyProblem;
export interface InvocationError {
  readonly kind: string;
  readonly message: string;
}
export type Envelope<A> =
  | { readonly status: 200; readonly payload: A; readonly message: string }
  | { readonly status: number; readonly payload: null; readonly message: string };
export type Sample<A> =
  | { readonly state: "initial" }
  | { readonly state: "ready"; readonly value: A };
export type CheckResult =
  | { readonly ok: true; readonly problems: readonly [] }
  | {
      readonly ok: false;
      readonly problems: readonly [CheckProblem, ...CheckProblem[]];
    };
export type CheckProbe = (subject: Subject, signal: AbortSignal) => Promise<Envelope<CheckResult>>;
export interface ObjectiveManifest {
  readonly $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v1.json";
  readonly subjectSchema: SubjectSchema;
  readonly levels: readonly [
    {
      readonly id: LevelId;
      readonly checks: readonly {
        readonly id: CheckId;
        readonly problems: readonly ProblemId[];
      }[];
    },
    ...{
      readonly id: LevelId;
      readonly checks: readonly {
        readonly id: CheckId;
        readonly problems: readonly ProblemId[];
      }[];
    }[],
  ];
  readonly defaultLanguage: string;
  readonly languages: readonly [string, ...string[]];
}
export interface ReferencePageSummary {
  readonly id: string;
  readonly title: string;
}
export interface ReferencePage extends ReferencePageSummary {
  readonly description: string;
  readonly references: readonly string[];
  readonly content: string;
}
export interface PilotSpec {
  readonly objectiveId: ObjectiveId;
  readonly version: SpecVersion;
  readonly source?: GitObjectiveSource;
  readonly manifest: ObjectiveManifest;
  readonly locales: Readonly<Record<string, Readonly<Record<string, ReferencePage>>>>;
}
export interface PilotInput {
  readonly spec: PilotSpec;
  readonly subject: Subject;
  readonly language?: string;
}
export interface PilotObservation {
  readonly current: LevelRef;
  readonly problems: readonly Problem[];
  readonly gapSummary: string;
  readonly observedAt: string;
  readonly versions: Readonly<Record<ObjectiveId, SpecVersion>>;
  readonly sources?: Readonly<Record<ObjectiveId, GitObjectiveSource>>;
}
export interface PilotRuntime {
  readonly boundObjectives?: () => readonly PilotSpec[];
  readonly onObservation?: (value: Envelope<PilotObservation>) => void;
  readonly resolveCheck: (ref: CheckRef) => CheckProbe;
  readonly checkConcurrency?: number;
  readonly resolveObjective?: (
    objectiveId: ObjectiveId,
    version: SpecVersion | undefined,
    signal: AbortSignal,
    source?: GitObjectiveSource,
  ) => Promise<{ readonly spec: PilotSpec; readonly runtime: PilotRuntime }>;
  readonly observationBudget?: {
    readonly timeoutMs: number;
    readonly maxDepth: number;
    readonly maxObservations: number;
  };
}
export interface PageResource {
  readonly uri: string;
  readonly source: string;
}
export interface ResourceResolver {
  readonly version: SpecVersion;
  versionFor?(objectiveId: ObjectiveId): Promise<SpecVersion>;
  sourceFor?(objectiveId: ObjectiveId): Promise<GitObjectiveSource>;
  readText(uri: string): Promise<string>;
  readPages(uri: string): Promise<readonly PageResource[]>;
}
export interface SubjectValidationIssue {
  readonly instancePath: string;
  readonly keyword: string;
  readonly message: string;
}
export type ValidationIssues = readonly [SubjectValidationIssue, ...SubjectValidationIssue[]];
