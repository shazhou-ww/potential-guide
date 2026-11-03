import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, link, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import * as tar from "tar";
import {
  digestObjectivePackage,
  prepareObjectivePackage,
  restoreObjectivePackage,
} from "../dist/index.js";

const root = resolve("../..");
async function fixture(t) {
  const base = join(root, ".cache", "npm-objective-tests");
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "case-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const previousHost = process.env.PGUIDE_CHECK_HOST_DIRECTORY;
  process.env.PGUIDE_CHECK_HOST_DIRECTORY = join(directory, "host-cache");
  t.after(() => {
    if (previousHost === undefined) delete process.env.PGUIDE_CHECK_HOST_DIRECTORY;
    else process.env.PGUIDE_CHECK_HOST_DIRECTORY = previousHost;
  });
  const source = join(directory, "source");
  await mkdir(source);
  const marker = join(root, "packages", "objective-setup-marker");
  await cp(join(marker, "references"), join(source, "references"), { recursive: true });
  await cp(join(marker, "objective.yaml"), join(source, "objective.yaml"));
  await mkdir(join(source, "checks", "marker"), { recursive: true });
  await writeFile(
    join(source, "checks", "marker", "worker.cjs"),
    'exports.execute=async()=>({status:200,payload:{ok:true,problems:[]},message:""});',
  );
  await writeFile(
    join(source, "package.json"),
    JSON.stringify({
      name: "@fixture/objective-marker",
      version: "1.0.0",
      files: ["objective.yaml", "references", "checks"],
    }),
  );
  return { directory, source, cacheDirectory: join(directory, "cache") };
}

test("content digest is independent of location and tar headers but covers every delivered byte and execution mode", async (t) => {
  const { directory, source } = await fixture(t);
  const second = join(directory, "second");
  await cp(source, second, { recursive: true });
  const digest = await digestObjectivePackage(source);
  assert.match(digest, /^sha256-pguide-package-v1:[0-9a-f]{64}$/);
  assert.equal(await digestObjectivePackage(second), digest);
  const executable = { "checks/marker/worker.cjs": 0o755 };
  assert.notEqual(await digestObjectivePackage(source, executable), digest);
  const path = join(second, "references", "system", "overview", "en-US.md");
  await writeFile(path, `${await readFile(path, "utf8")}\nmutation\n`);
  assert.notEqual(await digestObjectivePackage(second), digest);
  for (const [name, mtime] of [
    ["one.tgz", new Date(1000)],
    ["two.tgz", new Date(2000)],
  ]) {
    await tar.c(
      { file: join(directory, name), gzip: true, cwd: source, prefix: "package", mtime },
      ["package.json", "objective.yaml", "references", "checks"],
    );
    const prepared = await prepareObjectivePackage(join(directory, name), directory, {
      cacheDirectory: join(directory, "repack-cache"),
    });
    assert.equal(prepared.source.packageDigest, digest);
  }
});

test("canonical package digest v1 has an explicit platform-independent executable-bit vector", async (t) => {
  const { directory } = await fixture(t);
  const vector = join(directory, "vector");
  await mkdir(join(vector, "bin"), { recursive: true });
  await writeFile(join(vector, "a.txt"), "hello\n");
  await writeFile(join(vector, "bin", "run"), Buffer.from([0, 1, 255]));
  assert.equal(
    await digestObjectivePackage(vector, { "a.txt": 0o644, "bin/run": 0o755 }),
    "sha256-pguide-package-v1:32e4aa4b5887e23d4fda2cc08f9a89acafe512963cd314f60359dc9c58ced940",
  );
});

test("npm directory/tarball preparation freezes actual identity and exact offline recovery", async (t) => {
  const { directory, source, cacheDirectory } = await fixture(t);
  const prepared = await prepareObjectivePackage(source, directory, { cacheDirectory });
  assert.equal(prepared.source.packageName, "@fixture/objective-marker");
  assert.equal(prepared.source.kind, "npm-package");
  assert.equal(prepared.source.spec, source);
  assert.ok(prepared.source.integrity);
  const first = prepared.source.packageDigest;
  await writeFile(join(source, "checks", "marker", "worker.cjs"), "exports.execute=()=>null;");
  assert.equal(
    (await restoreObjectivePackage(prepared.source, { cacheDirectory })).source.packageDigest,
    first,
  );
  assert.notEqual(
    (await prepareObjectivePackage(source, directory, { cacheDirectory })).source.packageDigest,
    first,
  );
  const missing = {
    ...prepared.source,
    packageDigest: `sha256-pguide-package-v1:${"0".repeat(64)}`,
  };
  await assert.rejects(
    restoreObjectivePackage(missing, { cacheDirectory }),
    /No floating spec was resolved/,
  );
  const tarball = join(directory, "delivered.tgz");
  await tar.c({ file: tarball, gzip: true, cwd: prepared.directory, prefix: "package" }, ["."]);
  const repacked = await prepareObjectivePackage(tarball, directory, { cacheDirectory });
  assert.equal(repacked.source.packageDigest, first);
});

