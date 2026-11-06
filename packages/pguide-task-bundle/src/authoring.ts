import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  type Json,
  type JsonObject,
  json,
  isTaskBundlePath as safePath,
  parseTaskBundleYaml,
  taskSchemaUri,
  taskBundlePattern,
} from "@potential-guide/task-protocol";
import type { TaskCallback } from "@potential-guide/task-sdk";
import { Kind, OptionalKind, ReadonlyKind, type Static, type TSchema } from "@sinclair/typebox";
import { Ajv2020 } from "ajv/dist/2020.js";
import { build } from "esbuild";
import { type BuildTaskBundleOptions, buildTaskBundle, compileTaskBundle } from "./build.js";

export interface TaskContract {
  input: TSchema;
  result: TSchema;
  message: TSchema;
  schemas?: readonly TSchema[];
}
export type BundleCallback<Contract extends TaskContract> = TaskCallback<
  Static<Contract["input"]>,
  Static<Contract["result"]>,
  Extract<Static<Contract["message"]>, Json>
>;
export const taskBuildSchemaUri =
  "https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task-build/v1.json";
export const taskBuildSchema = {
  $id: taskBuildSchemaUri,
  type: "object",
  additionalProperties: false,
  required: ["$schema", "name", "runtime", "source", "outDirectory"],
  properties: {
    $schema: { const: taskBuildSchemaUri },
    name: { type: "string", minLength: 1 },
    runtime: {
      type: "object",
      additionalProperties: false,
      required: ["minVersion"],
      properties: {
        minVersion: {
          type: "string",
          pattern: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
        },
      },
    },
    source: {
      type: "object",
      additionalProperties: false,
      required: ["entry", "contract"],
      properties: {
        entry: { type: "string" },
        contract: { type: "string" },
        mode: { enum: ["callback", "explicit"] },
        exportName: { type: "string", pattern: "^(default|[A-Za-z_$][A-Za-z0-9_$]*)$" },
      },
    },
    include: {
      type: "array",
      maxItems: 256,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to"],
        properties: {
          from: { type: "string", minLength: 1 },
          to: { type: "string", minLength: 1 },
        },
      },
    },
    outDirectory: { type: "string", minLength: 1 },
    binary: { type: "array", maxItems: 256, items: { type: "string", minLength: 1 } },
  },
};
interface BuildDefinition {
  $schema: string;
  name: string;
  runtime: { minVersion: string };
  source: { entry: string; contract: string; exportName?: string; mode?: "callback" | "explicit" };
  include?: { from: string; to: string }[];
  outDirectory: string;
  binary?: string[];
}
const validator = new Ajv2020({ strict: true }).compile<BuildDefinition>(taskBuildSchema);
const kinds = new Set([
  "Object",
  "String",
  "Number",
  "Integer",
  "Boolean",
  "Null",
  "Literal",
  "Array",
  "Tuple",
  "Union",
  "Intersect",
  "Record",
  "Ref",
  "Never",
]);
const schemaMaps = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);
const schemaSingles = new Set([
  "items",
  "additionalProperties",
  "unevaluatedProperties",
  "propertyNames",
  "contains",
  "not",
  "if",
  "then",
  "else",
  "unevaluatedItems",
]);
const schemaArrays = new Set(["anyOf", "allOf", "oneOf", "prefixItems"]);

