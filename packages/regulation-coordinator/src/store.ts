import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson } from "@potential-guide/objective-portfolio-supervisor";
import { type CoordinatorState, restoreCoordinatorState } from "./state.js";

export interface CoordinatorStore {
  readonly load: () => Promise<CoordinatorState | null>;
  readonly save: (state: CoordinatorState) => Promise<void>;
  readonly close: () => Promise<void>;
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** The directory is the explicit local profile conflict space, not a Host-specific lock path. */
export async function openCoordinatorStore(directory: string): Promise<CoordinatorStore> {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (!(await lstat(root)).isDirectory())
    throw new TypeError("Coordinator profile must be a directory.");
  const lockPath = join(root, "coordinator-lock.sqlite");
  const lockFile = await open(lockPath, "a", 0o600);
  await lockFile.close();
  if (!(await lstat(lockPath)).isFile())
    throw new TypeError("Coordinator lock must be a regular file.");
  const { DatabaseSync } = await import("node:sqlite");
  const guard = new DatabaseSync(lockPath);
  try {
    guard.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    guard.close();
    throw new Error("Coordinator profile is already in use or cannot be locked.", { cause: error });
  }
  let closed = false;
  const snapshotPath = join(root, "coordinator-state.json");
  const markerPath = join(root, "coordinator-initialized");
  const requireOpen = () => {
    if (closed) throw new Error("Coordinator store is closed.");
  };
  return {
    async load() {
      requireOpen();
      let text: string;
      try {
        if (!(await lstat(snapshotPath)).isFile())
          throw new TypeError("Snapshot must be a regular file.");
        text = await readFile(snapshotPath, "utf8");
      } catch (error) {
        if (missing(error)) {
          try {
            await lstat(markerPath);
          } catch (markerError) {
            if (missing(markerError)) return null;
            throw markerError;
          }
          throw new Error("Previously initialized Coordinator snapshot is missing.");
        }
        throw error;
      }
      return restoreCoordinatorState(JSON.parse(text));
    },
    async save(state) {
      requireOpen();
      const encoded = canonicalJson(state);
      const marker = await open(markerPath, "a", 0o600);
      try {
        await marker.sync();
      } finally {
        await marker.close();
      }
      const temporary = join(root, `coordinator-state-${randomUUID()}.tmp`);
      const file = await open(temporary, "wx", 0o600);
      let installed = false;
      try {
        await file.writeFile(encoded, "utf8");
        await file.sync();
        await file.close();
        await rename(temporary, snapshotPath);
        installed = true;
      } finally {
        await file.close();
        if (!installed) await unlink(temporary);
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        guard.exec("ROLLBACK");
      } finally {
        guard.close();
      }
    },
  };
}
