import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs, { mkdir, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";
import { taskSchemaUri } from "@potential-guide/task-protocol";
import type { BuildFailure } from "esbuild";
import { compileTaskBundle } from "../src/build.js";

test("binding candidate manifests ignore only absence and propagate I/O and JSON failures", async (t) => {
  const directory = resolve(".test-binding-manifest", randomUUID());
  const foreign = join(directory, "foreign");
  const manifest = join(foreign, "package.json");
  await mkdir(join(foreign, "dist"), { recursive: true });
  try {
    await writeFile(manifest, '{"name":"unrelated-fixture","type":"module"}');
    await writeFile(join(foreign, "dist", "binding.js"), "export const marker = 1;");
    const entry = join(directory, "main.ts");
    await writeFile(
      entry,
      'import {marker} from "./foreign/dist/binding.js"; console.log(marker);',
    );
    const options = {
      entry,
      entryMode: "explicit" as const,
      outDirectory: join(directory, "bundle"),
      declaration: {
        $schema: taskSchemaUri,
        name: "Manifest probe",
        runtime: { type: "node", minVersion: "22.13.0" },
        entry: "worker.cjs",
        inputSchema: { type: "object" },
        resultSchema: true,
        messageSchema: false,
      },
    };
    await t.test("ordinary non-SDK package is not replaced", async () => {
      assert.ok((await compileTaskBundle(options)).contents.get("worker.cjs"));
    });
    for (const code of ["ENOENT", "ENOTDIR", "EACCES", "EIO"])
      await t.test(code, async (t) => {
        const failure = Object.assign(new Error(`manifest probe ${code}`), { code });
        const original = fs.readFile;
        const mocked = t.mock.method(fs, "readFile", (async (...args) => {
          if (args[0] === manifest) throw failure;
          return original(...args);
        }) as typeof fs.readFile);
        syncBuiltinESMExports();
        try {
          if (code === "ENOENT" || code === "ENOTDIR")
            await assert.doesNotReject(compileTaskBundle(options));
          else
            await assert.rejects(compileTaskBundle(options), (error: BuildFailure) => {
              assert.ok(error.errors.some((entry) => entry.detail === failure));
              return true;
            });
        } finally {
          mocked.mock.restore();
          syncBuiltinESMExports();
        }
      });
    for (const source of ["", "{", "null", "[]", "42"])
      await t.test(`invalid manifest ${JSON.stringify(source)}`, async (t) => {
        const original = fs.readFile;
        const mocked = t.mock.method(fs, "readFile", (async (...args) => {
          if (args[0] === manifest) return source;
          return original(...args);
        }) as typeof fs.readFile);
        syncBuiltinESMExports();
        try {
          await assert.rejects(compileTaskBundle(options), /JSON|must contain an object/);
        } finally {
          mocked.mock.restore();
          syncBuiltinESMExports();
        }
      });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