test("npm directory preparation materializes cross-directory hardlinks before packing", async (t) => {
  const { directory, source, cacheDirectory } = await fixture(t);
  const original = join(source, "checks", "marker", "worker.cjs");
  await mkdir(join(source, "checks", "duplicate"));
  await link(original, join(source, "checks", "duplicate", "worker.cjs"));
  const prepared = await prepareObjectivePackage(source, directory, {
    cacheDirectory,
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal((await lstat(join(prepared.directory, "checks", "marker", "worker.cjs"))).nlink, 1);
  assert.equal(
    (await lstat(join(prepared.directory, "checks", "duplicate", "worker.cjs"))).nlink,
    1,
  );
  assert.equal((await lstat(original)).nlink, 2);
  assert.deepEqual(
    await readFile(join(prepared.directory, "checks", "duplicate", "worker.cjs")),
    await readFile(original),
  );
});

test("a second Objective and ambiguous/link paths are rejected rather than partially hashed", async (t) => {
  const { source } = await fixture(t);
  await mkdir(join(source, "nested"));
  await writeFile(join(source, "nested", "objective.yaml"), "{}");
  await assert.rejects(digestObjectivePackage(source), /exactly one root Objective/);
});

test("unsafe tar traversal, implied-parent case collisions and links reject before extraction", async (t) => {
  const { directory, cacheDirectory } = await fixture(t);
  function archive(entries) {
    const blocks = [];
    for (const entry of entries) {
      const bytes = Buffer.from(entry.bytes ?? "x");
      const header = new tar.Header({
        path: entry.path,
        mode: 0o644,
        size: entry.type ? 0 : bytes.length,
        type: entry.type ?? "File",
        ...(entry.linkpath === undefined ? {} : { linkpath: entry.linkpath }),
      });
      header.encode();
      blocks.push(header.block);
      if (!entry.type) blocks.push(bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
    }
    blocks.push(Buffer.alloc(1024));
    return gzipSync(Buffer.concat(blocks));
  }
  const cases = [
    [{ path: "package/../escape" }],
    [{ path: "package/Folder/a" }, { path: "package/folder/b" }],
    [{ path: "package/link", type: "SymbolicLink", linkpath: "../escape" }],
  ];
  for (const [index, entries] of cases.entries()) {
    const path = join(directory, `unsafe-${index}.tgz`);
    await writeFile(path, archive(entries));
    await assert.rejects(
      prepareObjectivePackage(path, directory, {
        cacheDirectory,
        signal: AbortSignal.timeout(5000),
      }),
      /unsafe|escapes|ambiguous|duplicate|link|special/i,
    );
  }
  await assert.rejects(readFile(join(cacheDirectory, "escape")), { code: "ENOENT" });
});

test("local npm packages do not need a publish version to acquire a content revision", async (t) => {
  const { directory, source, cacheDirectory } = await fixture(t);
  const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  delete manifest.version;
  await writeFile(join(source, "package.json"), JSON.stringify(manifest));
  const prepared = await prepareObjectivePackage(source, directory, { cacheDirectory });
  assert.equal(prepared.source.packageName, "@fixture/objective-marker");
  assert.match(prepared.source.packageDigest, /^sha256-pguide-package-v1:[a-f0-9]{64}$/);
});

test("real registry version/range/tag/alias and remote tarballs use npm resolution and freeze offline", async (t) => {
  const { directory, source, cacheDirectory } = await fixture(t);
  const archives = new Map();
  for (const version of ["1.0.0", "1.2.0", "2.0.0"]) {
    const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    await writeFile(join(source, "package.json"), JSON.stringify({ ...manifest, version }));
    const path = join(directory, `${version}.tgz`);
    await tar.c({ file: path, gzip: true, cwd: source, prefix: "package" }, [
      "package.json",
      "objective.yaml",
      "references",
      "checks",
    ]);
    archives.set(version, await readFile(path));
  }
  let registry;
  const server = createServer((request, response) => {
    const version = /\/([0-9]+\.[0-9]+\.[0-9]+)\.tgz$/.exec(request.url)?.[1];
    if (version) {
      const bytes = archives.get(version);
      if (!bytes) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/octet-stream" }).end(bytes);
    } else {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          name: "@fixture/objective-marker",
          "dist-tags": { latest: "2.0.0", stable: "1.0.0" },
          versions: Object.fromEntries(
            [...archives].map(([version, bytes]) => [
              version,
              {
                name: "@fixture/objective-marker",
                version,
                dist: {
                  tarball: `${registry}${version}.tgz`,
                  integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
                },
              },
            ]),
          ),
        }),
      );
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  registry = `http://127.0.0.1:${server.address().port}/`;
  const prepared = [];
  try {
    for (const [spec, version] of [
      ["@fixture/objective-marker@1.0.0", "1.0.0"],
      ["@fixture/objective-marker@^1", "1.2.0"],
      ["@fixture/objective-marker@stable", "1.0.0"],
      ["@fixture/objective-marker", "2.0.0"],
      ["reference-only@npm:@fixture/objective-marker@^1", "1.2.0"],
      [`${registry}1.2.0.tgz`, "1.2.0"],
    ]) {
      const item = await prepareObjectivePackage(spec, directory, { cacheDirectory, registry });
      assert.equal(item.source.packageName, "@fixture/objective-marker");
      assert.equal(item.source.version, version);
      assert.match(item.source.resolved, new RegExp(`${version.replaceAll(".", "\\.")}\\.tgz$`));
      prepared.push(item);
    }
    assert.equal(prepared[1].source.packageDigest, prepared[4].source.packageDigest);
    assert.equal(prepared[1].source.packageDigest, prepared[5].source.packageDigest);
    assert.notEqual(prepared[0].source.packageDigest, prepared[1].source.packageDigest);
  } finally {
    await new Promise((done) => server.close(done));
  }
  for (const item of prepared)
    assert.equal(
      (await restoreObjectivePackage(item.source, { cacheDirectory })).source.packageDigest,
      item.source.packageDigest,
    );
});

test("Git package specs record the exact resolved commit as provenance, never as a package digest", async (t) => {
  const { directory, source, cacheDirectory } = await fixture(t);
  const git = (...args) =>
    execFileSync("git", ["--no-pager", "-C", source, ...args], {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  git("init", "-q");
  git("config", "user.name", "Objective fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("add", ".");
  git("-c", "commit.gpgsign=false", "commit", "-qm", "Fixture");
  const commit = git("rev-parse", "HEAD");
  const spec = `git+${pathToFileURL(source).href}#${commit}`;
  const prepared = await prepareObjectivePackage(spec, directory, { cacheDirectory });
  assert.equal(prepared.source.packageName, "@fixture/objective-marker");
  assert.equal(prepared.source.commit, commit);
  assert.notEqual(prepared.source.packageDigest, commit);
  assert.equal(prepared.source.spec, spec);
  await writeFile(join(source, "checks", "marker", "worker.cjs"), "exports.execute=()=>null;");
  assert.equal(
    (await restoreObjectivePackage(prepared.source, { cacheDirectory })).source.packageDigest,
    prepared.source.packageDigest,
  );
});

test("lifecycle scripts require explicit authorization and cancelled preparation confirms descendant cleanup", async (t) => {
  const { directory, source, cacheDirectory } = await fixture(t);
  const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  await writeFile(
    join(source, "package.json"),
    JSON.stringify({
      ...manifest,
      scripts: { prepare: "node prepare.cjs" },
    }),
  );
  await writeFile(
    join(source, "prepare.cjs"),
    `
const {spawn}=require("node:child_process");
const {writeFileSync}=require("node:fs");
const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});
writeFileSync("owned.json",JSON.stringify({parent:process.pid,child:child.pid}));
setInterval(()=>{},1000);
`,
  );
  await prepareObjectivePackage(source, directory, { cacheDirectory });
  await assert.rejects(readFile(join(source, "owned.json")), { code: "ENOENT" });
  const controller = new AbortController();
  const pending = prepareObjectivePackage(source, directory, {
    cacheDirectory,
    allowScripts: true,
    signal: controller.signal,
  });
  void pending.catch(() => {});
  let owned;
  try {
    const end = Date.now() + 10000;
    while (!owned) {
      try {
        owned = JSON.parse(await readFile(join(source, "owned.json"), "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (Date.now() > end) throw new Error("Authorized fixture script did not start.");
        await new Promise((done) => setTimeout(done, 20));
      }
    }
  } finally {
    controller.abort(new Error("Explicit preparation cancellation."));
    await assert.rejects(pending, /preparation cancellation/i);
  }
  assert.throws(() => process.kill(owned.parent, 0), { code: "ESRCH" });
  assert.throws(() => process.kill(owned.child, 0), { code: "ESRCH" });
});
