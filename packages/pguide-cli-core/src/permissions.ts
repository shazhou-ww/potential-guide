import { isAbsolute } from "node:path";

export type PermissionGrant =
  | {
      readonly id: string;
      readonly operation: "read" | "edit";
      readonly resources: readonly string[];
    }
  | { readonly id: string; readonly operation: "execute"; readonly command: string };

export interface RegulationPermissions {
  readonly ceiling: readonly PermissionGrant[];
  readonly grants: readonly string[];
}

/** Configuration shape validation; execution policy belongs to the runtime adapter. */
export function parseRegulationPermissions(value: unknown): RegulationPermissions {
  const object = (entry: unknown): entry is Record<string, unknown> =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry);
  const text = (entry: unknown): entry is string =>
    typeof entry === "string" && entry.trim() !== "" && !entry.includes("\0");
  const fail = (): never => {
    throw new Error(
      "Invalid regulationPermissions: require explicit unique rules and grants within the ceiling.",
    );
  };
  if (
    !object(value) ||
    Object.keys(value).some((key) => !["ceiling", "grants"].includes(key)) ||
    !Array.isArray(value.ceiling) ||
    !Array.isArray(value.grants)
  )
    return fail();
  const ids = new Set<string>();
  for (const rule of value.ceiling) {
    if (!object(rule) || !text(rule.id) || ids.has(rule.id)) return fail();
    ids.add(rule.id);
    if (rule.operation === "read" || rule.operation === "edit") {
      if (
        Object.keys(rule).some((key) => !["id", "operation", "resources"].includes(key)) ||
        !Array.isArray(rule.resources) ||
        rule.resources.length === 0 ||
        !rule.resources.every((path) => text(path) && isAbsolute(path) && !/[*?[\]]/.test(path)) ||
        new Set(rule.resources).size !== rule.resources.length
      )
        return fail();
    } else if (
      rule.operation !== "execute" ||
      !text(rule.command) ||
      Object.keys(rule).some((key) => !["id", "operation", "command"].includes(key))
    )
      return fail();
  }
  if (
    !value.grants.every((id) => text(id) && ids.has(id)) ||
    new Set(value.grants).size !== value.grants.length
  )
    return fail();
  return JSON.parse(JSON.stringify(value)) as RegulationPermissions;
}
