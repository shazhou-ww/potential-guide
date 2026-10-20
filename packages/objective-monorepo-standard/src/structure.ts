import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type CheckProbe,
  type CheckProblem,
  canonicalObjectiveUri,
  createSourceObjectiveDependencyProbe,
  type ObjectiveDependencySource,
  parseCheckEnvelope,
  parseObjectives,
  projectObjective,
  type Subject,
} from "@potential-guide/objective-pilot";
import type { Contract } from "./contract.js";
import { checkDelivery } from "./delivery.js";
import { checkDeliveryMappings, checkUnmappedDeploymentFiles } from "./delivery-mapping.js";
import { checkDependencyCycles } from "./dependency-graph.js";
import { checkFileAssignments, checkFileClassification } from "./file-placement.js";
import { applicableTasks, workspaceMetadata } from "./package-standard.js";
import { recorder } from "./report.js";
import { checkRepositoryConfiguration } from "./repository-configuration.js";
import { observeRepository } from "./repository-observation.js";
import { checkRequiredFiles } from "./required-files.js";
import { dependencyGroups, type RecordValue, type Report, Snapshot } from "./shared.js";
import {
  type PackageSubject,
  packageContext,
  parsePackageSubject,
  parseRepositorySubject,
} from "./subjects.js";
import { checkTaskGraph } from "./task-graph.js";
import { checkWorkspacePlacement } from "./workspace-layout.js";
import { checkWorkspaceIdentities, checkWorkspaceMapping } from "./workspace-mapping.js";

