import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { builtinModules } from "node:module";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Ajv } from "ajv";
import { parseDocument } from "yaml";
import { type Contract, type Delivery, parseContract, type Workspace } from "./contract.js";
import { sourceImports } from "./imports.js";

export type { Contract, Delivery, Workspace } from "./contract.js";
export { contractSchema, parseContract } from "./contract.js";
export type State = "pass" | "fail" | "unverified" | "not-applicable";
export interface Finding {
  layer: 1 | 2;
  state: State;
  rule: string;
  location: string;
  evidence: string;
  remedy: string;
  requirements: string[];
  packages: string[];
  targetDirectory?: string;
}
export interface Report {
  schemaVersion: 1;
  scope: "delivery-preparation";
  state: State;
  layer2: "checked" | "blocked" | "not-requested";
  findings: Finding[];
  evidenceKind: "configuration-and-existing-files";
  onlineVerified: false;
  limitations: string[];
}
type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function texts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(texts);
  return record(value) ? Object.values(value).flatMap(texts) : [];
}
function under(path: string, directory: string) {
  return path === directory || path.startsWith(`${directory}/`);
}
const ignored = new Set([
  ".git",
  "node_modules",
  ".cache",
  ".turbo",
  ".next",
  ".wrangler",
  "coverage",
]);
const secretPath =
  /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|.*\.(?:pem|key|p12)|credentials(?:\..*)?|secrets?(?:\..*)?)$/i;
