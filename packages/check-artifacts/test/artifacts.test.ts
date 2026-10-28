import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:https";
import {
  chmod,
  copyFile,
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { after, before, test } from "node:test";
import {
  CheckKernel,
  closePrivateFileBackend,
  type CheckState,
  terminal,
} from "@potential-guide/check-host";
import { watchSnapshot } from "@potential-guide/effects";
import * as tar from "tar";
import { buildCheckArtifact, packCheckArtifact } from "../dist/build.js";
import {
  artifactLimits,
  inspectCheckArtifact,
  prepareCheckArtifact,
  transportDigest,
  type CheckManifest,
} from "../dist/index.js";
import { unpackCheckArchive } from "../dist/archive.js";
import { inspectFiles } from "../dist/manifest.js";

const exec = promisify(execFile);
const example = fileURLToPath(new URL("../examples/file-content/", import.meta.url));
let scratch: string;
let built: Awaited<ReturnType<typeof buildCheckArtifact>>;
let packed: Awaited<ReturnType<typeof packCheckArtifact>>;
let manifest: CheckManifest;
before(async () => {
  const root = resolve(".cache", "artifact-tests");
  await mkdir(root, { recursive: true });
  scratch = await mkdtemp(join(root, "case-"));
  manifest = JSON.parse(await readFile(join(example, "check.json"), "utf8"));
  built = await buildCheckArtifact({
    entry: join(example, "worker.ts"),
    manifest,
    files: {
      "resources/expected.txt": join(example, "expected.txt"),
      "references/check.md": join(example, "references/check.md"),
      "references/content-mismatch.md": join(example, "references/content-mismatch.md"),
    },
    outDirectory: join(scratch, "built"),
  });
  packed = await packCheckArtifact(built.directory, join(scratch, "check.tgz"));
});
after(async () => {
  await closePrivateFileBackend();
  await rm(scratch, { recursive: true, force: true });
});
function source(directory = built.directory, digest = built.digest) {
  return { kind: "directory" as const, directory, digest };
}
async function copied(name: string) {
  const directory = join(scratch, name);
  await cp(built.directory, directory, { recursive: true });
  return directory;
}
async function completed(kernel: CheckKernel, checkId: string): Promise<CheckState> {
  return new Promise((done) => {
    const lifetime = new AbortController();
    watchSnapshot(
      kernel.observe(checkId).state,
      (state) => {
        if (terminal(state)) {
          lifetime.abort();
          done(state);
        }
      },
      lifetime.signal,
    );
  });
}
async function execute(
  prepared: { directory: string; revision: string },
  checkId: string,
  file: string,
) {
  const kernel = await CheckKernel.create(join(scratch, `snapshots-${checkId}`));
  try {
    await kernel.executeCheck({ ...prepared, checkId, subject: { file } });
    const result = await completed(kernel, checkId);
    assert.equal(result.state, "Completed");
    return result.state === "Completed" ? result.result : null;
  } finally {
    await kernel.close();
  }
}
test("real Check builds, packs, prepares and executes bundled Ajv without Check node_modules", async () => {
  const prepared = await prepareCheckArtifact(source(), {
    cacheDirectory: join(scratch, "consumer/cache"),
  });
  assert.equal(prepared.digest, built.digest);
  assert.deepEqual((await readdir(prepared.directory)).sort(), ["resources", "worker.cjs"]);
  const target = join(scratch, "consumer/target.txt");
  await copyFile(join(example, "expected.txt"), target);
  const passed = (await execute(prepared, "pass", target)) as { payload: { ok: boolean } };
  assert.equal(passed.payload.ok, true);
  await writeFile(target, "different");
  const failed = (await execute(prepared, "fail", target)) as {
    payload: { ok: boolean; problems: { id: string }[] };
  };
  assert.equal(failed.payload.ok, false);
  assert.equal(failed.payload.problems[0]?.id, "content-mismatch");
  for (const reference of [
    manifest.references.check,
    ...Object.values(manifest.references.problems),
  ])
    assert.equal(
      await readFile(join(prepared.artifactDirectory, reference), "utf8"),
      await readFile(join(built.directory, reference), "utf8"),
    );
  const unpacked = await unpackCheckArchive(await readFile(packed.archive));
  assert.equal(unpacked.digest, built.digest);
  assert.equal(packed.transportDigest, transportDigest(await readFile(packed.archive)));
  await assert.rejects(
    buildCheckArtifact({
      entry: join(example, "worker.ts"),
      manifest,
      files: {},
      outDirectory: built.directory,
    }),
    /exactly match/,
  );
});
test("logical digest vector is domain-separated and ignores physical archive metadata", async () => {
  const vector = {
    format: "pguide-check-v1",
    id: "vector",
    worker: "worker.cjs",
    protocol: "pguide-check-host-v1",
    subjectSchema: true,
    resultSchema: true,
    resources: [],
    references: { check: "references/check.md", problems: {} },
  };
  assert.equal(
    inspectFiles(
      new Map([
        ["check.json", Buffer.from(JSON.stringify(vector))],
        ["worker.cjs", Buffer.from("exports.execute=()=>({ok:true});\n")],
        ["references/check.md", Buffer.from("Check reference.\n")],
      ]),
    ).digest,
    "sha256-pguide-check-v1:f51234a7f4948528687ca4b32e9e57c6050d2ca1855f584fadfe7912793da247",
  );
  const bytes = await readFile(packed.archive);
  const unpacked = await unpackCheckArchive(bytes);
  const hash = createHash("sha256").update("pguide-check\0v1\0");
  for (const [name, content] of [...unpacked.files].sort(([a], [b]) =>
    Buffer.compare(Buffer.from(a), Buffer.from(b)),
  ))
    hash
      .update(JSON.stringify([name, content.length]))
      .update("\0")
      .update(content);
  assert.equal(built.digest, `sha256-pguide-check-v1:${hash.digest("hex")}`);
  const chunks: Buffer[] = [];
  for await (const chunk of tar.c(
    { cwd: built.directory, gzip: true, mtime: new Date("2000-01-01"), noDirRecurse: true },
    [...unpacked.files.keys()],
  ))
    chunks.push(Buffer.from(chunk));
  const repacked = Buffer.concat(chunks);
  assert.equal((await unpackCheckArchive(repacked)).digest, built.digest);
  assert.notEqual(transportDigest(repacked), transportDigest(bytes));
});
test("References change logical digest, not Host execution revision", async () => {
  const changed = await copied("changed-reference");
  await writeFile(join(changed, "references/check.md"), "A revised complete Check reference.\n");
  const inspection = await inspectCheckArtifact(changed);
  assert.notEqual(inspection.digest, built.digest);
  const cacheDirectory = join(scratch, "reference-cache");
  const old = await prepareCheckArtifact(source(), { cacheDirectory });
  const next = await prepareCheckArtifact(source(changed, inspection.digest), { cacheDirectory });
  assert.equal(old.revision, next.revision);
  const executable = await copied("executable-resource");
  await writeFile(
    join(executable, "check.json"),
    JSON.stringify({
      ...manifest,
      resources: [{ path: "resources/expected.txt", executable: true }],
    }),
  );
  const inspectionWithMode = await inspectCheckArtifact(executable);
  assert.notEqual(inspectionWithMode.digest, built.digest);
  const withMode = await prepareCheckArtifact(source(executable, inspectionWithMode.digest), {
    cacheDirectory,
  });
  if (process.platform !== "win32") assert.notEqual(withMode.revision, old.revision);
});
test("cache is verified offline, never repaired or replaced on tampering", async () => {
  const cacheDirectory = join(scratch, "immutable-cache");
  const [first, second] = await Promise.all([
    prepareCheckArtifact(source(), { cacheDirectory }),
    prepareCheckArtifact(source(), { cacheDirectory }),
  ]);
  assert.equal(first.directory, second.directory);
  assert.deepEqual(
    await prepareCheckArtifact(source(join(scratch, "no-longer-present")), { cacheDirectory }),
    first,
  );
  const worker = join(first.directory, "worker.cjs");
  await chmod(worker, 0o600);
  await writeFile(worker, "exports.execute=()=>true");
  await assert.rejects(
    prepareCheckArtifact(source(), { cacheDirectory }),
    /execution content mismatch/,
  );
  assert.equal(await readFile(worker, "utf8"), "exports.execute=()=>true");
  assert.deepEqual(
    (await readdir(cacheDirectory)).filter(
      (name) => name.startsWith("prepare-") || name.endsWith(".lock"),
    ),
    [],
  );
  const incompleteCache = join(scratch, "incomplete-cache");
  const incomplete = await prepareCheckArtifact(source(), { cacheDirectory: incompleteCache });
  await rm(join(incomplete.directory, "worker.cjs"), { force: true });
  await assert.rejects(prepareCheckArtifact(source(), { cacheDirectory: incompleteCache }));
  assert.deepEqual(await readdir(incomplete.directory), ["resources"]);
});
test("wrong digest, missing and undeclared files never publish a cache capsule", async () => {
  const cacheDirectory = join(scratch, "invalid-cache");
  await assert.rejects(
    prepareCheckArtifact(source(built.directory, `sha256-pguide-check-v1:${"0".repeat(64)}`), {
      cacheDirectory,
    }),
    /digest mismatch/,
  );
  const changed = await copied("missing");
  await rm(join(changed, "resources/expected.txt"));
  await assert.rejects(inspectCheckArtifact(changed), /missing or undeclared/);
  await writeFile(join(changed, "resources/expected.txt"), "restored");
  await writeFile(join(changed, "extra.txt"), "undeclared");
  await assert.rejects(inspectCheckArtifact(changed), /missing or undeclared/);
  assert.deepEqual(await readdir(cacheDirectory), []);
  const oversized = await copied("oversized-local");
  await truncate(join(oversized, "resources/expected.txt"), artifactLimits.bytes + 1);
  await assert.rejects(inspectCheckArtifact(oversized), /size|bounds/);
});
test("local links, hardlinks, ambiguous names, empty directories and excess paths are rejected", async () => {
  const hard = await copied("hardlink");
  await link(join(hard, "worker.cjs"), join(hard, "extra.cjs"));
  await assert.rejects(inspectCheckArtifact(hard), /hard-link/);
  const symbolic = await copied("symlink");
  await symlink(
    join(symbolic, "resources"),
    join(symbolic, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(inspectCheckArtifact(symbolic), /links/);
  const unsafe = await copied("unsafe");
  await writeFile(join(unsafe, "not-NFC-e\u0301.txt"), "bad");
  await assert.rejects(inspectCheckArtifact(unsafe), /unsafe/);
  const empty = await copied("empty");
  await mkdir(join(empty, "empty"));
  await assert.rejects(inspectCheckArtifact(empty), /empty directory/);
  const many = await copied("many");
  for (let n = 0; n < artifactLimits.paths; n++) await mkdir(join(many, `d${n}`));
  await assert.rejects(inspectCheckArtifact(many), /path bounds/);
});
function archive(
  entries: {
    path: string;
    type?: "File" | "SymbolicLink" | "Link" | "Directory" | "FIFO" | "CharacterDevice";
    linkpath?: string;
    size?: number;
    content?: string;
  }[],
) {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const bytes = Buffer.from(entry.content ?? "");
    const header = new tar.Header({
      ...entry,
      type: entry.type ?? "File",
      size: entry.size ?? bytes.length,
      mode: 0o600,
    });
    header.encode();
    assert.ok(header.block);
    chunks.push(header.block, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}
test("node-tar parsing refuses traversal, links, special/duplicate/case-conflicting entries and limits", async () => {
  for (const path of [
    "../escape",
    "/absolute",
    "C:/escape",
    "a\\escape",
    "node_modules/x",
    "NUL.txt",
    "a./x",
    "e\u0301",
  ]) {
    await assert.rejects(unpackCheckArchive(archive([{ path, content: "x" }])), /unsafe|archive/);
  }
  for (const type of ["SymbolicLink", "Link"] as const)
    await assert.rejects(
      unpackCheckArchive(archive([{ path: "worker.cjs", type, linkpath: "../escape" }])),
      /link/,
    );
  for (const type of ["FIFO", "CharacterDevice"] as const)
    await assert.rejects(unpackCheckArchive(archive([{ path: "special", type }])), /special/);
  await assert.rejects(unpackCheckArchive(archive([{ path: "a" }, { path: "a" }])), /duplicate/);
  await assert.rejects(
    unpackCheckArchive(archive([{ path: "A/a" }, { path: "a/b" }])),
    /ambiguous/,
  );
  await assert.rejects(
    unpackCheckArchive(archive([{ path: "worker.cjs", size: artifactLimits.bytes + 1 }])),
    /bounds/,
  );
  await assert.rejects(
    unpackCheckArchive(archive(Array.from({ length: 257 }, (_, n) => ({ path: `f${n}` })))),
    /bounds/,
  );
  await assert.rejects(unpackCheckArchive(Buffer.from("not gzip")));
  const bytes = await readFile(packed.archive);
  await assert.rejects(unpackCheckArchive(bytes.subarray(0, bytes.length - 16)));
  await assert.rejects(unpackCheckArchive(gzipSync(bytes)), /gzip-compressed tar/);
  await assert.rejects(
    unpackCheckArchive(
      gzipSync(Buffer.concat([gunzipSync(bytes), Buffer.alloc(artifactLimits.expandedTarBytes)])),
    ),
    /exceeds bounds/,
  );
  await assert.rejects(
    unpackCheckArchive(Buffer.alloc(artifactLimits.archiveBytes + 1)),
    /exceeds bounds/,
  );
});
test("manifest rejects invalid contracts, dangling References and undeclared resource names", async () => {
  for (const patch of [
    { format: "future" },
    { subjectSchema: { type: "imaginary" } },
    { subjectSchema: { $ref: "https://example.invalid/schema" } },
    { references: { check: "docs/check.md", problems: {} } },
    { resources: [{ path: "../outside", executable: false }] },
    {
      resources: [
        { path: "resources/expected.txt", executable: false },
        { path: "resources/expected.txt", executable: false },
      ],
    },
  ]) {
    const directory = await copied(`bad-manifest-${Math.random()}`);
    await writeFile(join(directory, "check.json"), JSON.stringify({ ...manifest, ...patch }));
    await assert.rejects(inspectCheckArtifact(directory));
  }
});
test("aborted preparation and unsafe HTTPS declarations fail without output", async () => {
  const signal = AbortSignal.abort(new Error("cancelled preparation"));
  const cacheDirectory = join(scratch, "abort-cache");
  await assert.rejects(prepareCheckArtifact(source(), { cacheDirectory, signal }), /cancelled/);
  for (const url of [
    "http://localhost/check.tgz",
    "https://user:password@localhost/check.tgz",
    "https://localhost/check.tgz#fragment",
  ]) {
    await assert.rejects(
      prepareCheckArtifact(
        { kind: "https", url, digest: built.digest, transportDigest: packed.transportDigest },
        { cacheDirectory },
      ),
      /HTTPS/,
    );
  }
  assert.deepEqual(await readdir(cacheDirectory), []);
});
test("prepared workers preserve cancellation, deadline and confirmed cleanup semantics", async () => {
  const entry = join(scratch, "cancellable.ts");
  await writeFile(
    entry,
    `
    import {writeFile} from "node:fs/promises";
    export async function execute(subject,context) {
      context.defer(()=>writeFile(subject.cleanup,"clean"));
      await writeFile(subject.started,"started");
      await new Promise(done=>{
        if(context.signal.aborted)done();
        else context.signal.addEventListener("abort",done,{once:true});
      });
      return {ok:true};
    }`,
  );
  const candidate = await buildCheckArtifact({
    entry,
    manifest: { ...manifest, id: "cancellable", subjectSchema: true, resultSchema: true },
    files: {
      "resources/expected.txt": join(example, "expected.txt"),
      "references/check.md": join(example, "references/check.md"),
      "references/content-mismatch.md": join(example, "references/content-mismatch.md"),
    },
    outDirectory: join(scratch, "cancellable"),
  });
  const prepared = await prepareCheckArtifact(source(candidate.directory, candidate.digest), {
    cacheDirectory: join(scratch, "cancellable-cache"),
  });
  const kernel = await CheckKernel.create(join(scratch, "cancellable-snapshots"), {
    deadlineMs: 1000,
  });
  try {
    for (const checkId of ["cancel", "deadline"]) {
      const cleanup = join(scratch, `${checkId}-cleaned`);
      const started = join(scratch, `${checkId}-started`);
      await kernel.executeCheck({ ...prepared, checkId, subject: { cleanup, started } });
      if (checkId === "cancel") {
        let running = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            running = (await readFile(started, "utf8")) === "started";
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          if (running) break;
          await delay(10);
        }
        assert.ok(running, "worker must actually start before cancellation");
        kernel.cancel(checkId);
      }
      assert.equal((await completed(kernel, checkId)).state, "Cancelled");
      assert.equal(await readFile(cleanup, "utf8"), "clean");
      assert.equal(kernel.diagnostics().ownedProcesses, 0);
    }
  } finally {
    await kernel.close();
  }
});
test("real HTTPS acquisition pins both digests, rejects redirects and tampering, then executes offline", async () => {
  const certDirectory = join(scratch, "tls");
  await mkdir(certDirectory);
  const cert = join(certDirectory, "cert.pem");
  const key = join(certDirectory, "key.pem");
  const openssl =
    process.platform === "win32"
      ? join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "usr", "bin", "openssl.exe")
      : "openssl";
  await exec(
    openssl,
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      key,
      "-out",
      cert,
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { cwd: certDirectory },
  );
  const bytes = await readFile(packed.archive);
  const server = createServer(
    { cert: await readFile(cert), key: await readFile(key) },
    (request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "/check.tgz" });
        response.end();
      } else if (request.url === "/slow") {
        response.writeHead(200);
        response.flushHeaders();
      } else if (request.url === "/oversize") {
        response.writeHead(200, { "content-length": String(artifactLimits.archiveBytes + 1) });
        response.end();
      } else {
        response.writeHead(200);
        response.end(request.url === "/tampered" ? Buffer.from("tampered") : bytes);
      }
    },
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const cacheDirectory = join(scratch, "https-consumer/cache");
  const moduleURL = new URL("../dist/index.js", import.meta.url).href;
  async function child(
    path: string,
    cache: string,
    digest = built.digest,
    transfer = packed.transportDigest,
    timeoutMs = 30_000,
  ) {
    const script = `import {prepareCheckArtifact} from ${JSON.stringify(moduleURL)};
      const {closePrivateFileBackend:close}=await import(${JSON.stringify(new URL("../../check-host/dist/index.js", import.meta.url).href)});
      try { console.log(JSON.stringify(await prepareCheckArtifact(${JSON.stringify({ kind: "https", url: `https://127.0.0.1:${address && typeof address !== "string" ? address.port : 0}${path}`, digest, transportDigest: transfer })},${JSON.stringify({ cacheDirectory: cache, timeoutMs })}))); }
      finally {await close();}`;
    return exec(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: scratch,
      env: { ...process.env, NODE_EXTRA_CA_CERTS: cert, NODE_PATH: "", NODE_OPTIONS: "" },
    });
  }
  try {
    const { stdout } = await child("/check.tgz", cacheDirectory);
    const prepared = JSON.parse(stdout.trim());
    assert.equal(prepared.digest, built.digest);
    const target = join(scratch, "https-target.txt");
    await copyFile(join(example, "expected.txt"), target);
    assert.equal(
      ((await execute(prepared, "https", target)) as { payload: { ok: boolean } }).payload.ok,
      true,
    );
    for (const path of ["/redirect", "/oversize", "/tampered"])
      await assert.rejects(child(path, `${cacheDirectory}-${path.slice(1)}`));
    await assert.rejects(
      child(
        "/check.tgz",
        `${cacheDirectory}-bad-content`,
        `sha256-pguide-check-v1:${"0".repeat(64)}`,
      ),
    );
    const timedOutCache = `${cacheDirectory}-timeout`;
    await assert.rejects(child("/slow", timedOutCache, built.digest, packed.transportDigest, 150));
    assert.deepEqual(await readdir(timedOutCache), []);
    await assert.rejects(
      child(
        "/check.tgz",
        `${cacheDirectory}-bad-transfer`,
        built.digest,
        `sha256:${"0".repeat(64)}`,
      ),
    );
    await new Promise<void>((done, fail) =>
      server.close((error) => (error ? fail(error) : done())),
    );
    assert.equal(
      JSON.parse((await child("/unreachable", cacheDirectory)).stdout).revision,
      prepared.revision,
    );
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((done) => server.close(() => done()));
  }
});