export type DependencyProbeFactory = (source: ObjectiveDependencySource) => CheckProbe;
export interface RepositoryReport {
  report: Report;
  problems: CheckProblem[];
}
export async function checkRepository(
  value: unknown,
  maxLayer: 1 | 2 = 2,
  dependencyProbe: DependencyProbeFactory = createSourceObjectiveDependencyProbe,
  signal: AbortSignal = new AbortController().signal,
): Promise<RepositoryReport> {
  const subject = parseRepositorySubject(value);
  const snapshot = new Snapshot(await realpath(subject.context.repo.rootPath));
  const output = recorder();
  const { add } = output;
  const facts = await observeRepository(snapshot);
  const model: Contract = {
    schemaVersion: 1,
    policy: subject.policy,
    workspaces: [],
    deliveries: [...subject.deliveries],
  };
  const bindings: { objectiveId: string; subject: PackageSubject; wire: Subject; name: string }[] =
    [];
  let tasks: RecordValue = { ...facts.tasks };
  for (const actual of facts.packages) {
    const file = `${actual.directory}/objectives.yaml`;
    try {
      const entry = parseObjectives(await snapshot.text(file)).standardize;
      if (!entry) throw new Error("Missing standardize Objective.");
      const wire = projectObjective(entry, packageContext(subject, actual.directory), undefined);
      const own = parsePackageSubject(wire);
      if (resolve(own.root) !== snapshot.root || own.directory !== actual.directory)
        throw new Error("Package standardize must bind its discovered directory in this checkout.");
      const objectiveId = canonicalObjectiveUri(entry.objective);
      const name = String(actual.manifest.name);
      bindings.push({ objectiveId, subject: own, wire, name });
      model.workspaces.push(workspaceMetadata(own, actual.manifest, facts.inventory, tasks));
      model.deliveries.push(...own.deliveries);
    } catch (error) {
      add(
        1,
        "fail",
        "package-objective",
        file,
        error instanceof Error ? error.message : String(error),
        "Repair the directory standardize declaration and its explicit Unit binding; source invocation failures are not declaration failures.",
      );
    }
  }
  checkRepositoryConfiguration(facts, model, add);
  const byName = new Map(model.workspaces.map((workspace) => [workspace.name, workspace]));
  checkWorkspaceIdentities(model, "objectives.yaml", byName, add);
  await checkRequiredFiles(snapshot, model, add);
  checkUnmappedDeploymentFiles(model, facts.inventory, add);
  for (const workspace of model.workspaces) {
    checkWorkspaceMapping(workspace, model, "objectives.yaml", byName, facts.manifests, add);
    checkWorkspacePlacement(model, workspace, add);
  }
  for (const binding of bindings) {
    for (const intent of binding.subject.joins)
      if (
        !subject.deliveries.some(
          (delivery) =>
            delivery.id === intent.id &&
            delivery.kind === intent.kind &&
            delivery.packages.includes(binding.name),
        )
      )
        add(
          1,
          "fail",
          "joint-delivery-intent",
          `${binding.subject.directory}/objectives.yaml`,
          `Joint delivery ${intent.id}/${intent.kind} does not include ${binding.name}.`,
          "Align the package intent and repository joint delivery.",
        );
    for (const delivery of subject.deliveries.filter((delivery) =>
      delivery.packages.includes(binding.name),
    ))
      if (
        !binding.subject.joins.some(
          (intent) => intent.id === delivery.id && intent.kind === delivery.kind,
        )
      )
        add(
          1,
          "fail",
          "joint-delivery-membership",
          "objectives.yaml",
          `${binding.name} has not declared participation in ${delivery.id}.`,
          "Declare the package-owned joint delivery intent.",
        );
  }
  await checkDeliveryMappings(snapshot, model, "objectives.yaml", byName, facts.manifests, add);
  checkFileAssignments(model, "objectives.yaml", facts.inventory, byName, add);
  checkFileClassification(model, "objectives.yaml", facts.inventory, add);
  const problems: CheckProblem[] = [];
  if (!output.blocked()) {
    for (const binding of bindings) {
      signal.throwIfAborted();
      const envelope = parseCheckEnvelope(
        await dependencyProbe({
          objectiveId: binding.objectiveId,
          expectedLevelId: maxLayer === 1 ? "structured" : "terminal",
        })(binding.wire, signal),
      );
      if (envelope.status !== 200 || envelope.payload === null)
        throw new Error(
          `Package Objective invocation failed (${binding.name}): ${envelope.message}`,
        );
      problems.push(...envelope.payload.problems);
    }
    if (problems.length === 0 && maxLayer === 2) {
      for (const binding of bindings) {
        tasks = await applicableTasks(snapshot, binding.subject.directory, binding.name, tasks);
        const workspace = byName.get(binding.name);
        const manifest = facts.manifests.get(binding.name);
        if (workspace && manifest)
          workspace.tasks = workspaceMetadata(
            binding.subject,
            manifest,
            facts.inventory,
            tasks,
          ).tasks;
      }
      const edges = new Map(
        model.workspaces.map((workspace) => [
          workspace.name,
          dependencyGroups(facts.manifests.get(workspace.name) ?? {})
            .filter(({ name }) => byName.has(name))
            .map(({ name }) => name),
        ]),
      );
      checkDependencyCycles(model, byName, edges, add);
      checkTaskGraph(model, facts.manifests, tasks, edges, add);
      for (const workspace of model.workspaces) {
        for (const dependency of dependencyGroups(facts.manifests.get(workspace.name) ?? {})) {
          const target = byName.get(dependency.name);
          if (
            target &&
            dependency.kind !== "devDependencies" &&
            ["browser", "worker"].includes(workspace.runtime) &&
            target.runtime !== workspace.runtime &&
            target.runtime !== "universal"
          )
            add(
              2,
              "fail",
              "runtime-boundary",
              workspace.path,
              `${workspace.runtime} consumes ${target.runtime} package ${target.name}.`,
              "Use a runtime-compatible public boundary.",
              [workspace.name, target.name],
            );
        }
      }
      for (const delivery of subject.deliveries)
        await checkDelivery(snapshot, delivery, byName, tasks, add, model.deliveries);
    }
  }
  const report = output.report(maxLayer);
  if (report.state !== "pass")
    problems.unshift({
      kind: "internal",
      id: maxLayer === 1 ? "structure-incomplete" : "delivery-incomplete",
      parameters: {
        report: { ...report, findings: report.findings.map((finding) => ({ ...finding })) },
      },
    });
  if (problems.some(({ kind }) => kind === "dependency")) {
    report.state = "fail";
    if (maxLayer === 2) report.layer2 = "blocked";
  }
  return { report, problems };
}
