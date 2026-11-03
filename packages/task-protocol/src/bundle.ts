import { Ajv2020 } from "ajv/dist/2020.js";
import { canonical, fail, type Json, type JsonObject, json } from "./json.js";
import {
  compileInputSchema,
  compileJsonSchema,
  type InputSchema,
  type JsonSchema,
} from "./schema.js";

export const taskSchemaUri =
  "https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json";
export const taskBundleSchema = {
  $id: taskSchemaUri,
  $comment:
    "IPFS UnixFS directory root CID identity. One CommonJS Worker per Run; generation-scoped business messages and independent log/log-ack, bounded cumulative log-drop/log-drop-ack diagnostics.",
  type: "object",
  additionalProperties: false,
  required: ["$schema", "name", "runtime", "entry", "inputSchema", "resultSchema", "messageSchema"],
  properties: {
    $schema: { const: taskSchemaUri },
    name: {
      type: "string",
      minLength: 1,
      pattern:
        "^[^\\s\\u0000-\\u001f\\u007f-\\u009f](?:(?:[^\\s\\u0000-\\u001f\\u007f-\\u009f]| )*[^\\s\\u0000-\\u001f\\u007f-\\u009f])?$",
    },
    runtime: {
      type: "object",
      additionalProperties: false,
      required: ["type", "minVersion"],
      properties: {
        type: { const: "node" },
        minVersion: {
          type: "string",
          pattern: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
        },
      },
    },
    entry: { const: "worker.cjs" },
    inputSchema: { type: "object" },
    resultSchema: { type: ["object", "boolean"] },
    messageSchema: { type: ["object", "boolean"] },
  },
};
export * from "./bundle-reference.js";
export interface TaskBundleDeclaration {
  $schema: typeof taskSchemaUri;
  name: string;
  runtime: { type: "node"; minVersion: string };
  entry: "worker.cjs";
  inputSchema: JsonObject;
  resultSchema: JsonSchema;
  messageSchema: JsonSchema;
}
export interface ResolvedTaskBundle extends Omit<TaskBundleDeclaration, "inputSchema"> {
  inputSchema: InputSchema;
}
const validator = new Ajv2020({ strict: true, allowUnionTypes: true }).compile(taskBundleSchema);
export function validateTaskBundle(value: unknown): TaskBundleDeclaration {
  const parsed = json(value, 1_048_576);
  if (!validator(parsed)) fail("invalid_bundle", "Invalid task.yaml declaration.");
  return parsed as unknown as TaskBundleDeclaration;
}
const objectSchema = (value: Json | undefined): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const schemaMaps = new Set([
  "$defs",
  "definitions",
  "properties",
  "patternProperties",
  "dependentSchemas",
]);
const schemaSingles = new Set([
  "additionalProperties",
  "unevaluatedProperties",
  "propertyNames",
  "items",
  "unevaluatedItems",
  "contains",
  "not",
  "if",
  "then",
  "else",
  "contentSchema",
]);
const schemaArrays = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);

