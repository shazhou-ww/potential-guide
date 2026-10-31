import type { RunSummary, PublicEvent, TaskSnapshot } from "@potential-guide/task-protocol";

export const stages: Record<string, string> = {
  initial: "等待符合条件的 Run",
  running: "Run 尝试中",
  completed: "已完成",
  run_failed: "Run 失败",
};
export function taskStatus(task: TaskSnapshot): string {
  const end =
    task.canceledAt ??
    task.run?.completedAt ??
    task.run?.failedAt ??
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
    readonly kind: "taskId" | "runId",
    readonly id: string,
  ) {}
  summary(value: RunSummary): void {
    if (this.kind !== "runId" || value.runId !== this.id) return;
    if (value.completedAt || value.failedAt) this.terminal.add(this.id);
    if (value.reclaimedAt) this.reclaimed.add(this.id);
  }
  feed(events: PublicEvent[], snapshot?: TaskSnapshot): void {
    if (snapshot?.taskId === this.id) this.snapshot = snapshot;
    if (this.snapshot?.run) this.related.add(this.snapshot.run.runId);
    for (const event of events) {
      if (event.runId) {
        if (event.type === "run.reclaimed") this.reclaimed.add(event.runId);
        if (event.type === "run.completed" || event.type === "run.failed")
          this.terminal.add(event.runId);
        if (this.kind === "taskId") this.related.add(event.runId);
      }
      if (event.taskId === this.id && event.type === "task.canceled") {
        this.canceledEvent = true;
        const ids = (event.data as { runIds?: unknown }).runIds;
        if (Array.isArray(ids))
          for (const id of ids) if (typeof id === "string") this.related.add(id);
      }
    }
    const run = this.snapshot?.run;
    if (run?.completedAt || run?.failedAt) this.terminal.add(run.runId);
  }
  get ended(): boolean {
    if (this.kind === "runId") return this.terminal.has(this.id) && this.reclaimed.has(this.id);
    const task = this.snapshot;
    if (!task || (!task.canceledAt && !["completed", "run_failed"].includes(task.stage)))
      return false;
    if (task.canceledAt && !this.canceledEvent) return false;
    if (this.related.size)
      return [...this.related].every((id) => this.terminal.has(id) && this.reclaimed.has(id));
    return (!!task.canceledAt && this.canceledEvent) || task.stage === "run_failed";
  }
}
