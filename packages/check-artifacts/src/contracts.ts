import { createHash } from "node:crypto";
import type { AnySchema } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isAlias, isMap, isScalar, isSeq, parseDocument } from "yaml";
import { artifactLimits, safePath } from "./paths.js";
import { validateSubjectMapping } from "./mapping.js";
import { parseFileArtifactUrl } from "./file-url.js";
export { parseFileArtifactUrl } from "./file-url.js";

export const checkerSchemaUri =
  "https://shazhou-ww.github.io/potential-guide/schemas/artifacts/checker/v1.json";
export const objectiveSchemaUri =
  "https://shazhou-ww.github.io/potential-guide/schemas/artifacts/objective/v1.json";
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export interface ArtifactReference {
  kind: "checker" | "objective";
  url: string;
  digest?: string;
}
export interface CheckerManifest {
  $schema: typeof checkerSchemaUri;
  runtime: { type: "node"; minVersion: string };
  entry: string;
  subjectSchema: AnySchema;
  problems: string[];
  languages: string[];
}
export interface ObjectiveArtifactManifest {
  $schema: typeof objectiveSchemaUri;
  subjectSchema: AnySchema;
  languages: string[];
  levels: { id: string; checks: string[] }[];
  checkers: Record<string, { url: string; digest: string; subjectMapping: string }>;
}
export interface ArtifactPage {
  id: string;
  language: string;
  title: string;
  description: string;
  references: string[];
  content: string;
  origin: { artifactDigest: string; path: string };
}
export interface ContractArtifact<M = CheckerManifest | ObjectiveArtifactManifest> {
  manifest: M;
  digest: string;
  files: ReadonlyMap<string, Buffer>;
  pages: Record<string, Record<string, ArtifactPage>>;
}
export const digestPattern = "^sha256:[a-f0-9]{64}$";
const namePattern = "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$";
const strings = (pattern?: string) => ({
  type: "array",
  uniqueItems: true,
  maxItems: 128,
  items: { type: "string", ...(pattern ? { pattern } : {}) },
});
const subjectSchema = {
  type: "object",
  required: ["type"],
  properties: { type: { const: "object" } },
};
const languages = { ...strings("^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$"), minItems: 1 };
export const checkerSchema = {
  $id: checkerSchemaUri,
  $comment:
    "Git SHA-256 root tree OID; raw UTF-8 bytes; 100644 files, 40000 trees, Git directory sorting. Node CommonJS initialize/execute/dispose lifecycle; execute returns checkerEnvelope and Task result is its validated payload.",
  $defs: {
    digest: { type: "string", pattern: digestPattern },
    objectiveReference: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "url"],
      properties: {
        kind: { const: "objective" },
        url: { type: "string", maxLength: 4096 },
        digest: { $ref: "#/$defs/digest" },
      },
    },
    requirement: {
      type: "object",
      additionalProperties: false,
      required: ["objective", "subject", "expectedLevelId"],
      properties: {
        objective: { $ref: "#/$defs/objectiveReference" },
        subject: { type: "object" },
        expectedLevelId: { type: "string", pattern: namePattern },
      },
    },
    problem: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "id", "parameters"],
          properties: {
            kind: { const: "internal" },
            id: { type: "string", pattern: namePattern },
            parameters: { type: "object" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "objective", "subject", "expectedLevelId", "currentLevelId"],
          properties: {
            kind: { const: "dependency" },
            objective: { $ref: "#/$defs/objectiveReference" },
            subject: { type: "object" },
            expectedLevelId: { type: "string", pattern: namePattern },
            currentLevelId: { type: "string", pattern: namePattern, not: { const: "terminal" } },
          },
        },
      ],
    },
    checkerResult: {
      type: "object",
      additionalProperties: false,
      required: ["ok", "problems"],
      properties: {
        ok: { type: "boolean" },
        problems: { type: "array", items: { $ref: "#/$defs/problem" } },
        requirements: { type: "array", items: { $ref: "#/$defs/requirement" } },
      },
      allOf: [
        {
          if: { properties: { ok: { const: true } } },
          // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword, not a thenable.
          then: { properties: { problems: { maxItems: 0 }, requirements: { maxItems: 0 } } },
          else: {
            anyOf: [
              { properties: { problems: { minItems: 1 } } },
              { required: ["requirements"], properties: { requirements: { minItems: 1 } } },
            ],
          },
        },
      ],
    },
    checkerEnvelope: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["status", "message", "payload"],
          properties: {
            status: { const: 200 },
            message: { type: "string" },
            payload: { $ref: "#/$defs/checkerResult" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["status", "message", "payload"],
          properties: {
            status: { type: "integer", minimum: 100, maximum: 599, not: { const: 200 } },
            message: { type: "string", minLength: 1 },
            payload: { type: "null" },
          },
        },
      ],
    },
  },
  type: "object",
  additionalProperties: false,
  required: ["$schema", "runtime", "entry", "subjectSchema", "problems", "languages"],
  properties: {
    $schema: { const: checkerSchemaUri },
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
    entry: { type: "string", pattern: "\\.cjs$", maxLength: 1024 },
    subjectSchema,
    problems: strings(namePattern),
    languages,
  },
};
export const objectiveArtifactSchema = {
  $id: objectiveSchemaUri,
  $comment:
    "Git SHA-256 root tree digest with raw bytes and fixed 100644/40000 modes. Checker URL immutability is an author contract; every edge has a required exact digest. subjectMapping uses the bounded JSONata selection profile documented in docs/artifact-contracts.md.",
  type: "object",
  additionalProperties: false,
  required: ["$schema", "subjectSchema", "languages", "levels", "checkers"],
  properties: {
    $schema: { const: objectiveSchemaUri },
    subjectSchema,
    languages,
    levels: {
      type: "array",
      minItems: 1,
      maxItems: 128,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "checks"],
        properties: {
          id: { type: "string", pattern: namePattern, not: { enum: ["initial", "terminal"] } },
          checks: { ...strings(namePattern), minItems: 1 },
        },
      },
    },
    checkers: {
      type: "object",
      minProperties: 1,
      maxProperties: 128,
      propertyNames: { pattern: namePattern },
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        required: ["url", "digest", "subjectMapping"],
        properties: {
          url: { type: "string", minLength: 1, maxLength: 4096 },
          digest: { type: "string", pattern: digestPattern },
          subjectMapping: { type: "string", minLength: 1, maxLength: 4096 },
        },
      },
    },
  },
};
const ajv = new Ajv2020({ strict: false, validateFormats: false });
const compileSubject = (schema: AnySchema) =>
  new Ajv2020({ strict: true, allowUnionTypes: true, validateFormats: false }).compile(schema);
