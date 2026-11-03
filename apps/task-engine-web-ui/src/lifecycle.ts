import type {
  PublicEvent,
  RunSnapshot,
  RunSummary,
  TaskSnapshot,
} from "@potential-guide/task-protocol";
import {
  aggregateTaskStatus,
  type TaskDisplayStatus,
  type TaskStatusInput,
  type TaskStatusQualifier,
} from "@potential-guide/task-protocol/presentation";

const statusLabels: Record<TaskDisplayStatus, string> = {
  pending: "待生效",
  waiting: "等待运行",
  running: "运行中",
  stopping: "正在停止",
  stopped: "已停止",
  completed: "已完成",
  failed: "运行失败",
  canceled: "已取消",
  timedOut: "已超时",
};
const qualifierLabels: Record<TaskStatusQualifier, string> = {
  demandWithdrawn: "需求已撤回",
  runNotEnded: "关联运行尚未结束",
};
export function taskStatus(task: TaskStatusInput, now = Date.now()): string {
  return statusLabels[aggregateTaskStatus(task, now).status];
}
export function taskStatusExplanation(task: TaskStatusInput, now = Date.now()): string {
  return aggregateTaskStatus(task, now)
    .qualifiers.map((qualifier) => qualifierLabels[qualifier])
    .join("；");
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
