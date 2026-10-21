import { Stream, SubscriptionRef } from "@potential-guide/effects";
import {
  type AgentResource,
  type CoordinatorCommand,
  type CoordinatorFeedback,
  type CoordinatorOptions,
  type ExecutionContext,
  regulationCoordinator,
} from "@potential-guide/regulation-coordinator";
import type { PriorityQueueSnapshot } from "@potential-guide/objective-portfolio-supervisor";

export function api(
  resources: SubscriptionRef.SubscriptionRef<readonly AgentResource[]>,
  commands: Stream.Stream<CoordinatorCommand>,
  options: CoordinatorOptions,
) {
  // @ts-expect-error Commands cannot replace the resource Behavior.
  regulationCoordinator(commands, commands, options);
  const { budget, ...withoutBudget } = options;
  void budget;
  // @ts-expect-error Trusted lifetime budget is mandatory.
  regulationCoordinator(resources, commands, withoutBudget);
  // @ts-expect-error Business commands cannot grant authority.
  const invalid: CoordinatorCommand = { type: "retry", commandId: "x", id: "root", generation: 1, permissions: {} };
  void invalid;
  return regulationCoordinator(resources, commands, options);
}

export const report = (execution: ExecutionContext, feedback: CoordinatorFeedback) =>
  execution.report(feedback);
export const legacyQueue = (queue: PriorityQueueSnapshot) => queue.demands;