const checkChecker = ajv.compile<CheckerManifest>(checkerSchema);
const checkObjective = ajv.compile<ObjectiveArtifactManifest>(objectiveArtifactSchema);

/** JSON inspection never invokes getters, toJSON, or prototype conversions. */
export function finiteJson(value: unknown, depth = 0, seen = new Set<object>()): value is Json {
  if (depth > 32) return false;
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  const array = Array.isArray(value);
  if (
    array
      ? Object.getPrototypeOf(value) !== Array.prototype
      : Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null
  )
    return false;
  if (Object.getOwnPropertySymbols(value).length) return false;
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (array && Object.keys(descriptors).length !== value.length + 1) return false;
  const valid = Object.entries(descriptors).every(
    ([key, descriptor]) =>
      (array && key === "length") ||
      ((!array || (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length)) &&
        descriptor.enumerable &&
        "value" in descriptor &&
        finiteJson(descriptor.value, depth + 1, seen)),
  );
  seen.delete(value);
  return valid;
}
export function jsonObject(value: unknown): value is JsonObject {
  return finiteJson(value) && value !== null && typeof value === "object" && !Array.isArray(value);
}
export function canonicalJson(value: Json): string {
  if (!finiteJson(value)) throw new Error("Expected finite plain JSON.");
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function parseArtifactYaml(bytes: Uint8Array): Json {
  if (bytes.length > 64 * 1024) throw new Error("YAML exceeds bounds.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const document = parseDocument(text, { schema: "core", uniqueKeys: true, strict: true });
  if (
    document.errors.length ||
    document.warnings.length ||
    document.directives?.yaml.explicit ||
    (document.directives?.tags && Object.keys(document.directives.tags).some((key) => key !== "!!"))
  )
    throw new Error("Invalid JSON-subset YAML.");
  function inspect(node: unknown, depth: number): void {
    if (depth > 32 || isAlias(node)) throw new Error("YAML aliases or excessive depth.");
    if (isMap(node) || isSeq(node) || isScalar(node)) {
      if (node.tag) throw new Error("YAML tags are forbidden.");
      if (isMap(node))
        for (const pair of node.items) {
          if (!isScalar(pair.key) || typeof pair.key.value !== "string")
            throw new Error("YAML keys must be strings.");
          inspect(pair.value, depth + 1);
        }
      if (isSeq(node)) for (const child of node.items) inspect(child, depth + 1);
    }
  }
  inspect(document.contents, 0);
  const result: unknown = document.toJS({ maxAliasCount: 0 });
  if (!finiteJson(result)) throw new Error("YAML must contain finite JSON.");
  return result;
}
export function parseCheckerManifest(bytes: Uint8Array): CheckerManifest {
  const value = parseArtifactYaml(bytes);
  if (!checkChecker(value))
    throw new Error(`Invalid Checker: ${ajv.errorsText(checkChecker.errors)}`);
  if (!safePath(value.entry) || value.entry.startsWith("references/"))
    throw new Error("Checker entry must be a safe CommonJS path outside References.");
  compileSubject(value.subjectSchema);
  return value;
}
export function validateArtifactSubject(
  manifest: { subjectSchema: AnySchema },
  value: unknown,
): boolean {
  return jsonObject(value) && compileSubject(manifest.subjectSchema)(value) === true;
}
export function parseObjectiveArtifactManifest(bytes: Uint8Array): ObjectiveArtifactManifest {
  const value = parseArtifactYaml(bytes);
  if (!checkObjective(value))
    throw new Error(`Invalid Objective: ${ajv.errorsText(checkObjective.errors)}`);
  compileSubject(value.subjectSchema);
  const ids = new Set<string>();
  const used = new Set<string>();
  for (const level of value.levels) {
    if (ids.has(level.id)) throw new Error("Duplicate level.");
    ids.add(level.id);
    for (const ref of level.checks) {
      if (!Object.hasOwn(value.checkers, ref)) throw new Error("Unknown Checker reference.");
      used.add(ref);
    }
  }
  if (used.size !== Object.keys(value.checkers).length)
    throw new Error("Unused Checker reference.");
  for (const checker of Object.values(value.checkers)) {
    if (new URL(checker.url).protocol !== "https:")
      throw new Error("Embedded Objective Checkers require portable HTTPS sources.");
    validateArtifactReference({ kind: "checker", ...checker });
    validateSubjectMapping(checker.subjectMapping);
  }
  return value;
}
export function validateArtifactReference(reference: ArtifactReference): ArtifactReference {
  if (
    !["checker", "objective"].includes(reference.kind) ||
    typeof reference.url !== "string" ||
    reference.url.length > 4096
  )
    throw new Error("Invalid artifact reference.");
  const url = new URL(reference.url);
  if (url.protocol === "file:" && reference.kind === "checker") {
    parseFileArtifactUrl(reference.url);
    if (
      reference.digest !== undefined &&
      (typeof reference.digest !== "string" || !new RegExp(digestPattern).test(reference.digest))
    )
      throw new Error("Invalid content digest.");
    return {
      kind: reference.kind,
      url: reference.url,
      ...(reference.digest ? { digest: reference.digest } : {}),
    };
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    reference.url.includes("#") ||
    url.href !== reference.url
  )
    throw new Error("Expected canonical HTTPS source without credentials or fragment.");
  if (
    [...url.searchParams.keys()].some((key) =>
      /(?:token|secret|password|credential|signature|api.?key|^sig$)/i.test(key),
    )
  )
    throw new Error(
      "Credential-bearing sources require a credential resolver; this adapter does not export or persist them.",
    );
  if (reference.digest !== undefined && !new RegExp(digestPattern).test(reference.digest))
    throw new Error("Invalid content digest.");
  return {
    kind: reference.kind,
    url: reference.url,
    ...(reference.digest ? { digest: reference.digest } : {}),
  };
}
export function formatArtifactReference(reference: ArtifactReference): string {
  const valid = validateArtifactReference(reference);
  return `${valid.kind}:${valid.url}${valid.digest ? `#${valid.digest}` : ""}`;
}
export function parseArtifactReference(text: string): ArtifactReference {
  if (typeof text !== "string" || text.length > 4200) throw new Error("Invalid typed reference.");
  const match = /^(checker|objective):((?:https:|file:)[^#]+)(?:#(sha256:[a-f0-9]{64}))?$/.exec(
    text,
  );
  if (!match?.[1] || !match[2]) throw new Error("Invalid typed reference.");
  return validateArtifactReference({
    kind: match[1] as ArtifactReference["kind"],
    url: match[2],
    ...(match[3] ? { digest: match[3] } : {}),
  });
}
function objectId(type: "blob" | "tree", bytes: Buffer) {
  return createHash("sha256").update(`${type} ${bytes.length}\0`).update(bytes).digest();
}
/** Exact Git SHA-256 tree encoding; no application-specific hash domain. */
export function gitTreeDigest(files: ReadonlyMap<string, Buffer>): string {
  type Tree = Map<string, Buffer | Tree>;
  const root: Tree = new Map();
  const folded = new Map<string, string>();
  let total = 0;
  if (!files.size || files.size > artifactLimits.files) throw new Error("Invalid file count.");
  for (const [path, bytes] of files) {
    total += bytes.length;
    if (
      !safePath(path) ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(path) ||
      total > artifactLimits.bytes
    )
      throw new Error("Invalid artifact path or size.");
    let node = root;
    const parts = path.split("/");
    let prefix = "";
    for (const [index, part] of parts.entries()) {
      prefix += `${part}/`;
      if (folded.has(prefix.toLowerCase()) && folded.get(prefix.toLowerCase()) !== prefix)
        throw new Error("Ambiguous artifact path.");
      folded.set(prefix.toLowerCase(), prefix);
      if (index === parts.length - 1) {
        if (node.has(part)) throw new Error("Conflicting artifact path.");
        node.set(part, bytes);
      } else {
        const existing = node.get(part);
        if (Buffer.isBuffer(existing)) throw new Error("File is also a directory.");
        const child = existing ?? new Map();
        node.set(part, child);
        node = child;
      }
    }
  }
  if (folded.size > artifactLimits.paths) throw new Error("Too many paths.");
  function tree(node: Tree): Buffer {
    const entries = [...node].sort(([a, x], [b, y]) =>
      Buffer.compare(
        Buffer.from(a + (Buffer.isBuffer(x) ? "" : "/")),
        Buffer.from(b + (Buffer.isBuffer(y) ? "" : "/")),
      ),
    );
    const body = Buffer.concat(
      entries.map(([name, value]) =>
        Buffer.concat([
          Buffer.from(`${Buffer.isBuffer(value) ? "100644" : "40000"} ${name}\0`),
          Buffer.isBuffer(value) ? objectId("blob", value) : tree(value),
        ]),
      ),
    );
    return objectId("tree", body);
  }
  return `sha256:${tree(root).toString("hex")}`;
}
export function assertRuntime(
  manifest: CheckerManifest,
  actual = { type: "node", version: process.versions.node },
) {
  if (actual.type !== manifest.runtime.type) throw new Error("Unsupported Checker runtime.");
  const parse = (version: string) => {
    if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version))
      throw new Error("Invalid runtime version.");
    const values = version.split(".").map(Number);
    if (!values.every(Number.isSafeInteger)) throw new Error("Runtime version exceeds bounds.");
    return values;
  };
  const minimum = parse(manifest.runtime.minVersion);
  const installed = parse(actual.version);
  if ((installed[0] ?? 0) < 22 || (installed[0] === 22 && (installed[1] ?? 0) < 13))
    throw new Error("Runtime is below the Host support policy (Node 22.13.0).");
  for (let i = 0; i < 3; i++) {
    if ((installed[i] ?? 0) > (minimum[i] ?? 0)) return;
    if ((installed[i] ?? 0) < (minimum[i] ?? 0))
      throw new Error("Checker minimum runtime is unavailable.");
  }
}
export function selectLanguage(
  supported: readonly string[],
  preferences: readonly string[],
  requested?: string,
) {
  const language = requested ?? preferences.find((value) => supported.includes(value));
  if (!language || !supported.includes(language)) throw new Error("Unsupported language.");
  return language;
}
function page(
  bytes: Buffer,
  id: string,
  language: string,
  digest: string,
  path: string,
): ArtifactPage {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!match) throw new Error("Page requires frontmatter.");
  const data = parseArtifactYaml(Buffer.from(match[1] ?? ""));
  if (
    !jsonObject(data) ||
    Object.keys(data).some((key) => !["title", "description", "references"].includes(key)) ||
    typeof data.title !== "string" ||
    !data.title.trim() ||
    typeof data.description !== "string" ||
    (data.references !== undefined &&
      (!Array.isArray(data.references) ||
        !data.references.every((ref) => typeof ref === "string" && safePath(ref))))
  )
    throw new Error("Invalid page frontmatter.");
  return {
    id,
    language,
    title: data.title,
    description: data.description,
    references: (data.references ?? []) as string[],
    content: match[2] ?? "",
    origin: { artifactDigest: digest, path },
  };
}
export function validatePageGraph(pages: Record<string, ArtifactPage>) {
  const active = new Set<string>();
  const complete = new Set<string>();
  function visit(id: string) {
    if (complete.has(id)) return;
    if (active.has(id)) throw new Error("Reference cycle.");
    const current = pages[id];
    if (!current) throw new Error("Dangling page reference.");
    active.add(id);
    for (const ref of [
      ...current.references,
      ...[...current.content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map(
        (match) => match[1] ?? "",
      ),
    ])
      visit(ref);
    active.delete(id);
    complete.add(id);
  }
  for (const id of Object.keys(pages)) visit(id);
}
export function inspectContractFiles(files: ReadonlyMap<string, Buffer>): ContractArtifact {
  const checker = files.get("checker.yaml");
  const objective = files.get("objective.yaml");
  if (!!checker === !!objective)
    throw new Error("Exactly one canonical artifact entry is required.");
  const manifest = checker
    ? parseCheckerManifest(checker)
    : parseObjectiveArtifactManifest(objective ?? Buffer.alloc(0));
  const digest = gitTreeDigest(files);
  const pages: ContractArtifact["pages"] = Object.fromEntries(
    manifest.languages.map((language) => [language, {}]),
  );
  for (const [path, bytes] of files) {
    if (
      path === (checker ? "checker.yaml" : "objective.yaml") ||
      ("entry" in manifest && path === manifest.entry)
    )
      continue;
    const match = /^references\/([^/]+)\/(.+)\.md$/.exec(path);
    const language = match?.[1];
    const id = match?.[2];
    if (!language || !id || !pages[language] || id === "404" || id.startsWith("system/"))
      throw new Error("Undeclared artifact content.");
    const valid = checker
      ? id === "checker" ||
        (id.startsWith("problems/") &&
          (manifest as CheckerManifest).problems.includes(id.slice(9))) ||
        /^pages\/[a-z][a-z0-9-]*$/.test(id)
      : id === "objective" ||
        (id.startsWith("levels/") &&
          (manifest as ObjectiveArtifactManifest).levels.some(
            (level) => level.id === id.slice(7),
          )) ||
        /^pages\/[a-z][a-z0-9-]*$/.test(id) ||
        /^checkers\/[a-z][a-z0-9-]*\/(?:checker|problems\/[a-z][a-z0-9-]*)$/.test(id);
    if (!valid) throw new Error("Invalid Reference namespace.");
    const pageId = id.replace(/^(checkers\/[^/]+)\/checker$/, "$1");
    pages[language][pageId] = page(bytes, pageId, language, digest, path);
  }
  if ("entry" in manifest && !files.has(manifest.entry)) throw new Error("Missing Checker entry.");
  for (const locale of Object.values(pages)) {
    const required =
      "entry" in manifest
        ? ["checker", ...manifest.problems.map((id) => `problems/${id}`)]
        : ["objective", ...manifest.levels.map((level) => `levels/${level.id}`)];
    if (required.some((id) => !locale[id])) throw new Error("Missing required Reference page.");
    if (checker) validatePageGraph(locale);
  }
  return { manifest, digest, files, pages };
}
export function composeObjectivePages(
  objective: ContractArtifact<ObjectiveArtifactManifest>,
  checkers: Readonly<Record<string, ContractArtifact<CheckerManifest>>>,
) {
  const result: ContractArtifact["pages"] = {};
  for (const language of objective.manifest.languages) {
    const pages = structuredClone(objective.pages[language] ?? {});
    for (const id of Object.keys(pages).filter((id) => id.startsWith("checkers/"))) {
      const [, ref, ...parts] = id.split("/");
      const checker = ref && Object.hasOwn(checkers, ref) ? checkers[ref] : undefined;
      if (
        !checker ||
        (parts.length &&
          !(
            parts[0] === "problems" &&
            parts.length === 2 &&
            checker.manifest.problems.includes(parts[1] ?? "")
          ))
      )
        throw new Error("Invalid Checker override.");
    }
    for (const [ref, binding] of Object.entries(objective.manifest.checkers)) {
      const checker = checkers[ref];
      if (!checker || checker.digest !== binding.digest)
        throw new Error("Checker binding mismatch.");
      const translate = (id: string) =>
        id === "checker" ? `checkers/${ref}` : `checkers/${ref}/${id}`;
      for (const original of Object.values(checker.pages[language] ?? {})) {
        const id = translate(original.id);
        const baseId =
          original.id === "checker"
            ? `pages/base-${ref}`
            : original.id.startsWith("problems/")
              ? `pages/base-${ref}-${original.id.slice(9)}`
              : `pages/base-${ref}-${original.id.replaceAll("/", "-")}`;
        if (pages[baseId]) throw new Error("Base page collision.");
        const inherited = {
          ...structuredClone(original),
          id,
          references: original.references.map(translate),
          content: original.content.replace(
            /\[\[([^\]|]+)(\|[^\]]*)?\]\]/g,
            (_match, target: string, label: string | undefined) =>
              `[[${translate(target)}${label ?? ""}]]`,
          ),
        };
        pages[baseId] = { ...inherited, id: baseId };
        pages[id] ??= inherited;
      }
      for (const id of [
        "checker",
        ...checker.manifest.problems.map((problem) => `problems/${problem}`),
      ])
        if (!pages[translate(id)]) throw new Error("Incomplete effective language.");
    }
    validatePageGraph(pages);
    result[language] = pages;
  }
  return result;
}
