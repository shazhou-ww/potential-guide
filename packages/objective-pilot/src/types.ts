export type ObjectiveId = string;
export type SpecVersion = string;
export type LevelId = string;
export type CheckId = string;
export type ProblemId = string;
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;
export type JsonObject = Readonly<{ [key: string]: JsonValue }>;
export type Subject = JsonObject;
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
export interface Problem {
  readonly ref: ProblemRef;
  readonly parameters: JsonObject;
}
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
      readonly problems: readonly [
        { readonly id: ProblemId; readonly parameters: JsonObject },
        ...{ readonly id: ProblemId; readonly parameters: JsonObject }[],
      ];
    };
export type CheckProbe = (subject: Subject, signal: AbortSignal) => Promise<Envelope<CheckResult>>;
export interface PilotManifest {
  readonly schemaVersion: 1;
  readonly domainSchema: JsonObject;
  readonly levels: readonly [
    {
      readonly id: LevelId;
      readonly advancement: {
        readonly checks: readonly {
          readonly id: CheckId;
          readonly problems: readonly ProblemId[];
        }[];
      };
    },
    ...{
      readonly id: LevelId;
      readonly advancement: {
        readonly checks: readonly {
          readonly id: CheckId;
          readonly problems: readonly ProblemId[];
        }[];
      };
    }[],
  ];
  readonly prerequisite?: {
    readonly manifestUri: string;
    readonly subject: string;
    readonly minimumLevelId?: LevelId;
  };
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
  readonly manifest: PilotManifest;
  readonly prerequisite?: PilotSpec;
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
}
export interface PilotRuntime {
  readonly onObservation?: (value: Envelope<PilotObservation>) => void;
  readonly resolveCheck: (ref: CheckRef) => CheckProbe;
  readonly checkConcurrency?: number;
}
export interface PageResource {
  readonly uri: string;
  readonly source: string;
}
export interface ResourceResolver {
  readonly version: SpecVersion;
  versionFor?(objectiveId: ObjectiveId): Promise<SpecVersion>;
  readText(uri: string): Promise<string>;
  readPages(uri: string): Promise<readonly PageResource[]>;
}
export interface SubjectValidationIssue {
  readonly instancePath: string;
  readonly keyword: string;
  readonly message: string;
}
export type ValidationIssues = readonly [SubjectValidationIssue, ...SubjectValidationIssue[]];