class Snapshot {
  constructor(readonly root: string) {}
  async path(path: string) {
    const absolute = resolve(this.root, path);
    const rel = relative(this.root, absolute);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`) || secretPath.test(path)) {
      throw new Error("Path is outside the observation boundary or is a secret-value file.");
    }
    let current = this.root;
    for (const part of rel.split(sep).filter(Boolean)) {
      current = join(current, part);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new Error("Symbolic links are not inspected.");
      } catch (error) {
        if (!record(error) || error.code !== "ENOENT") throw error;
        return absolute;
      }
    }
    return absolute;
  }
  async exists(path: string) {
    try {
      return (await lstat(await this.path(path))).isFile();
    } catch (error) {
      if (record(error) && error.code === "ENOENT") return false;
      throw error;
    }
  }
  async text(path: string) {
    const absolute = await this.path(path);
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.size > 1024 * 1024)
      throw new Error("Expected a regular file <= 1 MiB.");
    return readFile(absolute, "utf8");
  }
  async json(path: string): Promise<RecordValue> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await this.text(path));
    } catch {
      throw new SyntaxError("Invalid JSON; source values are intentionally omitted.");
    }
    if (!record(parsed)) throw new TypeError("Expected a JSON object.");
    return parsed;
  }
  async files(directory = "", includeBuildOutputs = false): Promise<string[]> {
    const results: string[] = [];
    for (const item of await readdir(await this.path(directory), { withFileTypes: true })) {
      const path = directory ? `${directory}/${item.name}` : item.name;
      if (
        ignored.has(item.name) ||
        (!includeBuildOutputs && item.isDirectory() && item.name === "dist") ||
        item.isSymbolicLink()
      )
        continue;
      if (item.isDirectory()) results.push(...(await this.files(path, includeBuildOutputs)));
      else if (item.isFile()) results.push(path);
      if (results.length > 20000)
        throw new Error("Inventory exceeds 20,000 files; narrow the target.");
    }
    return results;
  }
}
const ajv = new Ajv({ allErrors: true, strict: true });
const nodeImports = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const packageValidator = ajv.compile({
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    private: { type: "boolean" },
    scripts: { type: "object", additionalProperties: { type: "string" } },
    dependencies: { type: "object", additionalProperties: { type: "string" } },
    devDependencies: { type: "object", additionalProperties: { type: "string" } },
    peerDependencies: { type: "object", additionalProperties: { type: "string" } },
    optionalDependencies: { type: "object", additionalProperties: { type: "string" } },
    files: { type: "array", items: { type: "string" } },
    engines: { type: "object", additionalProperties: { type: "string" } },
    bin: {
      anyOf: [{ type: "string" }, { type: "object", additionalProperties: { type: "string" } }],
    },
  },
});
const workspaceValidator = ajv.compile({
  type: "object",
  required: ["packages"],
  properties: {
    packages: { type: "array", minItems: 1, items: { type: "string" } },
    catalog: { type: "object", additionalProperties: { type: "string" } },
    catalogs: {
      type: "object",
      additionalProperties: { type: "object", additionalProperties: { type: "string" } },
    },
    allowBuilds: { type: "object", additionalProperties: { type: "boolean" } },
    onlyBuiltDependencies: { type: "array", items: { type: "string" } },
    ignoredBuiltDependencies: { type: "array", items: { type: "string" } },
    minimumReleaseAge: { type: "number", minimum: 0 },
    minimumReleaseAgeExclude: { type: "array", items: { type: "string" } },
    overrides: { type: "object", additionalProperties: { type: "string" } },
    catalogMode: { enum: ["manual", "prefer", "strict"] },
    cleanupUnusedCatalogs: { type: "boolean" },
    linkWorkspacePackages: { anyOf: [{ type: "boolean" }, { const: "deep" }] },
    preferWorkspacePackages: { type: "boolean" },
  },
});
const workspaceFields = new Set([
  "packages",
  "catalog",
  "catalogs",
  "allowBuilds",
  "onlyBuiltDependencies",
  "ignoredBuiltDependencies",
  "minimumReleaseAge",
  "minimumReleaseAgeExclude",
  "overrides",
  "catalogMode",
  "cleanupUnusedCatalogs",
  "linkWorkspacePackages",
  "preferWorkspacePackages",
]);
const turboValidator = ajv.compile({
  type: "object",
  required: ["tasks"],
  additionalProperties: false,
  properties: {
    $schema: { type: "string" },
    ui: { enum: ["stream", "tui"] },
    globalDependencies: { type: "array", items: { type: "string" } },
    globalEnv: { type: "array", items: { type: "string" } },
    tasks: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        properties: {
          dependsOn: { type: "array", items: { type: "string" } },
          outputs: { type: "array", items: { type: "string" } },
          inputs: { type: "array", items: { type: "string" } },
          env: { type: "array", items: { type: "string" } },
          cache: { type: "boolean" },
          persistent: { type: "boolean" },
        },
      },
    },
  },
});
function matches(path: string, pattern: string) {
  const expression = pattern
    .split("/")
    .map((part) =>
      part === "**"
        ? ".*"
        : part
            .split("*")
            .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("[^/]*"),
    )
    .join("/");
  return new RegExp(`^${expression}$`).test(path);
}
function taskFor(tasks: RecordValue, name: string, task: string) {
  const value = tasks[`${name}#${task}`] ?? tasks[task];
  return record(value) ? value : undefined;
}
function dependencyGroups(manifest: RecordValue) {
  return ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"].flatMap(
    (kind) =>
      record(manifest[kind])
        ? Object.entries(manifest[kind]).map(([name, version]) => ({ kind, name, version }))
        : [],
  );
}
function summary(findings: Finding[]): State {
  if (findings.some((finding) => finding.state === "fail")) return "fail";
  if (findings.some((finding) => finding.state === "unverified")) return "unverified";
  return "pass";
}
async function resolveSource(snapshot: Snapshot, source: string, specifier: string) {
  const base = relative(snapshot.root, resolve(snapshot.root, dirname(source), specifier))
    .split(sep)
    .join("/");
  const candidates = [
    base,
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.jsx$/, ".tsx"),
    base.replace(/\.mjs$/, ".mts"),
    base.replace(/\.cjs$/, ".cts"),
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}/index.ts`,
    `${base}/index.js`,
  ];
  for (const candidate of new Set(candidates))
    if (await snapshot.exists(candidate)) return candidate;
  return undefined;
}

export async function checkMonorepo(
  root: string,
  contractPath: string,
  maxLayer: 1 | 2 = 2,
): Promise<Report> {
  const snapshot = new Snapshot(await realpath(root));
  const findings: Finding[] = [];
  function add(
    layer: 1 | 2,
    state: State,
    rule: string,
    location: string,
    evidence: string,
    remedy: string,
    packages: string[] = [],
    requirements: string[] = [],
    targetDirectory?: string,
  ) {
    findings.push({
      layer,
      state,
      rule,
      location,
      evidence,
      remedy,
      packages,
      requirements,
      ...(targetDirectory === undefined ? {} : { targetDirectory }),
    });
  }
  function result(blocked: boolean): Report {
    return {
      schemaVersion: 1,
      scope: "delivery-preparation",
      state: summary(findings),
      layer2: blocked ? "blocked" : maxLayer === 1 ? "not-requested" : "checked",
      findings,
      evidenceKind: "configuration-and-existing-files",
      onlineVerified: false,
      limitations: [
        "No builds, package packing, isolated consumers or CLI command/extension discovery are executed; existing required artifacts and delivery configuration are checked.",
        "Static source boundaries and declared runtimes are checked, not third-party transitive execution or engine-range intersections.",
        "No remote resource provisioning, secret-value access, deployment, migration, live API health or online OIDC login is performed.",
        "These outside-scope proofs do not block delivery-preparation readiness; unsupported adapters, unresolved imports and missing required configuration/artifacts remain blocking findings.",
      ],
    };
  }
  let contract: Contract;
  try {
    contract = parseContract(await snapshot.json(contractPath));
    add(
      1,
      "pass",
      "contract-schema-v1",
      contractPath,
      "Versioned requirements contract is valid.",
      "",
    );
  } catch (error) {
    add(
      1,
      "fail",
      "contract-schema-v1",
      contractPath,
      error instanceof Error ? error.message : String(error),
      "Repair the contract without inferring requirements from source.",
    );
    add(
      2,
      "unverified",
      "layer-order",
      contractPath,
      "Layer 2 is blocked by the invalid contract.",
      "Resolve layer 1 first.",
    );
    return result(true);
  }
  const byName = new Map(contract.workspaces.map((workspace) => [workspace.name, workspace]));
  const manifests = new Map<string, RecordValue>();
  let workspaceConfig: RecordValue = {};
  let tasks: RecordValue = {};
  let inventory: string[] = [];
  try {
    inventory = await snapshot.files();
    const document = parseDocument(await snapshot.text("pnpm-workspace.yaml"), {
      uniqueKeys: true,
    });
    if (document.errors.length) throw new Error("pnpm-workspace.yaml has YAML parse errors.");
    const parsed: unknown = document.toJS();
    if (!workspaceValidator(parsed))
      throw new Error("pnpm-workspace.yaml violates the supported workspace schema.");
    workspaceConfig = { ...parsed };
    if (Object.keys(workspaceConfig).some((key) => !workspaceFields.has(key))) {
      add(
        1,
        "unverified",
        "workspace-schema",
        "pnpm-workspace.yaml",
        "Unknown workspace configuration fields are outside the supported schema.",
        "Validate with the exact pnpm version and extend the observer; unknown fields are not ignored.",
      );
    }
    const patterns = texts(workspaceConfig.packages);
    if (patterns.some((pattern) => /[{}[\]?\\]/.test(pattern))) {
      add(
        1,
        "unverified",
        "workspace-pattern",
        "pnpm-workspace.yaml",
        "Workspace patterns outside literal, * and ** syntax are not supported.",
        "Use a supported pattern or extend the observer.",
      );
    }
    const turbo = await snapshot.json("turbo.json");
    if (!turboValidator(turbo)) {
      add(
        1,
        turboValidator.errors?.some((error) => error.keyword !== "additionalProperties")
          ? "fail"
          : "unverified",
        "turbo-schema",
        "turbo.json",
        "Invalid or unsupported Turbo fields; task graph cannot be certified.",
        "Validate against the tool schema and extend the explicitly supported subset.",
      );
    }
    tasks = record(turbo.tasks) ? turbo.tasks : {};
    const rootManifest = await snapshot.json("package.json");
    if (!packageValidator(rootManifest))
      throw new Error("Root package.json violates package metadata types.");
    add(
      1,
      "pass",
      "global-config",
      "pnpm-workspace.yaml",
      "Workspace YAML and package metadata are parseable; supported field types checked.",
      "",
    );
    for (const file of inventory.filter((file) => file.endsWith("/package.json"))) {
      const directory = file.slice(0, -"/package.json".length);
      if (
        patterns.some((pattern) => !pattern.startsWith("!") && matches(directory, pattern)) &&
        !patterns.some((pattern) => pattern.startsWith("!") && matches(directory, pattern.slice(1)))
      ) {
        const manifest = await snapshot.json(file);
        if (!packageValidator(manifest)) {
          add(
            1,
            "fail",
            "package-schema",
            file,
            "Invalid package metadata types.",
            "Repair package.json.",
          );
          continue;
        }
        const name = String(manifest.name);
        if (manifests.has(name))
          add(
            1,
            "fail",
            "workspace-identity",
            file,
            `Duplicate package name ${name}.`,
            "Give packages unique identities.",
            [name],
          );
        manifests.set(name, manifest);
        const declared = byName.get(name);
        if (!declared || declared.path !== directory)
          add(
            1,
            "fail",
            "workspace-coverage",
            file,
            "Actual workspace is missing or has a contradictory path in the requirements contract.",
            "Declare its role and exact identity.",
            [name],
          );
      }
    }
  } catch (error) {
    add(
      1,
      "fail",
      "global-config",
      "pnpm-workspace.yaml / turbo.json / package.json",
      error instanceof Error ? error.message : String(error),
      "Repair the indicated readable configuration.",
    );
  }
  for (const file of [
    "README.md",
    "package.json",
    "pnpm-workspace.yaml",
    "turbo.json",
    ...contract.policy.requiredFiles,
  ]) {
    try {
      add(
        1,
        (await snapshot.exists(file)) ? "pass" : "fail",
        "required-file",
        file,
        "Required by pnpm-default-v1 or explicit policy.",
        "Restore the required file.",
      );
    } catch (error) {
      add(
        1,
        "unverified",
        "required-file",
        file,
        String(error),
        "Use a safe non-secret regular file.",
      );
    }
  }
  if (
    byName.size !== contract.workspaces.length ||
    new Set(contract.workspaces.map((workspace) => workspace.path)).size !==
      contract.workspaces.length
  )
    add(
      1,
      "fail",
      "workspace-identity",
      contractPath,
      "Duplicate workspace name or path.",
      "Remove contradictory mappings.",
    );
  const dirs = contract.policy.directories;
  for (const file of inventory.filter((file) =>
    /(?:^|\/)wrangler\.(?:json|jsonc|toml)$/.test(file),
  )) {
    if (
      !contract.deliveries.some((delivery) => delivery.config === file) &&
      !contract.policy.assignments.some(
        (assignment) =>
          assignment.path === file && ["generated", "tool"].includes(assignment.purpose),
      ) &&
      !contract.policy.exceptions.some((exception) => under(file, exception.path))
    ) {
      add(
        1,
        "unverified",
        "deployment-entry-coverage",
        file,
        "Known deployment configuration has no requirement mapping or explicit fixture/tool exception.",
        "Classify the configuration; do not infer a live service or silently omit it.",
      );
    }
  }
  for (const workspace of contract.workspaces) {
    const manifestPath = `${workspace.path}/package.json`;
    if (workspace.allows.some((name) => !byName.has(name))) {
      add(
        1,
        "fail",
        "dependency-mapping",
        contractPath,
        "Allowed dependency names must refer to declared workspaces.",
        "Correct the explicit dependency direction mapping.",
        [workspace.name],
      );
    }
    for (const role of workspace.roles.filter((role) =>
      ["npm", "cli", "browser", "cloudflare-worker"].includes(role),
    )) {
      if (
        !contract.deliveries.some(
          (delivery) => delivery.packages.includes(workspace.name) && delivery.kind === role,
        )
      ) {
        add(
          1,
          "fail",
          "delivery-coverage",
          manifestPath,
          `Role ${role} has no delivery requirement.`,
          "Map actual publishing/deployment entry roles to a requirement.",
          [workspace.name],
        );
      }
    }
    const actual = manifests.get(workspace.name);
    if (
      actual &&
      (actual.private !== true || actual.bin !== undefined) &&
      !workspace.roles.some((role) => role === "npm" || role === "cli")
    ) {
      add(
        1,
        "fail",
        "actual-entry-coverage",
        manifestPath,
        "Non-private package or executable metadata is not represented by its declared roles.",
        "Declare its public/CLI delivery or explicitly make an internal package private.",
        [workspace.name],
      );
    }
    if (!manifests.has(workspace.name))
      add(
        1,
        "fail",
        "workspace-mapping",
        manifestPath,
        "Declared package not included by pnpm workspace patterns or identity mismatch.",
        "Align requirements, workspace patterns and package identity.",
        [workspace.name],
      );
    const executable = workspace.roles.some((role) =>
      ["browser", "cloudflare-worker"].includes(role),
    );
    const expected = executable ? dirs.apps : dirs.packages;
    const exception = contract.policy.exceptions.find((item) => under(workspace.path, item.path));
    add(
      1,
      under(workspace.path, expected) || exception ? "pass" : "fail",
      "layout-package-role",
      workspace.path,
      exception?.reason ??
        `pnpm-default-v1: ${executable ? "applications" : "reusable and tooling packages"} belong under ${expected}.`,
      "Move only after authorization; update imports, workspace patterns, scripts and documentation references.",
      [workspace.name],
      [],
      expected,
    );
    for (const file of ["README.md", ...workspace.entries, ...workspace.sources]) {
      try {
        if (!(await snapshot.exists(`${workspace.path}/${file}`)))
          add(
            1,
            "fail",
            "workspace-file",
            `${workspace.path}/${file}`,
            "Declared entry/source or package documentation is missing.",
            "Restore the file or correct the explicit reference.",
            [workspace.name],
          );
      } catch (error) {
        add(
          1,
          "unverified",
          "workspace-file",
          `${workspace.path}/${file}`,
          String(error),
          "Use safe repository-local non-secret paths.",
          [workspace.name],
        );
      }
    }
  }
  const ids = new Set<string>();
  for (const delivery of contract.deliveries) {
    if (ids.has(delivery.id))
      add(
        1,
        "fail",
        "delivery-identity",
        contractPath,
        "Duplicate delivery ID.",
        "Use stable unique IDs.",
        [],
        [delivery.id],
      );
    ids.add(delivery.id);
    if (
      new Set(delivery.resources.map((resource) => resource.name)).size !==
      delivery.resources.length
    ) {
      add(
        1,
        "fail",
        "resource-identity",
        contractPath,
        "Duplicate or contradictory resource names in one requirement.",
        "Use unique reference names for the selected environment.",
        delivery.packages,
        [delivery.id],
      );
    }
    for (const name of delivery.packages) {
      const manifest = manifests.get(name);
      if (!manifest) continue;
      for (const dependency of dependencyGroups(manifest).filter(
        (dependency) => dependency.kind !== "devDependencies",
      )) {
        if (byName.has(dependency.name) && !delivery.packages.includes(dependency.name)) {
          add(
            1,
            "fail",
            "requirement-closure",
            contractPath,
            `Runtime/peer support package ${dependency.name} is missing from requirement ${delivery.id}.`,
            "Associate the complete runtime support closure; a requirement may span multiple packages.",
            [name, dependency.name],
            [delivery.id],
          );
        }
      }
    }
    const referenced = [...new Set([...delivery.packages, delivery.entry.package])];
    if (
      !delivery.packages.includes(delivery.entry.package) ||
      referenced.some((name) => !byName.has(name))
    )
      add(
        1,
        "fail",
        "delivery-mapping",
        contractPath,
        "Delivery entry or support package is not mapped consistently.",
        "Declare the entry and all support packages.",
        referenced,
        [delivery.id],
      );
    const owner = byName.get(delivery.entry.package);
    if (owner && !owner.entries.includes(delivery.entry.path))
      add(
        1,
        "fail",
        "entry-coverage",
        contractPath,
        "Delivery entry is not a declared package entry.",
        "Declare the actual entry.",
        [owner.name],
        [delivery.id],
      );
    for (const path of [delivery.config, delivery.output].filter(
      (path): path is string => path !== undefined,
    )) {
      try {
        if (path === delivery.config && !(await snapshot.exists(path)))
          add(
            1,
            "fail",
            "delivery-file",
            path,
            "Required delivery configuration is missing.",
            "Provide configuration, not production values.",
            delivery.packages,
            [delivery.id],
          );
      } catch (error) {
        add(
          1,
          "unverified",
          "delivery-file",
          path,
          String(error),
          "Use safe non-secret configuration.",
          delivery.packages,
          [delivery.id],
        );
      }
    }
  }
  const assignments = new Map(
    contract.policy.assignments.map((assignment) => [assignment.path, assignment]),
  );
  if (assignments.size !== contract.policy.assignments.length)
    add(
      1,
      "fail",
      "file-assignment",
      contractPath,
      "Duplicate file assignment.",
      "Resolve conflicting responsibilities.",
    );
  for (const assignment of assignments.values()) {
    const owner = assignment.owner ? byName.get(assignment.owner) : undefined;
    if (assignment.owner && !owner)
      add(
        1,
        "fail",
        "file-owner",
        assignment.path,
        "Unknown file owner.",
        "Declare the owning workspace.",
      );
    let target = assignment.targetDirectory;
    if (!target) {
      if (assignment.purpose === "project-doc") target = dirs.docs;
      if (assignment.purpose === "package-doc" && owner) target = `${owner.path}/docs`;
      if (assignment.purpose === "script") target = owner ? `${owner.path}/scripts` : dirs.scripts;
      if (assignment.purpose === "migration" && owner) target = `${owner.path}/migrations`;
    }
    if (!inventory.includes(assignment.path))
      add(
        1,
        "fail",
        "file-assignment",
        assignment.path,
        "Assigned file does not exist.",
        "Correct the assignment.",
      );
    else if (contract.policy.exceptions.some((item) => under(assignment.path, item.path)))
      add(1, "pass", "file-exception", assignment.path, "Explicit policy exception applies.", "");
    else if (target && !under(assignment.path, target)) {
      const destination = `${target}/${basename(assignment.path)}`;
      add(
        1,
        "fail",
        "file-responsibility",
        assignment.path,
        `pnpm-default-v1 / assignment: ${assignment.reason}.${inventory.includes(destination) ? " Target already exists; explicit conflict resolution is required." : ""}`,
        "After authorization, preserve content and update imports, scripts, links and tool-fixed references; never overwrite an existing target.",
        owner ? [owner.name] : [],
        [],
        target,
      );
    } else
      add(
        1,
        target || ["tool", "generated"].includes(assignment.purpose) ? "pass" : "unverified",
        "file-responsibility",
        assignment.path,
        assignment.reason,
        target
          ? ""
          : "Classify ownership and destination; do not move or delete based on a filename.",
      );
  }
  const rootAllowed = new Set([
    ".editorconfig",
    ".node-version",
    ".npmrc",
    ".gitattributes",
    ".gitignore",
    ".git-lineage.yaml",
    "README.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "AGENTS.md",
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "turbo.json",
    "biome.json",
    "tsconfig.json",
    "tsconfig.base.json",
    "tsconfig.test.json",
    contractPath,
  ]);
  for (const file of inventory) {
    if (
      assignments.has(file) ||
      rootAllowed.has(file) ||
      secretPath.test(file) ||
      [".github", ".silvermoon", ".vscode"].some((directory) => under(file, directory)) ||
      contract.workspaces.some((workspace) => under(file, workspace.path)) ||
      [dirs.docs, dirs.scripts].some((directory) => under(file, directory)) ||
      contract.policy.allowedDirectories.some((item) => under(file, item.path)) ||
      contract.policy.exceptions.some((item) => under(file, item.path))
    )
      continue;
    add(
      1,
      "unverified",
      "file-classification",
      file,
      "No responsibility rule covers this existing file; filename alone is not a violation.",
      "Declare purpose/owner, a reasoned policy override or a tool/generated exception. Do not move or delete.",
    );
  }
  if (
    findings.some(
      (finding) => finding.layer === 1 && ["fail", "unverified"].includes(finding.state),
    )
  ) {
    add(
      2,
      "unverified",
      "layer-order",
      contractPath,
      "Layer 2 blocked: structure or mappings are not fully established.",
      "Resolve layer 1 first.",
    );
    return result(true);
  }
  if (maxLayer === 2)
    await checkPackages(snapshot, contract, manifests, tasks, workspaceConfig, inventory, add);
  return result(false);
}

type Add = (
  layer: 1 | 2,
  state: State,
  rule: string,
  location: string,
  evidence: string,
  remedy: string,
  packages?: string[],
  requirements?: string[],
  targetDirectory?: string,
) => void;
async function checkPackages(
  snapshot: Snapshot,
  contract: Contract,
  manifests: Map<string, RecordValue>,
  tasks: RecordValue,
  workspaceConfig: RecordValue,
  inventory: string[],
  add: Add,
) {
  const byName = new Map(contract.workspaces.map((workspace) => [workspace.name, workspace]));
  const edges = new Map<string, string[]>();
  for (const workspace of contract.workspaces) {
    const manifest = manifests.get(workspace.name);
    if (!manifest) continue;
    const requirements = contract.deliveries
      .filter((delivery) => delivery.packages.includes(workspace.name))
      .map((delivery) => delivery.id);
    const put = (
      state: State,
      rule: string,
      evidence: string,
      remedy = "",
      location = `${workspace.path}/package.json`,
    ) => add(2, state, rule, location, evidence, remedy, [workspace.name], requirements);
    const dependencies = dependencyGroups(manifest);
    edges.set(
      workspace.name,
      dependencies
        .filter((dependency) => byName.has(dependency.name))
        .map((dependency) => dependency.name),
    );
    for (const dependency of dependencies) {
      const target = byName.get(dependency.name);
      if (target) {
        const exception = contract.policy.dependencyExceptions.find(
          (item) => item.from === workspace.name && item.to === target.name,
        );
        if (!workspace.allows.includes(target.name) && !exception)
          put(
            "fail",
            "dependency-direction",
            `${dependency.kind}: ${target.name} is outside the allowed dependency direction.`,
            "Declare a justified exception or correct the dependency.",
          );
        if (typeof dependency.version !== "string" || !dependency.version.startsWith("workspace:"))
          put(
            "fail",
            "workspace-range",
            `${dependency.name} must use workspace: resolution.`,
            "Use the appropriate workspace: range.",
          );
        if (
          dependency.kind !== "devDependencies" &&
          ["browser", "worker"].includes(workspace.runtime) &&
          target.runtime !== workspace.runtime &&
          target.runtime !== "universal"
        )
          put(
            "fail",
            "runtime-boundary",
            `${workspace.runtime} consumes ${target.runtime} package ${target.name}.`,
            "Use a runtime-compatible shared boundary.",
          );
        if (
          workspace.roles.includes("npm") &&
          dependency.kind !== "devDependencies" &&
          manifests.get(target.name)?.private === true
        ) {
          const bundled =
            manifest.bundleDependencies === true ||
            manifest.bundledDependencies === true ||
            texts(manifest.bundleDependencies ?? manifest.bundledDependencies).includes(
              target.name,
            );
          put(
            bundled ? "unverified" : "fail",
            "npm-internal-resolution",
            bundled
              ? `Private dependency ${target.name} is declared bundled; actual tarball inclusion is unverified.`
              : `Published dependency ${target.name} is private and cannot resolve from npm.`,
            "Publish a valid dependency or use an explicitly verified bundling strategy; do not assume workspace rewriting makes a private package available.",
          );
        }
      } else if (
        typeof dependency.version === "string" &&
        dependency.version.startsWith("workspace:")
      )
        put(
          "fail",
          "workspace-dependency",
          `Unresolved internal dependency ${dependency.name}.`,
          "Declare the real workspace identity.",
        );
      else if (
        typeof dependency.version === "string" &&
        dependency.version.startsWith("catalog:")
      ) {
        const name = dependency.version.slice("catalog:".length);
        const catalogs = record(workspaceConfig.catalogs) ? workspaceConfig.catalogs : {};
        const catalog = name ? catalogs[name] : workspaceConfig.catalog;
        if (!record(catalog) || typeof catalog[dependency.name] !== "string")
          put(
            "fail",
            "catalog-reference",
            `Missing catalog version for ${dependency.name}.`,
            "Define the shared version in the pnpm catalog.",
          );
      } else
        put(
          "fail",
          "catalog-version",
          `${dependency.name} is not sourced from the shared pnpm catalog.`,
          "Use catalog: with the shared third-party version.",
        );
    }
    const scripts = record(manifest.scripts) ? manifest.scripts : {};
    for (const task of workspace.tasks) {
      const config = taskFor(tasks, workspace.name, task);
      if (typeof scripts[task] !== "string" || !config)
        put(
          "fail",
          "task-graph",
          `Required task ${task} is missing in package scripts or Turbo.`,
          "Align required scripts and Turbo tasks.",
        );
      if (task === "build" && config) {
        if (!Array.isArray(config.outputs) || config.outputs.length === 0)
          put(
            "fail",
            "build-outputs",
            "Build has no declared outputs.",
            "Declare actual artifact output paths in Turbo.",
          );
        if (
          (edges.get(workspace.name)?.length ?? 0) > 0 &&
          !texts(config.dependsOn).includes("^build")
        )
          put(
            "fail",
            "build-prerequisites",
            "Internal dependencies lack ^build scheduling.",
            "Declare dependency build prerequisites or an explicit supported task graph.",
          );
      }
    }
    if (
      workspace.roles.some((role) => ["internal", "tool"].includes(role)) &&
      !workspace.roles.includes("npm")
    )
      put(
        manifest.private === true ? "pass" : "fail",
        "internal-role",
        "Internal/tool packages must explicitly be private in pnpm-default-v1.",
        "Set private:true or declare a public package role instead.",
      );
    if (workspace.roles.includes("npm")) {
      put(
        manifest.private !== true &&
          typeof manifest.version === "string" &&
          record(manifest.publishConfig) &&
          manifest.publishConfig.access === "public"
          ? "pass"
          : "fail",
        "npm-identity",
        "Public npm identity, version and access metadata.",
        "Declare public publish metadata without publishing.",
      );
      const exports = texts(manifest.exports);
      const cliOnly = workspace.roles.includes("cli") && exports.length === 0;
      put(
        cliOnly ? "not-applicable" : exports.length > 0 ? "pass" : "fail",
        "npm-exports",
        cliOnly
          ? "Executable-only npm packages do not need a JavaScript library export."
          : "Public library exports must be explicit.",
        "Declare package entry exports.",
      );
      const publishing = record(manifest.publishConfig) ? manifest.publishConfig : {};
      put(
        typeof publishing.tag === "string" || publishing.tag === undefined ? "pass" : "fail",
        "npm-channel",
        `Configured npm channel is ${typeof publishing.tag === "string" ? publishing.tag : "latest (npm default)"}; release-command overrides are not executed.`,
        "Declare a valid publishConfig.tag or validate the release workflow separately.",
      );
      const files = texts(manifest.files);
      const sensitiveFiles = inventory.filter(
        (file) =>
          under(file, workspace.path) &&
          secretPath.test(file) &&
          !/(?:^|\/)(?:\.npmrc|\.env\.(?:example|sample|template))$/.test(file) &&
          files.some(
            (pattern) =>
              under(
                file.slice(workspace.path.length + 1),
                pattern.replace(/^\.\//, "").replace(/\/\*\*$/, ""),
              ) || matches(file.slice(workspace.path.length + 1), pattern),
          ),
      );
      for (const file of sensitiveFiles)
        put(
          "unverified",
          "npm-sensitive-file",
          "Publish scope contains a potentially sensitive file; only its path was observed, not its values.",
          "Remove secret-value files from publish scope or use a supported non-secret template convention.",
          file,
        );
      put(
        files.length > 0 &&
          !files.some((file) => secretPath.test(file) || file === "." || file === "**")
          ? "pass"
          : "fail",
        "npm-files",
        "Publish allowlist must be bounded and exclude secret-value paths.",
        "Declare precise publish paths.",
      );
      for (const file of [...exports, ...texts(manifest.types)]) {
        if (!file.startsWith("./") || file.includes("*")) {
          put(
            "unverified",
            "npm-export-target",
            "Conditional/pattern target is outside supported literal export targets.",
            "Provide literal targets or extend the observer.",
          );
          continue;
        }
        const included = files.some(
          (pattern) =>
            under(file.slice(2), pattern.replace(/^\.\//, "").replace(/\/\*\*$/, "")) ||
            matches(file.slice(2), pattern),
        );
        if (!included)
          put(
            "fail",
            "npm-content",
            `Public target ${file} is outside publish files.`,
            "Include the public target.",
          );
        try {
          put(
            (await snapshot.exists(`${workspace.path}/${file}`)) ? "pass" : "unverified",
            "npm-artifact",
            `Existing file check for public target ${file}; no pack/build executed.`,
            "Build/pack separately in an authorized environment; metadata is not consumption proof.",
          );
        } catch (error) {
          put("unverified", "npm-artifact", String(error), "Use a safe regular artifact.");
        }
      }
      if (cliOnly)
        put(
          "not-applicable",
          "npm-types",
          "Executable-only npm package has no public library typing surface.",
        );
      else if (!texts(manifest.types).length && !exports.some((file) => /\.d\.[cm]?ts$/.test(file)))
        put(
          "unverified",
          "npm-types",
          "No type declaration evidence.",
          "Provide types or establish that declarations are not applicable.",
        );
    }
    if (workspace.roles.includes("cli")) {
      const bins = texts(manifest.bin);
      put(
        bins.length > 0 ? "pass" : "fail",
        "cli-bin",
        "Executable entry metadata.",
        "Declare bin entry points.",
      );
      if (!record(manifest.engines) || typeof manifest.engines.node !== "string")
        put("fail", "cli-runtime", "CLI Node engine is missing.", "Declare a compatible runtime.");
      for (const bin of bins) {
        try {
          const path = `${workspace.path}/${bin}`;
          if (!(await snapshot.exists(path)))
            put(
              "unverified",
              "cli-artifact",
              `Executable ${bin} is absent.`,
              "Build and inspect the artifact separately.",
            );
          else
            put(
              (await snapshot.text(path)).startsWith("#!/usr/bin/env node") ? "pass" : "fail",
              "cli-entry",
              "Existing Node executable requires its shebang.",
              "Add the executable interpreter declaration.",
              path,
            );
        } catch (error) {
          put("unverified", "cli-entry", String(error), "Use a safe executable file.");
        }
        if (
          workspace.roles.includes("npm") &&
          !texts(manifest.files).some((file) =>
            under(bin.replace(/^\.\//, ""), file.replace(/^\.\//, "")),
          )
        )
          put(
            "fail",
            "cli-publish-files",
            `Executable ${bin} is outside the publish allowlist.`,
            "Include the executable.",
          );
      }
    }
    const actualSources = inventory.filter(
      (file) =>
        under(file, workspace.path) &&
        /\.[cm]?[jt]sx?$/.test(file) &&
        !file.includes("/dist/") &&
        !/(?:\/(?:test|tests|__tests__)\/|[.](?:test|spec)[.])/.test(file),
    );
    for (const source of actualSources) {
      try {
        const content = await snapshot.text(source);
        for (const { specifier, typeOnly } of sourceImports(source, content)) {
          if (specifier === null) {
            put(
              "unverified",
              "computed-import",
              "A computed import cannot be resolved by the static observer.",
              "Provide a supported static entry mapping or a target-specific observer.",
              source,
            );
            continue;
          }
          if (
            !typeOnly &&
            workspace.sources.some((path) => source === `${workspace.path}/${path}`) &&
            ["browser", "worker"].includes(workspace.runtime) &&
            (nodeImports.has(specifier) || /(?:server-only|secrets?)(?:\/|$)/.test(specifier))
          )
            put(
              workspace.runtime === "worker" ? "unverified" : "fail",
              "source-runtime",
              "Server-only import in browser/Worker source; Worker Node compatibility requires explicit platform verification.",
              "Remove the server-only dependency or validate the applicable Worker compatibility flags separately.",
              source,
            );
          if (specifier.startsWith(".")) {
            const targetPath = relative(
              snapshot.root,
              resolve(snapshot.root, dirname(source), specifier),
            )
              .split(sep)
              .join("/");
            const other = contract.workspaces.find(
              (candidate) => candidate.name !== workspace.name && under(targetPath, candidate.path),
            );
            if (other)
              put(
                "fail",
                "entry-boundary",
                `Relative import bypasses ${other.name}'s public boundary.`,
                "Import its declared package exports.",
                source,
              );
            else if (!(await resolveSource(snapshot, source, specifier))) {
              put(
                "unverified",
                "source-import-resolution",
                "A relative source import could not be resolved by the supported JS/TS mapping.",
                "Restore the required source or declare a supported build/alias mapping.",
                source,
              );
            }
          } else {
            const target = contract.workspaces.find(
              (candidate) =>
                specifier === candidate.name || specifier.startsWith(`${candidate.name}/`),
            );
            if (
              !target &&
              !nodeImports.has(specifier) &&
              !dependencies.some(
                (dependency) =>
                  specifier === dependency.name || specifier.startsWith(`${dependency.name}/`),
              )
            ) {
              put(
                "unverified",
                "external-import-resolution",
                "An import is neither a declared dependency, builtin nor a supported workspace entry.",
                "Declare its dependency or add an explicit tool-specific alias adapter.",
                source,
              );
            }
            if (target && target.name !== workspace.name) {
              if (!dependencies.some((dependency) => dependency.name === target.name))
                put(
                  "fail",
                  "undeclared-import",
                  `Import of ${target.name} has no dependency declaration.`,
                  "Declare the correct dependency kind.",
                  source,
                );
              const exported = manifests.get(target.name)?.exports;
              const subpath =
                specifier === target.name ? "." : `.${specifier.slice(target.name.length)}`;
              if (
                !(typeof exported === "string" && subpath === ".") &&
                !(
                  record(exported) &&
                  ((Object.hasOwn(exported, subpath) && exported[subpath] !== null) ||
                    Object.entries(exported).some(
                      ([key, value]) =>
                        key.includes("*") && value !== null && matches(subpath, key),
                    ) ||
                    (subpath === "." && !Object.keys(exported).some((key) => key.startsWith("."))))
                )
              )
                put(
                  "fail",
                  "entry-boundary",
                  `Import ${specifier} is not a declared literal export.`,
                  "Use a declared public entry.",
                  source,
                );
            }
          }
        }
      } catch (error) {
        put(
          "unverified",
          "source-observation",
          String(error),
          "Use safe bounded source files.",
          source,
        );
      }
    }
    put(
      "pass",
      "package-observed",
      "All declared roles were evaluated; pass here does not override any unverified or failing checks.",
    );
  }
  for (const start of byName.keys()) {
    const visited = new Set<string>();
    const visit = (name: string, path: string[]): boolean => {
      if (path.includes(name)) return name === start;
      if (visited.has(name)) return false;
      visited.add(name);
      return (edges.get(name) ?? [])
        .filter(
          (target) =>
            !contract.policy.dependencyExceptions.some(
              (exception) =>
                exception.from === name && exception.to === target && exception.allowCycle === true,
            ),
        )
        .some((target) => visit(target, [...path, name]));
    };
    if (visit(start, []))
      add(
        2,
        "fail",
        "dependency-cycle",
        byName.get(start)?.path ?? "",
        "Internal dependency graph contains a cycle involving this package (including development/peer edges).",
        "Remove the cycle; do not bypass public boundaries.",
        [start],
        contract.deliveries
          .filter((delivery) => delivery.packages.includes(start))
          .map((delivery) => delivery.id),
      );
  }
  checkTaskGraph(contract, manifests, tasks, edges, add);
  for (const delivery of contract.deliveries)
    await checkDelivery(snapshot, delivery, byName, tasks, add, contract.deliveries);
}

