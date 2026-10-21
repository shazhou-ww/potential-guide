import assert from "node:assert/strict";
import { promises as filesystem } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  captureFilesystemObservation,
  type FilesystemObservationUnavailable,
  filesystemObservationRevision,
} from "../src/index.js";

test("expected capture failures report stable reasons while unexpected errors and cancellation propagate", async (t) => {
  await mkdir(resolve(".cache"), { recursive: true });
  const root = await mkdtemp(resolve(".cache", "capture-errors-"));
  try {
    const diagnostics: FilesystemObservationUnavailable[] = [];
    const report = (value: FilesystemObservationUnavailable) => diagnostics.push(value);
    for (const operation of [captureFilesystemObservation, filesystemObservationRevision]) {
      assert.equal(
        await operation(join(root, "missing"), new AbortController().signal, report),
        undefined,
      );
      assert.deepEqual(diagnostics.pop(), { reason: "unreadable", code: "ENOENT" });
    }
    const original = filesystem.readdir;
    const bug = new TypeError("Unexpected collector bug.");
    try {
      t.mock.method(filesystem, "readdir", async () => {
        throw bug;
      });
      syncBuiltinESMExports();
      for (const operation of [captureFilesystemObservation, filesystemObservationRevision])
        await assert.rejects(
          operation(root, new AbortController().signal, report),
          (error) => error === bug,
        );
      assert.deepEqual(diagnostics, []);
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
    let traversals = 0;
    try {
      t.mock.method(
        filesystem,
        "readdir",
        async (...args: Parameters<typeof filesystem.readdir>) => {
          if (++traversals === 2) await writeFile(join(root, "added"), "changed");
          return original(...args);
        },
      );
      syncBuiltinESMExports();
      assert.equal(
        await captureFilesystemObservation(root, new AbortController().signal, report),
        undefined,
      );
      assert.deepEqual(diagnostics.pop(), { reason: "input-changed" });
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
    const controller = new AbortController();
    const cancellation = new Error("cancelled capture");
    controller.abort(cancellation);
    for (const operation of [captureFilesystemObservation, filesystemObservationRevision])
      await assert.rejects(
        operation(root, controller.signal, report),
        (error) => error === cancellation,
      );
    assert.deepEqual(diagnostics, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
