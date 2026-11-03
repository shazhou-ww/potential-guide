import type {
  RunLogEntry,
  RunLogPage,
  RunLogState,
  RunLogLimits,
} from "@potential-guide/task-protocol";

export class RunLogWindow {
  entries: RunLogEntry[] = [];
  state: RunLogState | undefined;
  limits: Readonly<RunLogLimits> | undefined;
  sequence = 0;
  hasMore = false;
  gap = false;
  trimmed = false;
  constructor(
    readonly runId: string,
    readonly maxEntries = 300,
    readonly maxBytes = 1_048_576,
  ) {}
  accept(page: RunLogPage, replace = false): void {
    if (page.runId !== this.runId || page.entries.some((entry) => entry.runId !== this.runId))
      throw new Error("日志响应属于其他 Run；已拒绝混入。");
    if (replace) {
      this.entries = [];
      this.sequence = 0;
      this.gap = false;
      this.trimmed = false;
    }
    let last = replace ? 0 : this.sequence;
    for (const entry of page.entries) {
      if (!Number.isSafeInteger(entry.sequence) || entry.sequence < 1)
        throw new Error("日志序号无效。");
      if (entry.sequence <= last) continue;
      if (last && entry.sequence !== last + 1) this.gap = true;
      this.entries.push(entry);
      last = entry.sequence;
    }
    this.sequence = Math.max(last, page.nextSequence);
    this.gap ||= page.gap;
    this.hasMore = page.hasMore;
    this.state = page.state;
    this.limits = page.limits;
    const size = (entry: RunLogEntry) => new TextEncoder().encode(JSON.stringify(entry)).byteLength;
    let bytes = this.entries.reduce((sum, entry) => sum + size(entry), 0);
    while (this.entries.length > this.maxEntries || bytes > this.maxBytes) {
      bytes -= size(this.entries.shift()!);
      this.trimmed = true;
    }
  }
}
export async function consumeRunLogSse(
  response: Response,
  receive: (page: RunLogPage) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("日志实时流不可用。");
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end === -1) break;
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (frame.length > 2_097_152) throw new Error("日志帧超过 2 MiB 上限。");
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const value = JSON.parse(data) as RunLogPage & {
          error?: { code: string; message: string };
        };
        if (value.error) throw new Error(`${value.error.code}: ${value.error.message}`);
        if (
          !Array.isArray(value.entries) ||
          !value.state ||
          !Number.isSafeInteger(value.nextSequence)
        )
          throw new Error("日志实时协议不兼容。");
        receive(value);
      }
      if (buffer.length > 2_097_152) throw new Error("日志帧超过 2 MiB 上限。");
    }
    if (buffer.trim()) throw new Error("日志帧不完整；请从最后确认序号重新连接。");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
