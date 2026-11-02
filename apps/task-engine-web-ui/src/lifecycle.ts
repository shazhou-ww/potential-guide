import type {
  PublicEvent,
  RunSnapshot,
  RunSummary,
  TaskSnapshot,
} from "@potential-guide/task-protocol";

export const stages: Record<string, string> = {
  initial: "等待符合条件的 Run",
  running: "Run 尝试中",
  stopping: "正在停止",
  stopped: "已停止",
  completed: "已完成",
  failed: "Run 失败",
};
export function taskStatus(task: TaskSnapshot, now = Date.now()): string {
  const time =
    now < Date.parse(task.eligibleAt)
      ? "pending"
      : now > Date.parse(task.deadlineAt)
        ? "timeout"
        : "eligible";
  const terminal = ["completed", "failed", "stopped"].includes(task.stage);
  const label = terminal
    ? stages[task.stage]
    : task.canceled
      ? "已取消"
      : time === "timeout"
        ? "已超时"
        : time === "pending"
          ? "等待资格时间"
          : stages[task.stage];
  return `${label} · stage ${task.stage} · ${task.canceled ? "已取消" : "未取消"} · 时间 ${time}`;
}
export class ObservationEnd {
  private readonly reclaimed = new Set<string>();
  private readonly terminal = new Set<string>();
  private snapshot: TaskSnapshot | undefined;
  constructor(
    readonly kind: "taskId" | "runId",
    readonly id: string,
  ) {}
  summary(value: RunSummary): void {
    if (this.kind !== "runId" || value.runId !== this.id) return;
    if (["completed", "failed", "stopped"].includes(value.stage)) this.terminal.add(this.id);
    if (value.reclaimedAt) this.reclaimed.add(this.id);
  }
  run(value: RunSnapshot): void {
    if (value.runId !== this.id || this.kind !== "runId") return;
    if (["completed", "failed", "stopped"].includes(value.stage)) this.terminal.add(this.id);
    if (value.reclaimedAt) this.reclaimed.add(this.id);
  }
  feed(events: PublicEvent[], snapshot?: TaskSnapshot): void {
    if (snapshot?.taskId === this.id) this.snapshot = snapshot;
    for (const event of events)
      if (event.runId === this.id) {
        if (event.type === "run.reclaimed") this.reclaimed.add(this.id);
        if (event.type === "run.exited") this.terminal.add(this.id);
      }
  }
  get ended(): boolean {
    if (this.kind === "runId") return this.terminal.has(this.id) && this.reclaimed.has(this.id);
    // A matched Task can still be canceled after its Run ends; its stream must not freeze on cancellation.
    return !!this.snapshot?.canceled && !this.snapshot.run;
  }
}
