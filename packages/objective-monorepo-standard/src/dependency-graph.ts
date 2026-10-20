import type { Contract, Workspace } from "./contract.js";
import type { Add } from "./shared.js";

export function checkDependencyCycles(
  contract: Contract,
  byName: Map<string, Workspace>,
  edges: Map<string, string[]>,
  add: Add,
) {
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
}