/** Strip only known TypeBox metadata; reject semantics the Engine cannot enforce. */
export function toTaskSchema(value: TSchema): Record<string, unknown> {
  let nodes = 0;
  function visit(value: unknown, schema: boolean, depth: number): unknown {
    if (++nodes > 16_384 || depth > 64) throw new Error("TypeBox Schema budget exceeded.");
    if (value === null || typeof value !== "object") {
      if (["function", "symbol", "undefined", "bigint"].includes(typeof value))
        throw new Error("TypeBox contract must contain only JSON semantics.");
      return value;
    }
    if (Array.isArray(value)) return value.map((child) => visit(child, schema, depth + 1));
    const node = value as Record<PropertyKey, unknown>;
    for (const symbol of Object.getOwnPropertySymbols(node))
      if (![Kind, OptionalKind, ReadonlyKind, Symbol.for("TypeBox.Hint")].includes(symbol))
        throw new Error("Unsupported TypeBox metadata or transform.");
    if (node[Kind] !== undefined && !kinds.has(String(node[Kind])))
      throw new Error(`Unsupported TypeBox kind: ${String(node[Kind])}.`);
    if (
      schema &&
      ["format", "contentEncoding", "contentMediaType", "contentSchema"].some((key) =>
        Object.hasOwn(node, key),
      )
    )
      throw new Error(
        "Engine does not enforce format or content annotations; use supported explicit constraints.",
      );
    if (
      schema &&
      node[Kind] === "Tuple" &&
      node.additionalItems !== undefined &&
      node.additionalItems !== false
    )
      throw new Error("Unsupported TypeBox Tuple additionalItems override.");
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) {
      if (schema && node[Kind] === "Tuple" && (key === "items" || key === "additionalItems"))
        continue;
      if (schema && schemaMaps.has(key)) {
        if (!child || typeof child !== "object" || Array.isArray(child))
          throw new Error("Invalid Schema map.");
        output[key] = Object.fromEntries(
          Object.entries(child).map(([name, entry]) => [name, visit(entry, true, depth + 1)]),
        );
      } else {
        Object.defineProperty(output, key, {
          value: visit(
            child,
            schema && (schemaSingles.has(key) || schemaArrays.has(key)),
            depth + 1,
          ),
          enumerable: true,
          writable: true,
        });
      }
    }
    if (schema && node[Kind] === "Tuple") {
      output.prefixItems = visit(node.items ?? [], true, depth + 1);
      output.items = false;
      if (!(output.prefixItems as unknown[]).length) delete output.prefixItems;
    }
    return output;
  }
  if (!value || typeof value !== "object" || !value[Kind])
    throw new Error("Contract input/result/message must be TypeBox schemas.");
  return visit(value, true, 0) as Record<string, unknown>;
}
function inside(root: string, path: string): boolean {
  const distance = relative(root, path);
  return (
    !distance || (!distance.startsWith(`..${sep}`) && distance !== ".." && !distance.includes(":"))
  );
}
async function sourceFile(root: string, path: string): Promise<string> {
  if (!safePath(path)) throw new Error("Author source paths must be portable relative files.");
  const absolute = resolve(root, path);
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink() || (await realpath(absolute)) !== absolute)
    throw new Error("Author inputs must be canonical regular files, without links.");
  return absolute;
}
async function selectResources(
  root: string,
  rules: NonNullable<BuildDefinition["include"]>,
  output: string,
) {
  const resources: Record<string, string> = {};
  const selected = new Set<string>();
  const destinations = new Set<string>();
  for (const rule of rules) {
    const matcher = taskBundlePattern(rule.from);
    if (
      !rule.to.endsWith("/") ||
      !safePath(rule.to.slice(0, -1)) ||
      !rule.to.startsWith("resources/")
    )
      throw new Error("Include destination must be a resources/ directory ending in /.");
    const parts = rule.from.split("/");
    const wildcard = parts.findIndex((part) => /[*?]/.test(part));
    const baseParts = wildcard < 0 ? parts.slice(0, -1) : parts.slice(0, wildcard);
    const base = resolve(root, ...baseParts);
    if (inside(output, base) || inside(base, output))
      throw new Error("Include selection must not traverse the output directory.");
    if ((await realpath(base)) !== base || (await lstat(base)).isSymbolicLink())
      throw new Error("Include roots must not contain links.");
    let matches = 0;
    let visited = 0;
    async function walk(directory: string) {
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      )) {
        if (++visited > 16_384) throw new Error("Include traversal exceeds its path budget.");
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const path = join(directory, entry.name);
        const name = relative(root, path).split(sep).join("/");
        if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
          throw new Error("Include trees cannot contain links or special files.");
        if (entry.isDirectory()) {
          await walk(path);
          continue;
        }
        if (!matcher.test(name)) continue;
        const target = `${rule.to}${relative(base, path).split(sep).join("/")}`;
        if (!safePath(target) || selected.has(path) || destinations.has(target.toLowerCase()))
          throw new Error("Overlapping, unsafe or colliding include selections.");
        selected.add(path);
        destinations.add(target.toLowerCase());
        resources[target] = await sourceFile(root, name);
        matches++;
      }
    }
    await walk(base);
    if (!matches) throw new Error(`Include rule matched no files: ${rule.from}.`);
  }
  return resources;
}

