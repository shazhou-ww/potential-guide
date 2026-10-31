export function assertFiniteJson(value: unknown, depth = 0): void {
  if (depth > 64 || (typeof value === "number" && !Number.isFinite(value)))
    throw new Error("JSON 数字必须有限，嵌套不能超过 64 层。");
  if (value && typeof value === "object")
    for (const child of Object.values(value)) assertFiniteJson(child, depth + 1);
}
