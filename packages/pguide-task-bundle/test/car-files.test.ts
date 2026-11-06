import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fs, {
  link,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { encodeContentCar } from "../src/car.js";
import { taskBundleLimits as artifactLimits, taskSchemaUri } from "@potential-guide/task-protocol";
import { checkTaskArtifact, readTaskArtifact } from "../src/artifact.js";

async function fixture(t: TestContext) {
  const root = resolve(".cache", `car-file-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const encoded = await encodeContentCar(
    new Map([
      [
        "task.yaml",
        Buffer.from(
          JSON.stringify({
            $schema: taskSchemaUri,
            name: "CAR file safety",
            runtime: { type: "node", minVersion: "22.13.0" },
            entry: "worker.cjs",
            binary: [],
            include: ["task.yaml", "worker.cjs"],
            inputSchema: { type: "object" },
            resultSchema: false,
            messageSchema: false,
          }),
        ),
      ],
      ["worker.cjs", Buffer.from("module.exports = {};\n")],
    ]),
  );
  const file = join(root, "bundle.car");
  await writeFile(file, encoded.bytes, { flag: "wx" });
  return { root, file, ...encoded };
}

test("CAR input accepts a stable unlinked regular file without changing its bytes", async (t) => {
  const source = await fixture(t);
  assert.equal((await checkTaskArtifact(source.file)).cid, source.cid);
  assert.deepEqual(await readFile(source.file), Buffer.from(source.bytes));
});

test("CAR input rejects hard links on both the original and alias paths", async (t) => {
  const source = await fixture(t);
  const alias = join(source.root, "alias.car");
  await link(source.file, alias);
  for (const file of [source.file, alias])
    await assert.rejects(readTaskArtifact(file), /hard links/);
  assert.deepEqual(await readFile(source.file), Buffer.from(source.bytes));
});

test("CAR input rejects symbolic links without reading their target", async (t) => {
  const source = await fixture(t);
  const alias = join(source.root, "alias.car");
  await symlink(source.file, alias, "file");
  await assert.rejects(readTaskArtifact(alias), /without links/);
});

test("CAR input rejects an oversized sparse regular file before opening it", async (t) => {
  const source = await fixture(t);
  const handle = await open(source.file, "r+");
  await handle.truncate(artifactLimits.archiveBytes + 1);
  await handle.close();
  let opened = false;
  const original = fs.open;
  t.mock.method(fs, "open", async (...args: Parameters<typeof original>) => {
    opened = true;
    return original(...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(readTaskArtifact(source.file), /exceeds artifact capacity/);
    assert.equal(opened, false);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("CAR input rejects a different file opened after the initial path check", async (t) => {
  const source = await fixture(t);
  const original = fs.open;
  t.mock.method(fs, "open", async (...args: Parameters<typeof original>) => {
    if (args[0] === source.file) {
      await rename(source.file, join(source.root, "previous.car"));
      await writeFile(source.file, source.bytes, { flag: "wx" });
    }
    return original(...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(readTaskArtifact(source.file), /changed while reading/);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

async function duringRead(t: TestContext, file: string, mutate: () => Promise<void>) {
  const original = fs.open;
  let mutated = false;
  t.mock.method(fs, "open", async (...args: Parameters<typeof original>) => {
    if (args[0] === file) assert.equal(args[1], constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const handle = await original(...args);
    const read = handle.read.bind(handle);
    Object.defineProperty(handle, "read", {
      value: async (buffer: Buffer) => {
        const result = await read(buffer);
        if (!mutated && result.bytesRead > 0) {
          mutated = true;
          await mutate();
        }
        return result;
      },
    });
    return handle;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(readTaskArtifact(file), /changed while reading/);
    assert.equal(mutated, true);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
}

test("CAR input rejects a path replaced after opening even when replacement bytes match", async (t) => {
  const source = await fixture(t);
  await duringRead(t, source.file, async () => {
    await rename(source.file, join(source.root, "previous.car"));
    await writeFile(source.file, source.bytes, { flag: "wx" });
  });
});

test("CAR input rejects same-length modification of the open file", async (t) => {
  const source = await fixture(t);
  await duringRead(t, source.file, async () => {
    await writeFile(source.file, source.bytes);
    await utimes(source.file, new Date(), new Date(Date.now() + 10_000));
  });
});

test("CAR input rejects a hard link introduced while the handle is being read", async (t) => {
  const source = await fixture(t);
  await duringRead(t, source.file, () => link(source.file, join(source.root, "alias.car")));
});