export async function readTaskBuild(file: string): Promise<BuildTaskBundleOptions> {
  file = resolve(file);
  const root = dirname(file);
  await sourceFile(root, file.slice(root.length + 1));
  const definition: unknown = parseTaskBundleYaml(await readFile(file));
  if (!validator(definition))
    throw new Error(`Invalid task.build.yaml: ${JSON.stringify(validator.errors)}.`);
  if (!safePath(definition.outDirectory))
    throw new Error("outDirectory must be an independent relative directory.");
  const output = resolve(root, definition.outDirectory);
  const entry = await sourceFile(root, definition.source.entry);
  const contractFile = await sourceFile(root, definition.source.contract);
  if ([file, entry, contractFile].some((input) => inside(output, input)))
    throw new Error("Output must not contain author inputs.");
  const resources = await selectResources(root, definition.include ?? [], output);
  const built = await build({
    entryPoints: [contractFile],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    write: false,
    logLevel: "silent",
    banner: {
      js: `const __filename=${JSON.stringify(contractFile)};const __dirname=${JSON.stringify(dirname(contractFile))};`,
    },
  });
  const module = { exports: {} as { default?: TaskContract } };
  new Function("require", "module", "exports", built.outputFiles[0]!.text)(
    createRequire(contractFile),
    module,
    module.exports,
  );
  const contract = module.exports.default;
  if (
    !contract ||
    !["input,message,result", "input,message,result,schemas"].includes(
      Object.keys(contract).sort().join(","),
    ) ||
    (contract.schemas !== undefined && !Array.isArray(contract.schemas))
  )
    throw new Error("Contract module must default-export { input, result, message, schemas? }.");
  const documents = (["input", "result", "message"] as const).map((name) => {
    const schema = toTaskSchema(contract[name]);
    return json({
      ...schema,
      $id: schema.$id ?? `https://task.invalid/schema/${name}`,
    }) as JsonObject;
  });
  documents.push(
    ...(contract.schemas ?? []).map((schema) => json(toTaskSchema(schema)) as JsonObject),
  );
  return {
    declaration: {
      $schema: taskSchemaUri,
      name: definition.name,
      runtime: { type: "node", minVersion: definition.runtime.minVersion },
      entry: "worker.cjs",
      inputSchema: { $ref: "schemas/0.json" },
      resultSchema: { $ref: "schemas/1.json" },
      messageSchema: { $ref: "schemas/2.json" },
    },
    entry,
    ...(definition.source.mode ? { entryMode: definition.source.mode } : {}),
    ...(definition.source.exportName ? { exportName: definition.source.exportName } : {}),
    resources,
    binary: definition.binary ?? [],
    schemaDocuments: documents,
    outDirectory: output,
    owner: file,
  };
}
export async function checkTaskBuild(file: string) {
  const {
    contents: _contents,
    metafile: _metafile,
    ...result
  } = await compileTaskBundle(await readTaskBuild(file));
  return result;
}
export async function buildTask(file: string) {
  return buildTaskBundle(await readTaskBuild(file));
}
