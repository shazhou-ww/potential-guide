import {
  jsonObject,
  validateArtifactReference,
  type ArtifactReference,
  type CheckerManifest,
  type JsonObject,
} from "./contracts.js";

export interface DependencyRequirement {
  objective: ArtifactReference & { kind: "objective" };
  subject: JsonObject;
  expectedLevelId: string;
}
export type CheckerProblem =
  | { kind: "internal"; id: string; parameters: JsonObject }
  | ({ kind: "dependency"; currentLevelId: string } & DependencyRequirement);
export interface CheckerResult {
  ok: boolean;
  problems: CheckerProblem[];
  requirements?: DependencyRequirement[];
}
function exact(
  value: unknown,
  required: string[],
  optional: string[] = [],
): asserts value is JsonObject {
  if (
    !jsonObject(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new Error("Invalid Checker result shape.");
}
function requirement(value: unknown, dependency = false): DependencyRequirement {
  exact(value, [
    "objective",
    "subject",
    "expectedLevelId",
    ...(dependency ? ["kind", "currentLevelId"] : []),
  ]);
  exact(value.objective, ["kind", "url"], ["digest"]);
  if (
    value.objective.kind !== "objective" ||
    typeof value.objective.url !== "string" ||
    (value.objective.digest !== undefined && typeof value.objective.digest !== "string") ||
    !jsonObject(value.subject) ||
    typeof value.expectedLevelId !== "string" ||
    !/^[a-z][a-z0-9-]*$/.test(value.expectedLevelId)
  )
    throw new Error("Invalid dependency requirement.");
  const objective = validateArtifactReference(
    value.objective as unknown as ArtifactReference,
  ) as DependencyRequirement["objective"];
  return { objective, subject: value.subject, expectedLevelId: value.expectedLevelId };
}
/** Entry returns one envelope; every Task delivers only its validated payload. */
export function parseCheckerResult(value: unknown, manifest: CheckerManifest): CheckerResult {
  exact(value, ["status", "payload", "message"]);
  if (value.status !== 200 || typeof value.message !== "string")
    throw new Error("Checker invocation failed.");
  const payload = value.payload;
  exact(payload, ["ok", "problems"], ["requirements"]);
  if (
    typeof payload.ok !== "boolean" ||
    !Array.isArray(payload.problems) ||
    (payload.requirements !== undefined && !Array.isArray(payload.requirements))
  )
    throw new Error("Invalid Checker payload.");
  const requirements = (payload.requirements ?? []).map((item) => requirement(item));
  const problems: CheckerProblem[] = payload.problems.map((item) => {
    if (jsonObject(item) && item.kind === "dependency") {
      const parsed = requirement(item, true);
      if (
        typeof item.currentLevelId !== "string" ||
        !/^[a-z][a-z0-9-]*$/.test(item.currentLevelId) ||
        item.currentLevelId === "terminal"
      )
        throw new Error("Invalid dependency level.");
      return { kind: "dependency", ...parsed, currentLevelId: item.currentLevelId };
    }
    exact(item, ["kind", "id", "parameters"]);
    if (
      item.kind !== "internal" ||
      typeof item.id !== "string" ||
      !manifest.problems.includes(item.id) ||
      !jsonObject(item.parameters)
    )
      throw new Error("Undeclared Checker problem.");
    return { kind: "internal", id: item.id, parameters: item.parameters };
  });
  if (payload.ok === problems.length + requirements.length > 0)
    throw new Error("Inconsistent Checker result.");
  return { ok: payload.ok, problems, ...(requirements.length ? { requirements } : {}) };
}
