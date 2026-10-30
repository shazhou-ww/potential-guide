import { resolve } from "node:path";
import type { Contract, Workspace } from "./contract.js";
import { checkDelivery } from "./delivery.js";
import { checkDeliveryMappings } from "./delivery-mapping.js";
import { checkDependencyRules } from "./dependency-rules.js";
import { checkCliPackage } from "./package-cli.js";
import { checkPackagePublication } from "./package-publication.js";
import { checkPackageTasks } from "./package-tasks.js";
import { recorder } from "./report.js";
import { observeRepository, type RepositoryFacts } from "./repository-observation.js";
import {
  dependencyGroups,
  type RecordValue,
  type ReportPut,
  record,
  Snapshot,
  taskFor,
  texts,
  turboValidator,
  under,
  workspaceFields,
} from "./shared.js";
import { checkSourceBoundaries } from "./source-boundaries.js";
import { defaultPolicy, type PackageSubject, parsePackageSubject } from "./subjects.js";

export function workspaceMetadata(
  subject: PackageSubject,
  manifest: RecordValue,
  inventory: string[],
  tasks: RecordValue,
): Workspace {
  const scripts = record(manifest.scripts) ? manifest.scripts : {};
  const required = [
    "build",
    ...(typeof scripts.check === "string" ? ["check"] : ["lint", "test", "typecheck"]),
  ];
  return {
    name: String(manifest.name),
    path: subject.directory,
    roles: subject.roles,
    runtime: subject.runtime,
    allows: subject.allows,
    entries: subject.entries,
    sources: inventory
      .filter((file) => under(file, subject.directory) && /\.[cm]?[jt]sx?$/.test(file))
      .map((file) => file.slice(subject.directory.length + 1)),
    tasks: [
      ...new Set([
        ...required,
        ...Object.keys(scripts).filter((task) => taskFor(tasks, String(manifest.name), task)),
      ]),
    ],
  };
}

export async function applicableTasks(
  snapshot: Snapshot,
  directory: string,
  name: string,
  rootTasks: RecordValue,
): Promise<RecordValue> {
  if (!(await snapshot.exists(`${directory}/turbo.json`))) return rootTasks;
  const value = await snapshot.json(`${directory}/turbo.json`);
  if (!Array.isArray(value.extends) || value.extends.length !== 1 || value.extends[0] !== "//")
    throw new Error("Package Turbo configuration must explicitly extend //.");
  const { extends: _extends, ...configuration } = value;
  if (!turboValidator(configuration) || !record(configuration.tasks))
    throw new Error("Invalid or unsupported package Turbo configuration.");
  return {
    ...rootTasks,
    ...Object.fromEntries(
      Object.entries(configuration.tasks).map(([key, task]) => {
        if (key.includes("#"))
          throw new Error("Package Turbo task keys cannot name other packages.");
        if (!record(task)) throw new Error("Package Turbo task must be an object.");
        return [`${name}#${key}`, { ...taskFor(rootTasks, name, key), ...task }];
      }),
    ),
  };
}

export function factualWorkspaces(facts: RepositoryFacts): Workspace[] {
  return facts.packages
    .filter(({ valid }) => valid)
    .map(({ directory, manifest }) => ({
      name: String(manifest.name),
      path: directory,
      roles: [],
      runtime: "universal",
      allows: [],
      entries: [],
      sources: [],
      tasks: [],
    }));
}