/** Resolve only supplied resources. No network loader or ambient Schema registry exists. */
export function resolveBundleSchemas(
  declaration: TaskBundleDeclaration,
  resources: readonly JsonObject[],
): ResolvedTaskBundle {
  const registry = new Map<string, { node: JsonSchema; base: string }>();
  const locations = new WeakMap<JsonObject, string>();
  const rootBase = "https://task.invalid/declaration";
  let nodes = 0;
  function absolute(value: string, base: string): string {
    try {
      return new URL(value, base).href;
    } catch {
      return fail("invalid_schema", "Invalid Schema URI.");
    }
  }
  function add(id: string, node: JsonSchema, base: string): void {
    const existing = registry.get(id);
    if (existing && existing.node !== node) {
      if (canonical(existing.node) !== canonical(node))
        fail("invalid_schema", "Conflicting Schema resource identifier.");
      return;
    }
    registry.set(id, { node, base });
  }
  function children(node: JsonObject, visit: (child: JsonSchema) => void): void {
    for (const [key, value] of Object.entries(node)) {
      if (schemaMaps.has(key) && objectSchema(value))
        for (const child of Object.values(value)) {
          if (typeof child === "boolean" || objectSchema(child)) visit(child);
        }
      if (schemaSingles.has(key) && (typeof value === "boolean" || objectSchema(value)))
        visit(value);
      if (schemaArrays.has(key) && Array.isArray(value))
        for (const child of value)
          if (typeof child === "boolean" || objectSchema(child)) visit(child);
    }
  }
  function collect(node: JsonSchema, base: string): void {
    if (++nodes > 4096) fail("invalid_schema", "Schema resource budget exceeded.");
    if (typeof node === "boolean") return;
    if (
      node.$schema !== undefined &&
      node.$schema !== "https://json-schema.org/draft/2020-12/schema"
    )
      fail("invalid_schema", "Only JSON Schema Draft 2020-12 is supported.");
    if (node.$id !== undefined) {
      if (typeof node.$id !== "string") fail("invalid_schema", "Schema $id must be a URI.");
      base = absolute(node.$id, base);
      if (new URL(base).hash) fail("invalid_schema", "Schema $id must not contain a fragment.");
      add(base, node, base);
    }
    locations.set(node, base);
    if (node.$anchor !== undefined) {
      if (typeof node.$anchor !== "string" || !/^[A-Za-z_][-A-Za-z0-9._]*$/.test(node.$anchor))
        fail("invalid_schema", "Invalid Schema anchor.");
      add(`${base}#${node.$anchor}`, node, base);
    }
    children(node, (child) => collect(child, base));
  }
  for (const resource of resources) {
    if (!objectSchema(resource) || typeof resource.$id !== "string")
      fail("invalid_schema", "Shared Schema requires an absolute $id.");
    let id: string;
    try {
      id = new URL(resource.$id).href;
    } catch {
      return fail("invalid_schema", "Shared Schema requires an absolute $id.");
    }
    collect(resource, id);
  }
  const roots = [declaration.inputSchema, declaration.resultSchema, declaration.messageSchema];
  roots.forEach((root, index) => {
    const base = `${rootBase}/${index}`;
    add(base, root, base);
    collect(root, base);
  });
  let expansions = 0;
  function expand(node: JsonSchema, base: string, ancestors: Set<JsonSchema>): JsonSchema {
    if (++expansions > 16_384 || ancestors.size > 64)
      fail("invalid_schema", "Schema reference expansion budget exceeded.");
    if (typeof node === "boolean") return node;
    if (ancestors.has(node)) fail("invalid_schema", "Cyclic Schema references are unsupported.");
    base = locations.get(node) ?? base;
    const path = new Set(ancestors).add(node);
    const result: JsonObject = {};
    for (const [key, value] of Object.entries(node)) {
      if (["$id", "$anchor", "$ref"].includes(key)) continue;
      if (schemaMaps.has(key) && objectSchema(value)) {
        result[key] = Object.fromEntries(
          Object.entries(value).map(([name, child]) => [
            name,
            typeof child === "boolean" || objectSchema(child) ? expand(child, base, path) : child,
          ]),
        );
      } else if (schemaSingles.has(key) && (typeof value === "boolean" || objectSchema(value))) {
        result[key] = expand(value, base, path);
      } else if (schemaArrays.has(key) && Array.isArray(value)) {
        result[key] = value.map((child) =>
          typeof child === "boolean" || objectSchema(child) ? expand(child, base, path) : child,
        );
      } else result[key] = value;
    }
    if (node.$ref === undefined) return result;
    if (typeof node.$ref !== "string") fail("invalid_schema", "Schema $ref must be a URI.");
    const uri = absolute(node.$ref, base);
    let target = registry.get(uri);
    if (!target) {
      const url = new URL(uri);
      let fragment: string;
      try {
        fragment = decodeURIComponent(url.hash.slice(1));
      } catch {
        return fail("invalid_schema", "Invalid Schema URI fragment encoding.");
      }
      url.hash = "";
      const resource = registry.get(url.href);
      if (!resource) fail("invalid_schema", "Missing offline Schema resource.");
      let selected: Json = resource.node;
      if (fragment && !fragment.startsWith("/")) fail("invalid_schema", "Missing Schema anchor.");
      for (const part of fragment.split("/").slice(1)) {
        if (/~(?:[^01]|$)/.test(part)) fail("invalid_schema", "Invalid Schema JSON Pointer.");
        const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
        if ((!objectSchema(selected) && !Array.isArray(selected)) || !Object.hasOwn(selected, key))
          fail("invalid_schema", "Missing Schema JSON Pointer.");
        selected = (selected as JsonObject)[key]!;
      }
      if (typeof selected !== "boolean" && !objectSchema(selected))
        fail("invalid_schema", "Reference does not select a Schema.");
      target = { node: selected, base: resource.base };
    }
    const resolved = expand(target.node, target.base, path);
    return Object.keys(result).length
      ? { ...result, allOf: [...(Array.isArray(result.allOf) ? result.allOf : []), resolved] }
      : resolved;
  }
  const input = expand(roots[0]!, `${rootBase}/0`, new Set());
  function declaresObject(schema: JsonSchema): boolean {
    return (
      typeof schema !== "boolean" &&
      (schema.type === "object" ||
        (Array.isArray(schema.allOf) &&
          schema.allOf.some(
            (child) => (typeof child === "boolean" || objectSchema(child)) && declaresObject(child),
          )))
    );
  }
  if (typeof input !== "boolean" && input.type === undefined && declaresObject(input))
    input.type = "object";
  const result = expand(roots[1]!, `${rootBase}/1`, new Set());
  const message = expand(roots[2]!, `${rootBase}/2`, new Set());
  compileInputSchema(input);
  compileJsonSchema(result);
  compileJsonSchema(message);
  return {
    ...declaration,
    inputSchema: input as InputSchema,
    resultSchema: result,
    messageSchema: message,
  };
}
