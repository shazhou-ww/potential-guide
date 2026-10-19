import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import { parseDocument } from "yaml";
import { type Contract, parseContract } from "./contract.js";
import { checkPackages } from "./packages.js";
import {
  dependencyGroups,
  type Finding,
  matches,
  packageValidator,
  type RecordValue,
  type Report,
  record,
  Snapshot,
  type State,
  secretPath,
  summary,
  texts,
  turboValidator,
  under,
  workspaceFields,
  workspaceValidator,
} from "./shared.js";
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