export async function checkPackage(value: unknown, maxLayer: 1 | 2 = 2) {
  const subject = parsePackageSubject(value);
  const snapshot = await Snapshot.open(subject.root);
  await snapshot.path(subject.directory);
  if (resolve(snapshot.root, subject.directory) === snapshot.root)
    throw new Error("Expected a workspace directory.");
  const output = recorder();
  const { add } = output;
  const facts = await observeRepository(snapshot, subject.directory);
  const actual = facts.packages.find(({ directory }) => directory === subject.directory);
  if (!actual?.valid || facts.failure !== undefined) {
    add(
      1,
      "fail",
      "package-configuration",
      subject.directory,
      facts.failure ?? "Package not discovered by pnpm or invalid package metadata.",
      "Repair this package and its applicable workspace configuration.",
    );
    return output.report(maxLayer);
  }
  let tasks: RecordValue;
  try {
    tasks = await applicableTasks(
      snapshot,
      subject.directory,
      String(actual.manifest.name),
      facts.tasks,
    );
  } catch (error) {
    add(
      1,
      "fail",
      "turbo-schema",
      `${subject.directory}/turbo.json`,
      String(error),
      "Repair the applicable Turbo configuration.",
    );
    return output.report(maxLayer);
  }
  if (facts.turboValidity !== "valid")
    add(
      1,
      "fail",
      "turbo-schema",
      "turbo.json",
      "Invalid or unsupported applicable Turbo configuration.",
      "Repair Turbo tasks.",
    );
  if (
    Object.keys(facts.workspaceConfig).some((key) => !workspaceFields.has(key)) ||
    texts(facts.workspaceConfig.packages).some((pattern) => /[{}[\]?\\]/.test(pattern))
  )
    add(
      1,
      "unverified",
      "workspace-schema",
      "pnpm-workspace.yaml",
      "Applicable workspace configuration or patterns are outside the supported subset.",
      "Use supported workspace discovery or extend the observer.",
    );
  const workspace = workspaceMetadata(subject, actual.manifest, facts.inventory, tasks);
  const workspaces = factualWorkspaces(facts).map((candidate) =>
    candidate.name === workspace.name ? workspace : candidate,
  );
  const model: Contract = {
    schemaVersion: 1,
    workspaces,
    deliveries: subject.deliveries,
    policy: {
      ...defaultPolicy,
      assignments: subject.generated.map((item) => ({
        path: `${subject.directory}/${item.path}`,
        purpose: "generated",
        owner: workspace.name,
        reason: item.reason,
      })),
    },
  };
  const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
  if (subject.allows.some((name) => !byName.has(name)))
    add(
      1,
      "fail",
      "dependency-mapping",
      subject.directory,
      "Allowed dependency names must identify discovered packages.",
      "Correct this package's explicit direction mapping.",
    );
  if (new Set(subject.generated.map(({ path }) => path)).size !== subject.generated.length)
    add(
      1,
      "fail",
      "file-assignment",
      subject.directory,
      "Duplicate generated-file declaration.",
      "Use one reasoned declaration for each generated file.",
    );
  for (const file of ["README.md", ...subject.entries]) {
    if (!(await snapshot.exists(`${subject.directory}/${file}`)))
      add(
        1,
        "fail",
        "workspace-file",
        `${subject.directory}/${file}`,
        "Package entry or documentation is missing.",
        "Restore the package file.",
        [workspace.name],
      );
  }
  for (const role of subject.roles.filter((role) =>
    ["npm", "cli", "browser", "cloudflare-worker"].includes(role),
  )) {
    if (
      !subject.joins.some(({ kind }) => kind === role) &&
      !subject.deliveries.some(
        ({ kind, entry }) => kind === role && entry.package === workspace.name,
      )
    )
      add(
        1,
        "fail",
        "delivery-coverage",
        subject.directory,
        `Role ${role} has no local or joint delivery intent.`,
        "Declare this package's delivery intent.",
        [workspace.name],
      );
  }
  if (
    (actual.manifest.private !== true || actual.manifest.bin !== undefined) &&
    !subject.roles.some((role) => role === "npm" || role === "cli")
  )
    add(
      1,
      "fail",
      "actual-entry-coverage",
      subject.directory,
      "Public/executable metadata is not represented by package roles.",
      "Declare the actual package role.",
      [workspace.name],
    );
  for (const delivery of subject.deliveries) {
    if (delivery.entry.package !== workspace.name)
      add(
        1,
        "fail",
        "delivery-owner",
        subject.directory,
        "Package-local delivery must be owned by this package.",
        "Move joint delivery requirements to the repository.",
      );
  }
  for (const generated of subject.generated)
    if (!(await snapshot.exists(`${subject.directory}/${generated.path}`)))
      add(
        1,
        "fail",
        "file-assignment",
        generated.path,
        "Declared generated file is absent.",
        "Build it separately or correct the declaration.",
      );
  await checkDeliveryMappings(
    snapshot,
    model,
    `${subject.directory}/objectives.yaml`,
    byName,
    facts.manifests,
    add,
  );
  if (output.blocked() || maxLayer === 1) return output.report(maxLayer);
  const put: ReportPut = (
    state,
    rule,
    evidence,
    remedy = "",
    location = `${subject.directory}/package.json`,
  ) => add(2, state, rule, location, evidence, remedy, [workspace.name]);
  const dependencies = dependencyGroups(actual.manifest);
  checkDependencyRules(
    model,
    workspace,
    actual.manifest,
    byName,
    facts.manifests,
    facts.workspaceConfig,
    dependencies,
    put,
  );
  checkPackageTasks(
    workspace,
    actual.manifest,
    tasks,
    dependencies.some(({ name }) => byName.has(name)),
    put,
  );
  await checkPackagePublication(snapshot, workspace, actual.manifest, facts.inventory, put);
  await checkCliPackage(snapshot, workspace, actual.manifest, put);
  await checkSourceBoundaries(
    {
      snapshot,
      contract: model,
      workspace,
      manifests: facts.manifests,
      dependencies,
      put,
      localConfigurationImports: new Map(
        (subject.localConfigurationImports ?? []).map(({ path, reason }) => [
          `${subject.directory}/${path}`,
          reason,
        ]),
      ),
    },
    facts.inventory,
  );
  for (const delivery of subject.deliveries)
    await checkDelivery(snapshot, delivery, byName, tasks, add, subject.deliveries);
  return output.report(maxLayer);
}
