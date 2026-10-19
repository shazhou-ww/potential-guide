import type { Contract } from "./contract.js";
import { type Add, type RecordValue, record, taskFor, texts } from "./shared.js";
export function checkTaskGraph(
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