function checkTaskGraph(
  contract: Contract,
  manifests: Map<string, RecordValue>,
  tasks: RecordValue,
  dependencies: Map<string, string[]>,
  add: Add,
) {
  const graph = new Map<string, string[]>();
  for (const workspace of contract.workspaces) {
    const scripts = manifests.get(workspace.name)?.scripts;
    if (!record(scripts)) continue;
    for (const task of workspace.tasks) {
      const key = `${workspace.name}#${task}`;
      const config = taskFor(tasks, workspace.name, task);
      const links: string[] = [];
      for (const reference of texts(config?.dependsOn)) {
        if (reference.startsWith("//#")) {
          add(
            2,
            "unverified",
            "task-reference",
            "turbo.json",
            "Root task references need root task observation, outside the current workspace task adapter.",
            "Validate the root task explicitly; do not reinterpret it as a missing package.",
            [workspace.name],
          );
          continue;
        }
        const targets = reference.startsWith("^")
          ? (dependencies.get(workspace.name) ?? []).map((name) => `${name}#${reference.slice(1)}`)
          : [reference.includes("#") ? reference : `${workspace.name}#${reference}`];
        for (const target of targets) {
          const split = target.lastIndexOf("#");
          const name = target.slice(0, split);
          const taskName = target.slice(split + 1);
          if (
            reference.startsWith("^") &&
            !contract.workspaces
              .find((candidate) => candidate.name === name)
              ?.tasks.includes(taskName)
          )
            continue;
          const targetScripts = manifests.get(name)?.scripts;
          if (
            !record(targetScripts) ||
            typeof targetScripts[taskName] !== "string" ||
            !taskFor(tasks, name, taskName)
          ) {
            add(
              2,
              "fail",
              "task-reference",
              "turbo.json",
              `${key} references missing task ${target}.`,
              "Align task references with workspace scripts and Turbo.",
              [workspace.name],
              contract.deliveries
                .filter((delivery) => delivery.packages.includes(workspace.name))
                .map((delivery) => delivery.id),
            );
          }
          links.push(target);
        }
      }
      graph.set(key, links);
    }
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  function visit(key: string): boolean {
    if (active.has(key)) return true;
    if (visited.has(key)) return false;
    active.add(key);
    if ((graph.get(key) ?? []).some(visit)) return true;
    active.delete(key);
    visited.add(key);
    return false;
  }
  for (const key of graph.keys()) {
    if (visit(key)) {
      add(
        2,
        "fail",
        "task-cycle",
        "turbo.json",
        `Task graph contains a cycle reachable from ${key}.`,
        "Remove the task cycle without removing required validation.",
      );
      break;
    }
  }
}

async function checkDelivery(
  snapshot: Snapshot,
  delivery: Delivery,
  byName: Map<string, Workspace>,
  tasks: RecordValue,
  add: Add,
  deliveries: readonly Delivery[],
) {
  const put = (
    state: State,
    rule: string,
    evidence: string,
    remedy = "",
    location = delivery.config ?? delivery.entry.path,
  ) => add(2, state, rule, location, evidence, remedy, delivery.packages, [delivery.id]);
  const owner = byName.get(delivery.entry.package);
  if (!owner) return;
  const ownerPath = owner.path;
  if (delivery.runtime === "browser" || delivery.runtime === "worker") {
    const seen = new Set<string>();
    async function inspect(path: string): Promise<void> {
      if (seen.has(path)) return;
      seen.add(path);
      if (seen.size > 1000) {
        put(
          "unverified",
          "entry-runtime",
          "Entry import graph exceeds 1,000 files.",
          "Narrow or extend the runtime observer.",
          path,
        );
        return;
      }
      let source: string;
      try {
        source = await snapshot.text(path);
      } catch {
        put(
          "unverified",
          "entry-runtime",
          "Referenced entry source cannot be inspected.",
          "Provide a readable source/build mapping.",
          path,
        );
        return;
      }
      for (const { specifier, typeOnly } of sourceImports(path, source)) {
        if (typeOnly) continue;
        if (specifier === null) {
          put(
            "unverified",
            "computed-import",
            "Delivery entry contains an unresolved computed import.",
            "Use a supported static entry mapping.",
            path,
          );
          continue;
        }
        if (nodeImports.has(specifier) || /(?:server-only|secrets?)(?:\/|$)/.test(specifier)) {
          put(
            delivery.runtime === "browser" ? "fail" : "unverified",
            "entry-runtime",
            "Delivery entry transitively imports a server-only module.",
            "Remove it from browser paths or separately verify Worker compatibility.",
            path,
          );
        }
        if (specifier.startsWith(".")) {
          const candidate = await resolveSource(snapshot, path, specifier);
          if (candidate && under(candidate, ownerPath)) await inspect(candidate);
          else
            put(
              "unverified",
              "entry-source-mapping",
              "A relative entry import could not be resolved by the supported JS/TS mapping.",
              "Validate the tool-specific alias/extension mapping.",
              path,
            );
        }
      }
    }
    await inspect(`${owner.path}/${delivery.entry.path}`);
  }
  const kinds = ["npm", "cli", "browser", "cloudflare-worker"];
  if (!kinds.includes(delivery.kind)) {
    put(
      "unverified",
      "unsupported-delivery",
      `Unsupported delivery target ${delivery.kind}.`,
      "Add a target-specific observer; do not treat this as successful service readiness.",
    );
    return;
  }
  if (!owner.roles.includes(delivery.kind as "npm" | "cli" | "browser" | "cloudflare-worker"))
    put(
      "fail",
      "delivery-role",
      "Delivery kind is missing from entry package roles.",
      "Compose all applicable roles on the package.",
    );
  if (owner.runtime !== delivery.runtime && owner.runtime !== "universal")
    put(
      "fail",
      "delivery-runtime",
      "Entry runtime and delivery runtime disagree.",
      "Correct the explicit runtime mapping.",
    );
  for (const resource of delivery.resources) {
    if (resource.environment !== delivery.environment)
      put(
        "fail",
        "resource-environment",
        `Reference ${resource.name} belongs to a different environment.`,
        "Map resources to the exact target environment.",
      );
    if (
      resource.kind === "secret" &&
      (resource.visibility === "public" || delivery.runtime === "browser")
    )
      put(
        "fail",
        "secret-boundary",
        `Secret reference ${resource.name} would cross the public boundary.`,
        "Keep secrets on the service side; never supply their values to the checker.",
      );
    if (
      resource.kind === "configuration" &&
      delivery.kind === "browser" &&
      resource.visibility !== "public"
    )
      put(
        "fail",
        "browser-configuration",
        `Browser configuration ${resource.name} is not explicitly public.`,
        "Declare public configuration and its build/runtime injection stage.",
      );
  }
  for (const service of delivery.services) {
    const target = byName.get(service);
    const external = delivery.resources.find(
      (resource) =>
        resource.name === service &&
        resource.kind === "service" &&
        resource.environment === delivery.environment,
    );
    if (!target && external) {
      put(
        delivery.runtime !== "browser" || external.visibility === "public" ? "pass" : "fail",
        "service-visibility",
        `External service ${service} is an explicit environment-scoped supply reference, not a verified live endpoint.`,
        "Browser API references must be public, without embedding credentials.",
      );
      continue;
    }
    if (!target || !delivery.packages.includes(service)) {
      put(
        "fail",
        "service-mapping",
        `API/service reference ${service} is not associated with this requirement.`,
        "Associate the actual service workspace, or declare an explicit external service reference in the same environment.",
      );
      continue;
    }
    if (!target.roles.includes("cloudflare-worker")) {
      put(
        "fail",
        "service-role",
        `Associated package ${service} is not a supported service role.`,
        "Reference an actual supported service entry; an internal/shared package is not an API service.",
      );
      continue;
    }
    const sameEnvironment = deliveries.some(
      (candidate) =>
        candidate.kind === "cloudflare-worker" &&
        candidate.entry.package === service &&
        candidate.runtime === "worker" &&
        candidate.environment !== undefined &&
        candidate.environment === delivery.environment,
    );
    put(
      sameEnvironment ? "pass" : "fail",
      "service-environment",
      `Service ${service} must have a supported service delivery in the consumer's exact environment.`,
      "Align the actual service delivery environment; package association alone is not evidence.",
    );
  }
  for (const capability of delivery.capabilities) {
    if (capability === "oidc") {
      put(
        delivery.resources.some((resource) => resource.kind === "identity") ? "pass" : "fail",
        "oidc-preparation",
        "OIDC needs an identity reference and supply/environment mapping, not secret values.",
        "Declare the identity supply reference.",
      );
    } else if (capability === "migrations") {
      put(
        delivery.migration !== undefined &&
          delivery.packages.includes(delivery.migration.package) &&
          byName.get(delivery.migration.package)?.entries.includes(delivery.migration.entry) ===
            true &&
          delivery.resources.some(
            (resource) =>
              resource.kind === "resource" && resource.name === delivery.migration?.resource,
          )
          ? "pass"
          : "fail",
        "migration-preparation",
        "Migration requires a target resource and declared execution entry.",
        "Declare the migration resource and entry; never execute it in this observer.",
      );
    } else
      put(
        "unverified",
        "unsupported-capability",
        `Unsupported capability ${capability}.`,
        "Add a dedicated observer.",
      );
  }
  if (!delivery.capabilities.includes("oidc"))
    put("not-applicable", "oidc-preparation", "OIDC is not requested.");
  if (delivery.independent) {
    const build = taskFor(tasks, owner.name, "build");
    put(
      build && typeof build === "object" ? "pass" : "fail",
      "independent-delivery",
      "Independent delivery requires a declared build task.",
      "Declare an independently schedulable build.",
    );
  } else
    put(
      "not-applicable",
      "independent-delivery",
      "No independent delivery constraint is declared.",
    );
  if (!["browser", "cloudflare-worker"].includes(delivery.kind)) return;
  if (!delivery.config || !delivery.output || !delivery.environment) {
    put(
      "fail",
      "deployment-preparation",
      "Target needs configuration, output and environment references.",
      "Declare all three references.",
    );
    return;
  }
  try {
    if (extname(delivery.config) !== ".json") {
      put(
        "unverified",
        "deployment-format",
        "Only strict JSON deployment configuration is supported (no JSONC/TOML executable adapters).",
        "Use strict JSON or add the tool's parser.",
      );
      return;
    }
    const config = await snapshot.json(delivery.config);
    if (delivery.kind === "cloudflare-worker") {
      if (
        Object.keys(config).some(
          (key) =>
            ![
              "$schema",
              "name",
              "main",
              "compatibility_date",
              "compatibility_flags",
              "env",
              "vars",
              "d1_databases",
              "kv_namespaces",
              "r2_buckets",
              "services",
              "queues",
            ].includes(key),
        )
      ) {
        put(
          "unverified",
          "worker-schema",
          "Wrangler fields outside the supported preparation adapter are present.",
          "Validate those fields with a target-specific adapter instead of ignoring them.",
        );
      }
      if (delivery.runtime !== "worker")
        put(
          "fail",
          "worker-runtime",
          "Cloudflare requires worker runtime.",
          "Correct the target runtime.",
        );
      const envs = record(config.env) ? config.env : {};
      const environment = envs[delivery.environment];
      if (!record(environment)) {
        put(
          "fail",
          "worker-environment",
          "Wrangler target environment is absent.",
          "Declare the exact Wrangler environment.",
        );
        return;
      }
      const main = environment.main ?? config.main;
      for (const resource of delivery.resources) {
        if (
          resource.kind === "configuration" &&
          (!record(environment.vars) || !Object.hasOwn(environment.vars, resource.name))
        ) {
          put(
            "fail",
            "worker-configuration",
            `Missing environment-local ordinary configuration reference ${resource.name}.`,
            "Declare the non-secret variable in the selected environment.",
          );
        }
        if (
          resource.kind === "secret" &&
          record(environment.vars) &&
          Object.hasOwn(environment.vars, resource.name)
        ) {
          put(
            "fail",
            "worker-secret-storage",
            `Secret reference ${resource.name} is configured as a plain variable.`,
            "Remove literal secrets from configuration and use platform secret provisioning; values are not reported.",
          );
        }
      }
      const expected = relative(
        snapshot.root,
        resolve(snapshot.root, dirname(delivery.config), typeof main === "string" ? main : ""),
      )
        .split(sep)
        .join("/");
      if (expected !== `${owner.path}/${delivery.entry.path}`)
        put(
          "fail",
          "worker-entry",
          "Wrangler main does not match the declared entry.",
          "Align the entry relative to Wrangler configuration.",
        );
      if (
        typeof (environment.name ?? config.name) !== "string" ||
        typeof (environment.compatibility_date ?? config.compatibility_date) !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(
          String(environment.compatibility_date ?? config.compatibility_date),
        )
      )
        put(
          "fail",
          "worker-schema",
          "Wrangler name or compatibility_date is invalid.",
          "Declare explicit Worker metadata.",
        );
      for (const resource of delivery.resources.filter(
        (resource) =>
          resource.kind === "resource" ||
          (resource.kind === "service" && resource.supply === "platform"),
      )) {
        const bindings = [
          "d1_databases",
          "kv_namespaces",
          "r2_buckets",
          "services",
          "queues",
        ].flatMap((field) => {
          const value = environment[field];
          return Array.isArray(value) ? value : record(value) ? Object.values(value).flat() : [];
        });
        if (!bindings.some((binding) => record(binding) && binding.binding === resource.name))
          put(
            "fail",
            "worker-binding",
            `Missing environment-local binding ${resource.name}.`,
            "Declare the binding in the target environment (not a secret value).",
          );
      }
    } else {
      if (
        Object.keys(config).some(
          (key) => !["entry", "environment", "outputDirectory"].includes(key),
        )
      )
        put(
          "unverified",
          "browser-deployment-schema",
          "Unknown fields in the supported static deployment reference adapter.",
          "Use the documented adapter schema or add target-specific support.",
        );
      if (delivery.runtime !== "browser")
        put(
          "fail",
          "browser-runtime",
          "Browser delivery requires browser runtime.",
          "Correct the runtime.",
        );
      if (
        config.outputDirectory !== delivery.output ||
        config.environment !== delivery.environment ||
        config.entry !== `${owner.path}/${delivery.entry.path}`
      )
        put(
          "fail",
          "browser-deployment",
          "Static deployment JSON entry/environment/output disagree with the requirement.",
          "Align deployment references; this JSON is a reference adapter, not a platform deployment.",
        );
    }
    const build = taskFor(tasks, owner.name, "build");
    if (
      !build ||
      !texts(build.outputs).some((output) =>
        under(delivery.output ?? "", `${owner.path}/${output.replace(/\/\*\*$/, "")}`),
      )
    )
      put(
        "fail",
        "deployment-output",
        "Delivery output is not covered by the entry package's Turbo build outputs.",
        "Align build and deployment output directories.",
      );
    const outputFiles = await snapshot.files(delivery.output, true).catch((error: unknown) => {
      if (record(error) && error.code === "ENOENT") return [];
      throw error;
    });
    put(
      outputFiles.length ? "pass" : "unverified",
      "delivery-artifact",
      "Only existing output files are observed; no build, deploy or migration is executed.",
      "Produce and verify artifacts separately.",
    );
  } catch (error) {
    put(
      error instanceof SyntaxError || error instanceof TypeError ? "fail" : "unverified",
      "delivery-observation",
      error instanceof Error ? error.message : String(error),
      "Repair readable non-secret JSON configuration; unsupported observation is never success.",
    );
  }
}
