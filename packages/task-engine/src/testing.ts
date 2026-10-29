import {
  type Clock,
  emptyFacts,
  fail,
  type NewEvent,
  reduce,
  type Store,
  type StoreView,
} from "@potential-guide/task-protocol";
import { newId } from "./identity.js";

/** Explicitly non-durable; useful for tests and disposable hosts only. */
export class MemoryStore implements Store {
  private owner: string | undefined;
  private closed = false;
  private view: StoreView = { storeId: newId(), floor: 0, facts: emptyFacts(), events: [] };
  beforeCommit?: () => void;
  claim(owner: string): void {
    if (this.closed || this.owner) fail("store_owned", "Store is closed or already owned.");
    this.owner = owner;
  }
  release(owner: string): void {
    if (this.owner !== owner) fail("store_owned", "Owner mismatch.");
    this.owner = undefined;
  }
  read(): StoreView {
    if (this.closed) fail("storage_failure", "Store closed.");
    return structuredClone(this.view);
  }
  append(owner: string, expectedWatermark: number, events: NewEvent[]): StoreView {
    if (this.owner !== owner || this.closed) fail("store_owned", "Owner mismatch.");
    if (this.view.facts.watermark !== expectedWatermark) fail("storage_conflict", "Stale write.");
    const appended = events.map((event, index) => ({
      ...event,
      sequence: expectedWatermark + index + 1,
    }));
    const facts = reduce(this.view.facts, appended);
    this.beforeCommit?.();
    this.view = { ...this.view, facts, events: [...this.view.events, ...appended] };
    return this.read();
  }
  compact(owner: string, through: number): void {
    if (this.owner !== owner) fail("store_owned", "Owner mismatch.");
    if (Object.keys(this.view.facts.tasks).length || Object.keys(this.view.facts.executions).length)
      fail("protected_history", "Recovery references still protect history.");
    if (through < this.view.floor || through > this.view.facts.watermark)
      fail("invalid_cursor", "Invalid compaction boundary.");
    this.view.events = this.view.events.filter((event) => event.sequence > through);
    this.view.floor = through;
  }
  close(): void {
    if (this.owner) fail("store_owned", "Release Engine before closing Store.");
    this.closed = true;
  }
}

export class VirtualClock implements Clock {
  private elapsed = 0;
  private next = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();
  constructor(private time = 1_800_000_000_000) {}
  now(): number {
    return this.time;
  }
  setTime(time: number): void {
    this.time = time;
  }
  schedule(callback: () => void, delayMs: number): () => void {
    const id = ++this.next;
    this.timers.set(id, { at: this.elapsed + delayMs, callback });
    return () => {
      this.timers.delete(id);
    };
  }
  advance(milliseconds: number): void {
    this.time += milliseconds;
    this.elapsed += milliseconds;
    for (const [id, timer] of [...this.timers]) {
      if (timer.at <= this.elapsed && this.timers.delete(id)) timer.callback();
    }
  }
  get pendingTimers(): number {
    return this.timers.size;
  }
}
