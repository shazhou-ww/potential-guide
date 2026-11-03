export interface ErrorEntry {
  id: number;
  source: string;
  label: string;
  message: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
  resolved: boolean;
}

export class ErrorLog {
  entries: ErrorEntry[] = [];
  private sequence = 0;
  private readonly states = new Map<string, string>();

  record(source: string, message: string, label = source): void {
    this.states.set(source, message);
    const now = new Date().toISOString();
    const entry = this.entries.find((item) => item.source === source && item.message === message);
    if (entry) {
      entry.count++;
      entry.lastSeen = now;
      entry.resolved = false;
    } else {
      this.entries.unshift({
        id: ++this.sequence,
        source,
        label,
        message,
        firstSeen: now,
        lastSeen: now,
        count: 1,
        resolved: false,
      });
      this.entries = this.entries.slice(0, 100);
    }
  }

  observe(source: string, message: string, label = source): void {
    const previous = this.states.get(source) ?? "";
    if (previous === message) return;
    this.states.set(source, message);
    for (const entry of this.entries)
      if (entry.source === source && entry.message === previous) entry.resolved = true;
    if (message) this.record(source, message, label);
  }

  clear(id?: number): void {
    this.entries = id === undefined ? [] : this.entries.filter((entry) => entry.id !== id);
  }
}
