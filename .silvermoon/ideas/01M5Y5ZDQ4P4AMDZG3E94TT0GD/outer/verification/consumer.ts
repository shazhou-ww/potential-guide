import {
  type BehaviorCoordinator,
  CoordinatorModel as M,
  RequestModel as R,
} from "@potential-guide/regulation-coordinator";

export function intent(objective: R.RequestCommand["objective"]): R.RequestCommand {
  return {
    type: "request",
    requestRef: "external-consumer",
    objective,
    subject: {},
    desiredLevel: "terminal",
    priority: 1,
    origin: { kind: "external" },
    eligibleAt: "2026-10-27T00:00:00Z",
    recurrence: { intervalMs: 3000 },
  };
}

export async function inspectAndStop(service: BehaviorCoordinator, requestRef: string) {
  const events: readonly M.CoordinatorEvent[] = service.eventsSince(0);
  const exhausted = M.exhaustionEvents(service.snapshot());
  const status = M.requestSchedule(service.snapshot(), requestRef, new Date().toISOString());
  const limits: M.ExecutionLimits | undefined = exhausted[0]?.run.limits;
  await service.cancel(requestRef, "recurrence");
  return { events, exhausted, status, limits };
}
