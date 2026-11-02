import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import * as tar from "tar";
import { unpackArtifactFiles } from "../src/archive.js";
import { gitTreeDigest } from "../src/contracts.js";

function archive(
  entries: {
    path: string;
    type?: "File" | "Directory" | "SymbolicLink" | "Link" | "FIFO";
    bytes?: Buffer;
    linkpath?: string;
    size?: number;
  }[],
) {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const bytes = entry.bytes ?? Buffer.alloc(0);
    const header = new tar.Header({
      path: entry.path,
      type: entry.type ?? "File",
      size: entry.size ?? bytes.length,
      mode: 0o644,
      uid: 0,
      gid: 0,
      ...(entry.linkpath === undefined ? {} : { linkpath: entry.linkpath }),
    });
    header.encode();
    chunks.push(header.block!, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}
test("V02: streaming extraction rejects unsafe, duplicate, link, special and conflicting paths", async () => {
  for (const entries of [
    [{ path: "../outside" }],
    [{ path: "/absolute" }],
    [{ path: "C:\\outside" }],
    [{ path: "resources/x", type: "SymbolicLink" as const, linkpath: "../../outside" }],
    [{ path: "resources/x", type: "Link" as const, linkpath: "worker.cjs" }],
    [{ path: "resources/x", type: "FIFO" as const }],
    [{ path: "worker.cjs" }, { path: "worker.cjs" }],
    [{ path: "resources/a" }, { path: "Resources/b" }],
    [{ path: "resources" }, { path: "resources/x" }],
  ])
    await assert.rejects(unpackArtifactFiles(archive(entries)));
  const bytes = archive([{ path: "worker.cjs", bytes: Buffer.from("ok") }]);
  const files = await unpackArtifactFiles(bytes);
  assert.equal(files.get("worker.cjs")!.toString(), "ok");
  await assert.rejects(
    unpackArtifactFiles(
      gzipSync(Buffer.concat([Buffer.alloc(1024), Buffer.from("trailing-content")])),
    ),
    /after its tar end marker/,
  );
});
test("V02: download, expanded, per-file, count and delivered-byte bounds apply during streaming", async () => {
  const bytes = archive([
    { path: "task.yaml", bytes: Buffer.from("manifest") },
    { path: "worker.cjs", bytes: Buffer.alloc(4096, 1) },
  ]);
  for (const limits of [
    { archiveBytes: bytes.length - 1 },
    { expandedTarBytes: 512 },
    { fileBytes: 4095 },
    { bytes: 4096 },
    { files: 1 },
    { paths: 1 },
  ]) {
    async function* chunks() {
      for (let offset = 0; offset < bytes.length; offset += 7)
        yield bytes.subarray(offset, offset + 7);
    }
    await assert.rejects(unpackArtifactFiles(chunks(), undefined, limits));
  }
  let fetched = 0;
  async function* endless() {
    for (let index = 0; index < 1000; index++) {
      fetched++;
      yield Buffer.alloc(10);
    }
  }
  await assert.rejects(unpackArtifactFiles(endless(), undefined, { archiveBytes: 32 }));
  assert.ok(fetched < 1000);
  await assert.rejects(
    unpackArtifactFiles(archive([{ path: "worker.cjs", size: 2 ** 40 }]), undefined, {
      fileBytes: 100,
    }),
  );
});
test("V02: Git tree content identity ignores compression metadata, never file names or bytes", async () => {
  const entries = [
    { path: "task.yaml", bytes: Buffer.from("name: test\n") },
    { path: "worker.cjs", bytes: Buffer.from("code") },
  ];
  const packed = archive(entries);
  const reverse = archive([...entries].reverse());
  assert.notDeepEqual(packed, reverse);
  const digest = gitTreeDigest(await unpackArtifactFiles(packed));
  assert.equal(digest, gitTreeDigest(await unpackArtifactFiles(reverse)));
  const changed = await unpackArtifactFiles(packed);
  changed.set("task.yaml", Buffer.from("name: test\r\n"));
  assert.notEqual(digest, gitTreeDigest(changed));
  const renamed = await unpackArtifactFiles(packed);
  renamed.set("resources/code", renamed.get("worker.cjs")!);
  renamed.delete("worker.cjs");
  assert.notEqual(digest, gitTreeDigest(renamed));
});
