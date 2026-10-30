import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import {
  assertFactsVersion,
  emptyFacts,
  type FactEvent,
  type Facts,
  fail,
  type NewEvent,
  reduce,
  type Store,
  type StoreView,
  TaskError,
} from "@potential-guide/task-protocol";

export interface SqliteOptions {
  busyTimeoutMs?: number;
  fault?: (point: "beforeCommit" | "afterCommit") => void;
}
function checksum(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function unsupported(): never {
  return fail(
    "unsupported_version",
    "Unsupported Task storage format. Use a new database path; old data is not migrated or deleted.",
  );
}

function inspectFormat(db: DatabaseSync): boolean {
  const version = db.prepare("PRAGMA user_version").get()?.user_version;
  if (version === 0) {
    if (db.prepare("SELECT name FROM sqlite_schema LIMIT 1").get()) unsupported();
    return false;
  }
  if (version !== 2) unsupported();
  const checkpoint = db
    .prepare("SELECT projection_version, payload FROM checkpoint WHERE singleton=1")
    .get();
  if (checkpoint?.projection_version !== 2 || typeof checkpoint.payload !== "string") unsupported();
  assertFactsVersion(JSON.parse(checkpoint.payload) as Facts);
  return true;
}

function preflight(filename: string): void {
  if (!existsSync(filename) || statSync(filename).size === 0) return;
  const descriptor = openSync(filename, "r");
  const header = Buffer.alloc(100);
  let length: number;
  try {
    length = readSync(descriptor, header, 0, header.length, 0);
  } finally {
    closeSync(descriptor);
  }
  if (length >= 64 && header.subarray(0, 16).toString() === "SQLite format 3\0") {
    const version = header.readUInt32BE(60);
    if (version !== 0 && version !== 2) unsupported();
  }
  const wal = `${filename}-wal`;
  if (existsSync(wal) && statSync(wal).size > 0) {
    // Even SQLite's read-only WAL reader writes SHM read marks. Inspect an owned
    // sibling snapshot instead, never recovering/checkpointing the original.
    const snapshot = `${filename}.inspect-${randomUUID()}`;
    const stamp = () =>
      [filename, wal]
        .map((path) => {
          const stat = statSync(path, { bigint: true });
          return `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
        })
        .join("|");
    const before = stamp();
    try {
      copyFileSync(filename, snapshot);
      copyFileSync(wal, `${snapshot}-wal`);
      if (stamp() !== before)
        fail("storage_conflict", "Storage changed during read-only format inspection; retry.");
      const db = new DatabaseSync(snapshot, { readOnly: true });
      try {
        inspectFormat(db);
      } finally {
        db.close();
      }
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) rmSync(`${snapshot}${suffix}`, { force: true });
    }
  } else {
    const uri = pathToFileURL(filename);
    uri.searchParams.set("immutable", "1");
    const db = new DatabaseSync(uri.href, { readOnly: true });
    try {
      inspectFormat(db);
    } finally {
      db.close();
    }
  }
}

export class SqliteStore implements Store {
  private readonly db: DatabaseSync;
  private lock: DatabaseSync | undefined;
  private owner: string | undefined;
  private closed = false;
  private readonly filename: string;
  constructor(
    filename: string,
    private readonly options: SqliteOptions = {},
  ) {
    if (
      !filename ||
      filename === ":memory:" ||
      filename.startsWith("file:") ||
      filename.startsWith("\\\\")
    )
      fail("storage_failure", "SQLite Store requires an explicit local file.");
    const timeout = options.busyTimeoutMs ?? 100;
    if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 5_000)
      fail("invalid_request", "SQLite busy timeout must be between 0 and 5000 ms.");
    this.filename = resolve(filename);
    preflight(this.filename);
    this.db = new DatabaseSync(this.filename);
    this.filename = realpathSync.native(this.filename);
    try {
      const initialized = inspectFormat(this.db);
      this.db.exec(
        `PRAGMA busy_timeout=${timeout}; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;`,
      );
      if (initialized) return;
      this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS metadata (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1),
          store_id TEXT NOT NULL, floor INTEGER NOT NULL, watermark INTEGER NOT NULL,
          owner_path TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
          sequence INTEGER PRIMARY KEY, payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS requests (
          request_id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS successors (
          predecessor TEXT PRIMARY KEY REFERENCES requests(task_id),
          successor TEXT NOT NULL REFERENCES requests(task_id),
          request_id TEXT NOT NULL REFERENCES requests(request_id)
        );
        CREATE TABLE IF NOT EXISTS checkpoint (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1),
          watermark INTEGER NOT NULL, projection_version INTEGER NOT NULL,
          payload TEXT NOT NULL, checksum TEXT NOT NULL
        );
        PRAGMA user_version=2;
        COMMIT;
      `);
      this.db
        .prepare("INSERT OR IGNORE INTO metadata VALUES (1, ?, 0, 0, ?)")
        .run(randomUUID(), `${this.filename}.owner`);
      const initial = JSON.stringify(emptyFacts());
      this.db
        .prepare("INSERT OR IGNORE INTO checkpoint VALUES (1, 0, 2, ?, ?)")
        .run(initial, checksum(initial));
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  claim(owner: string): void {
    if (this.closed || this.owner) fail("store_owned", "Store is closed or already owned.");
    const ownerPath = this.db
      .prepare("SELECT owner_path FROM metadata WHERE singleton=1")
      .get()?.owner_path;
    if (typeof ownerPath !== "string")
      fail("storage_corrupt", "Missing stable owner lock location.");
    const lock = new DatabaseSync(ownerPath);
    try {
      lock.exec("PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE;");
      this.lock = lock;
      this.owner = owner;
    } catch {
      lock.close();
      fail("store_owned", "Another active Engine owns this SQLite file.");
    }
  }
  private owned(owner: string): void {
    if (this.closed || this.owner !== owner) fail("store_owned", "Store owner mismatch.");
  }
  release(owner: string): void {
    this.owned(owner);
    this.lock?.exec("ROLLBACK");
    this.lock?.close();
    this.lock = undefined;
    this.owner = undefined;
  }
  private readInside(): StoreView {
    const metadata = this.db
      .prepare("SELECT store_id, floor, watermark FROM metadata WHERE singleton=1")
      .get();
    const checkpoint = this.db
      .prepare(
        "SELECT watermark, projection_version, payload, checksum FROM checkpoint WHERE singleton=1",
      )
      .get();
    if (
      !metadata ||
      !checkpoint ||
      checkpoint.projection_version !== 2 ||
      typeof checkpoint.payload !== "string" ||
      checksum(checkpoint.payload) !== checkpoint.checksum
    )
      fail("storage_corrupt", "Invalid durable checkpoint.");
    let facts: Facts;
    let events: FactEvent[];
    try {
      facts = JSON.parse(checkpoint.payload) as Facts;
      assertFactsVersion(facts);
      events = this.db
        .prepare("SELECT sequence, payload FROM events ORDER BY sequence")
        .all()
        .map((row) => {
          const event = JSON.parse(String(row.payload)) as FactEvent;
          if (event.sequence !== row.sequence) fail("storage_corrupt", "Event sequence mismatch.");
          return event;
        });
    } catch (error) {
      if (error instanceof TaskError) throw error;
      fail("storage_corrupt", "Cannot decode persisted facts.");
    }
    if (facts.watermark !== checkpoint.watermark)
      fail("storage_corrupt", "Checkpoint boundary mismatch.");
    facts = reduce(
      facts,
      events.filter((event) => event.sequence > facts.watermark),
    );
    if (facts.watermark !== metadata.watermark)
      fail("storage_corrupt", "Missing committed event suffix.");
    return { storeId: String(metadata.store_id), floor: Number(metadata.floor), facts, events };
  }
  read(): StoreView {
    if (this.closed) fail("storage_failure", "Store closed.");
    this.db.exec("BEGIN");
    try {
      const view = this.readInside();
      this.db.exec("COMMIT");
      return view;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  append(owner: string, expectedWatermark: number, events: NewEvent[]): StoreView {
    this.owned(owner);
    this.db.exec("BEGIN IMMEDIATE");
    let committed = false;
    try {
      const view = this.readInside();
      if (view.facts.watermark !== expectedWatermark)
        fail("storage_conflict", "Stale event watermark.");
      const appended = events.map((event, index) => ({
        ...event,
        sequence: expectedWatermark + index + 1,
      }));
      const facts = reduce(view.facts, appended);
      const insert = this.db.prepare("INSERT INTO events(sequence,payload) VALUES (?, ?)");
      for (const event of appended) {
        insert.run(event.sequence, JSON.stringify(event));
        if (event.type === "task.created")
          this.db
            .prepare("INSERT INTO requests(request_id,task_id) VALUES (?, ?)")
            .run(event.data.task.request.requestId, event.data.task.snapshot.taskId);
        if (event.type === "task.successor")
          this.db
            .prepare("INSERT INTO successors(predecessor,successor,request_id) VALUES (?, ?, ?)")
            .run(event.taskId ?? "", event.data.taskId, event.data.requestId);
        if (event.type === "records.forgotten") {
          for (const id of event.data.taskIds)
            this.db
              .prepare("DELETE FROM successors WHERE predecessor=? OR successor=?")
              .run(id, id);
          for (const id of event.data.taskIds)
            this.db.prepare("DELETE FROM requests WHERE task_id=?").run(id);
        }
      }
      const payload = JSON.stringify(facts);
      this.db
        .prepare("UPDATE checkpoint SET watermark=?,payload=?,checksum=? WHERE singleton=1")
        .run(facts.watermark, payload, checksum(payload));
      this.db.prepare("UPDATE metadata SET watermark=? WHERE singleton=1").run(facts.watermark);
      this.options.fault?.("beforeCommit");
      this.db.exec("COMMIT");
      committed = true;
      this.options.fault?.("afterCommit");
      return { ...view, facts, events: [...view.events, ...appended] };
    } catch (error) {
      if (!committed) this.db.exec("ROLLBACK");
      throw error;
    }
  }
  compact(owner: string, through: number): void {
    this.owned(owner);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const view = this.readInside();
      if (Object.keys(view.facts.tasks).length || Object.keys(view.facts.executions).length)
        fail("protected_history", "Recovery references still protect history.");
      if (through < view.floor || through > view.facts.watermark)
        fail("invalid_cursor", "Invalid history compaction boundary.");
      this.db.prepare("DELETE FROM events WHERE sequence<=?").run(through);
      this.db.prepare("UPDATE metadata SET floor=? WHERE singleton=1").run(through);
      this.db.exec("COMMIT");
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close(): void {
    if (this.closed) return;
    if (this.owner) fail("store_owned", "Close Engine before Store.");
    this.db.close();
    this.closed = true;
  }
}

export function openSqliteStore(filename: string, options?: SqliteOptions): SqliteStore {
  return new SqliteStore(filename, options);
}
