import type { ExecutionSummary, PublicEvent, TaskSnapshot } from "@potential-guide/task-protocol";

export const stages: Record<string, string> = {
  initial: "等待准备",
  preparing: "准备中",
  queued: "等待执行资源",
  running: "执行中",
  completed: "已完成",
  preparation_failed: "准备失败",
  allocation_failed: "分配失败",
  execution_failed: "执行失败",
};
export function taskStatus(task: TaskSnapshot): string {
  const end =
    task.canceledAt ??
    task.execution?.completedAt ??
    task.execution?.failedAt ??
    task.preparation?.failedAt ??
    task.allocation?.failedAt ??
    task.termination?.terminatedAt;
  const timedOut = (end ?? task.timestamp) > task.deadlineAt;
  const status = task.canceledAt ? "已取消" : (stages[task.stage] ?? task.stage);
  return `${status}${timedOut ? " · 已超时" : ""}`;
}
/** Only explicit public terminal/reclamation facts can end a live observation. */
export class ObservationEnd {
  private readonly related = new Set<string>();
  private readonly reclaimed = new Set<string>();
  private readonly terminal = new Set<string>();
  private canceledEvent = false;
  private snapshot: TaskSnapshot | undefined;
  constructor(
    readonly kind: "taskId" | "executionId",
    readonly id: string,
  ) {}
  summary(value: ExecutionSummary): void {
    if (this.kind !== "executionId" || value.executionId !== this.id) return;
    if (value.completedAt || value.failedAt) this.terminal.add(this.id);
    if (value.reclaimedAt) this.reclaimed.add(this.id);
  }
  feed(events: PublicEvent[], snapshot?: TaskSnapshot): void {
    if (snapshot?.taskId === this.id) this.snapshot = snapshot;
    if (this.snapshot?.execution) this.related.add(this.snapshot.execution.executionId);
    for (const event of events) {
      if (event.executionId) {
        if (event.type === "execution.reclaimed") this.reclaimed.add(event.executionId);
        if (event.type === "execution.completed" || event.type === "execution.failed")
          this.terminal.add(event.executionId);
        if (this.kind === "taskId") this.related.add(event.executionId);
      }
      if (event.taskId === this.id && event.type === "task.canceled") {
        this.canceledEvent = true;
        const ids = (event.data as { executionIds?: unknown }).executionIds;
        if (Array.isArray(ids))
          for (const id of ids) if (typeof id === "string") this.related.add(id);
      }
    }
    const execution = this.snapshot?.execution;
    if (execution?.completedAt || execution?.failedAt) this.terminal.add(execution.executionId);
  }
  get ended(): boolean {
    if (this.kind === "executionId")
      return this.terminal.has(this.id) && this.reclaimed.has(this.id);
    const task = this.snapshot;
    if (
      !task ||
      (!task.canceledAt &&
        !["completed", "execution_failed", "preparation_failed", "allocation_failed"].includes(
          task.stage,
        ))
    )
      return false;
    if (task.canceledAt && !this.canceledEvent) return false;
    if (this.related.size)
      return [...this.related].every((id) => this.terminal.has(id) && this.reclaimed.has(id));
    return (
      (!!task.canceledAt && this.canceledEvent) ||
      ["preparation_failed", "allocation_failed"].includes(task.stage)
    );
  }
}
