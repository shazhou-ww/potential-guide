import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { HostError, readArtifactTree } from "@potential-guide/check-runtime-files";
import { readArtifactFiles } from "../src/files.js";

test("Check file facades retain HostError status and legacy portable-path diagnostics", async (t) => {
  const directory = resolve(".cache", "check-files", randomUUID());
  await mkdir(join(directory, "empty"), { recursive: true });
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(readArtifactFiles(directory), {
    message: "Check artifact contains an undeclared empty directory.",
  });
  await writeFile(join(directory, "empty", "data"), "value");
  await assert.rejects(
    readArtifactFiles(directory, { fileBytes: 1 }),
    (error: unknown) => error instanceof HostError && error.status === 413,
  );
  await assert.rejects(
    readArtifactTree("relative"),
    (error: unknown) => error instanceof HostError && error.status === 400,
  );
});
