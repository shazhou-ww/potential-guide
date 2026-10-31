import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  packContractArtifact,
  writeContractArtifact,
} from "@potential-guide/check-artifacts/build";
import {
  artifactLimits,
  checkerSchemaUri,
  inspectContractFiles,
} from "@potential-guide/check-artifacts/contracts";
import { newId } from "@potential-guide/task-engine";
import { MemoryStore } from "@potential-guide/task-engine/testing";
import type { TaskSnapshot } from "@potential-guide/task-protocol";
import { createFixtureEngine as createTaskEngine } from "../../task-engine/test/driver.js";
import { createArtifactSource, validateCheckInput } from "../src/index.js";
import { createCheckFixture as createCheckTaskType } from "./type-fixture.js";

async function fixture() {
  const root = resolve(".cache", `local-source-${randomUUID()}`);
  const imports = join(root, "imports");
  await mkdir(imports, { recursive: true });
  const page = Buffer.from("---\ntitle: Local\ndescription: Local\n---\nBody\n");
  async function archive(
    name: string,
    minVersion = "22.13.0",
    subjectSchema: Record<string, unknown> = { type: "object" },
  ) {
    const files = new Map([
      [
        "checker.yaml",
        Buffer.from(
          JSON.stringify({
            $schema: checkerSchemaUri,
            runtime: { type: "node", minVersion },
            entry: "checker.cjs",
            subjectSchema,
            languages: ["en"],
            problems: ["bad"],
          }),
        ),
      ],
      [
        "checker.cjs",
        Buffer.from(
          `exports.execute=()=>({status:200,message:"",payload:{ok:false,problems:[{kind:"internal",id:"bad",parameters:{name:${JSON.stringify(name)}}}]}})`,
        ),
      ],
      ["references/en/checker.md", page],
      ["references/en/problems/bad.md", page],
    ]);
    const built = await writeContractArtifact(files, join(root, name));
    const packed = await packContractArtifact(built.directory, join(imports, `${name}.tgz`));
    return {
      ...packed,
      bytes: await readFile(packed.archive),
      digest: inspectContractFiles(files).digest,
    };
  }
  const first = await archive("first");
  const second = await archive("second");
  let allowed = true,
    authorizationCalls = 0,
    downloads = 0;
  const source = createArtifactSource({
    allowedOrigins: ["https://example.test"],
    allowedFileRoots: [imports],
    authorize(_reference, scope) {
      authorizationCalls++;
      if (!allowed || scope !== "one") throw new Error("source denied");
    },
    async download(url) {
      downloads++;
      assert.ok(url.startsWith("https:"));
      return first.bytes;
    },
  });
  const reference = { kind: "checker" as const, url: pathToFileURL(first.archive).href };
  return {
    root,
    archive,
    imports,
    first,
    second,
    source,
    reference,
    counts: () => ({ authorizationCalls, downloads }),
    deny: () => {
      allowed = false;
    },
    async close() {
      await source.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
async function final(engine: ReturnType<typeof createTaskEngine>, task: TaskSnapshot) {
  for (let count = 0; count < 500; count++) {
    const value = engine.getTask(task.taskId, { scope: "one", subject: "test" });
    if (value.termination) return value;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error("Local Check did not complete.");
}
test("real file archive -> prepare -> actual worker; HTTPS hook unchanged and never used for file", async () => {
  const f = await fixture();
  const type = createCheckTaskType({ source: f.source, directory: join(f.root, "workers") });
  const store = new MemoryStore();
  const engine = createTaskEngine({
    store,
    types: [type],
    currentVersions: { check: "2" },
    authorize: () => true,
  });
  engine.start();
  try {
    const eligibleAt = new Date(Date.now() - 1000).toISOString();
    const task = engine.submit(
      {
        requestId: newId(),
        type: "check",
        checker: f.reference,
        subject: {},
        timeoutMs: 20000,
        eligibleAt,
      },
      { scope: "one", subject: "test" },
    );
    const result = await final(engine, task);
    assert.equal(result.stage, "completed");
    assert.deepEqual((result.result as { result: unknown }).result, {
      ok: false,
      problems: [{ kind: "internal", id: "bad", parameters: { name: "first" } }],
    });
    assert.equal(f.counts().downloads, 0);
    await writeFile(f.first.archive, f.second.bytes);
    const changed = engine.submit(
      {
        requestId: newId(),
        type: "check",
        checker: f.reference,
        subject: {},
        timeoutMs: 20000,
        eligibleAt,
      },
      { scope: "one", subject: "test" },
    );
    const next = await final(engine, changed);
    assert.deepEqual((next.result as { result: unknown }).result, {
      ok: false,
      problems: [{ kind: "internal", id: "bad", parameters: { name: "second" } }],
    });
    assert.notEqual(next.run?.runId, result.run?.runId);
    assert.throws(
      () =>
        validateCheckInput({ checker: f.reference, subject: {}, allowedFileRoots: [f.imports] }),
      { code: "invalid_input" },
    );
    const outside = join(f.root, "outside-context.tgz");
    await writeFile(outside, f.first.bytes);
    const deniedTask = engine.submit(
      {
        requestId: newId(),
        type: "check",
        checker: { kind: "checker", url: pathToFileURL(outside).href },
        subject: {},
        context: { allowedFileRoots: [f.root], scope: "one" },
        timeoutMs: 20000,
      },
      { scope: "one", subject: "test" },
    );
    assert.equal((await final(engine, deniedTask)).error?.code, "artifact_source_denied");
    assert.equal(
      (
        await f.source.resolve(
          { kind: "checker", url: "https://example.test/a.tgz" },
          "one",
          new AbortController().signal,
        )
      ).digest,
      f.first.digest,
    );
    assert.equal(f.counts().downloads, 1);
  } finally {
    await engine.close();
    await type.close();
    store.close();
    await f.close();
  }
});
test("file Tasks retain subject validation and separate actual runtime availability", async () => {
  const f = await fixture();
  const unavailable = await f.archive("unavailable", "999.0.0");
  const restricted = await f.archive("restricted", "22.13.0", {
    type: "object",
    properties: { wanted: { type: "string" } },
    required: ["wanted"],
  });
  const type = createCheckTaskType({ source: f.source, directory: join(f.root, "workers") });
  const store = new MemoryStore();
  const engine = createTaskEngine({
    store,
    types: [type],
    currentVersions: { check: "2" },
    authorize: () => true,
  });
  engine.start();
  try {
    for (const [artifact, code] of [
      [unavailable, "unsupported_runtime"],
      [restricted, "invalid_check"],
    ] as const) {
      const task = engine.submit(
        {
          requestId: newId(),
          type: "check",
          checker: {
            kind: "checker",
            url: pathToFileURL(artifact.archive).href,
            digest: artifact.digest,
          },
          subject: {},
          timeoutMs: 20000,
        },
        { scope: "one", subject: "test" },
      );
      const failed = await final(engine, task);
      assert.equal(failed.stage, "run_failed");
      assert.equal(failed.error?.code, code);
    }
    assert.equal(Object.keys(store.read().facts.runs).length, 2);
    assert.equal(f.counts().downloads, 0);
  } finally {
    await engine.close();
    await type.close();
    store.close();
    await f.close();
  }
});
test("synchronous authorization binds the same immutable reference that is read", async () => {
  const f = await fixture();
  const source = createArtifactSource({
    allowedOrigins: [],
    allowedFileRoots: [f.imports],
    authorize(reference) {
      assert.equal(Object.isFrozen(reference), true);
      assert.equal(reference.url, f.reference.url);
    },
  });
  try {
    const reference = { ...f.reference };
    const pending = source.resolve(reference, "one", new AbortController().signal);
    reference.url = pathToFileURL(f.second.archive).href;
    assert.equal((await pending).digest, f.first.digest);
  } finally {
    await source.close();
    await f.close();
  }
});
test("asynchronous authorization is explicitly rejected before source IO", async () => {
  for (const rejects of [false, true]) {
    let downloads = 0;
    const source = createArtifactSource({
      allowedOrigins: ["https://example.test"],
      authorize: async () => {
        if (rejects) throw new Error("async denial");
      },
      async download() {
        downloads++;
        throw new Error("Must not download");
      },
    });
    try {
      await assert.rejects(
        source.resolve(
          { kind: "checker", url: "https://example.test/a.tgz" },
          "one",
          new AbortController().signal,
        ),
        { code: "invalid_type" },
      );
      assert.equal(downloads, 0);
    } finally {
      await source.close();
    }
  }
});
test("unpinned file resolutions select current bytes; exact cached snapshots reauthorize and survive deletion", async () => {
  const f = await fixture();
  const signal = new AbortController().signal;
  try {
    assert.equal((await f.source.resolve(f.reference, "one", signal)).digest, f.first.digest);
    await writeFile(f.first.archive, f.second.bytes);
    assert.equal((await f.source.resolve(f.reference, "one", signal)).digest, f.second.digest);
    await assert.rejects(
      f.source.resolve({ ...f.reference, digest: `sha256:${"0".repeat(64)}` }, "one", signal),
      /digest/,
    );
    await rm(f.first.archive);
    const before = f.counts().authorizationCalls;
    assert.equal(
      (await f.source.resolve({ ...f.reference, digest: f.first.digest }, "one", signal)).digest,
      f.first.digest,
    );
    assert.equal(f.counts().authorizationCalls, before + 1);
    await assert.rejects(f.source.resolve(f.reference, "one", signal), /file_missing/);
    await assert.rejects(
      f.source.resolve({ ...f.reference, digest: f.first.digest }, "other", signal),
      /denied/,
    );
    f.deny();
    await assert.rejects(
      f.source.resolve({ ...f.reference, digest: f.first.digest }, "one", signal),
      /denied/,
    );
    assert.equal(f.counts().downloads, 0);
  } finally {
    await f.close();
  }
});
test("absent roots, outside roots, directories, oversize, corruption and missing sources fail explicitly", async () => {
  const f = await fixture();
  const signal = new AbortController().signal;
  const noRoots = createArtifactSource({
    allowedOrigins: [],
    authorize() {
      assert.fail("Denied path must not reach scope callback.");
    },
  });
  try {
    await assert.rejects(noRoots.resolve(f.reference, "one", signal), /outside configured roots/);
    const outside = join(f.root, "outside.tgz");
    await writeFile(outside, f.first.bytes);
    await assert.rejects(
      f.source.resolve({ ...f.reference, url: pathToFileURL(outside).href }, "one", signal),
      /outside/,
    );
    const cases = [
      [join(f.imports, "missing.tgz"), "file_missing"],
      [join(f.imports, "directory"), "file_not_regular"],
      [join(f.imports, "large.tgz"), "file_too_large"],
      [join(f.imports, "corrupt.tgz"), "artifact"],
    ] as const;
    await mkdir(cases[1][0]);
    await writeFile(cases[2][0], "");
    await truncate(cases[2][0], artifactLimits.archiveBytes + 1);
    await writeFile(cases[3][0], "not an archive");
    for (const [path, code] of cases)
      await assert.rejects(
        f.source.resolve({ kind: "checker", url: pathToFileURL(path).href }, "one", signal),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === (code === "artifact" ? "artifact_invalid" : `artifact_${code}`),
      );
    assert.equal(f.counts().downloads, 0);
    assert.throws(
      () =>
        createArtifactSource({
          allowedOrigins: [],
          allowedFileRoots: ["relative"],
          authorize() {},
        }),
      /file_denied/,
    );
  } finally {
    await noRoots.close();
    await f.close();
  }
});
test("junction/symlink ancestors and hard-linked files cannot escape the configured directory", async () => {
  const f = await fixture();
  const signal = new AbortController().signal;
  try {
    const outside = join(f.root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "archive.tgz"), f.first.bytes);
    const linkPath = join(f.imports, "escape");
    await symlink(outside, linkPath, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(
      f.source.resolve(
        { kind: "checker", url: pathToFileURL(join(linkPath, "archive.tgz")).href },
        "one",
        signal,
      ),
      /file_denied/,
    );
    const alias = join(f.imports, "hardlink.tgz");
    await link(f.first.archive, alias);
    await assert.rejects(
      f.source.resolve({ kind: "checker", url: pathToFileURL(alias).href }, "one", signal),
      /file_not_regular/,
    );
    await rm(alias);
    assert.equal(f.counts().downloads, 0);
  } finally {
    await f.close();
  }
});
test("persisted Prepared executes the original file bytes after replacement/removal and still checks restore scope", async () => {
  const f = await fixture();
  const type = createCheckTaskType({ source: f.source, directory: join(f.root, "workers") });
  const context = {
    type: type.type,
    version: type.version,
    environment: type.environment,
    scope: "one",
  };
  try {
    const prepared = await type.prepare(
      { checker: f.reference, subject: {} },
      {
        signal: new AbortController().signal,
        deadlineAt: new Date(Date.now() + 20000).toISOString(),
        context,
      },
    );
    const restored = type.validatePrepared(JSON.parse(JSON.stringify(prepared)));
    await rename(f.first.archive, join(f.imports, "moved.tgz"));
    await writeFile(f.first.archive, f.second.bytes);
    await rm(f.first.archive);
    const outcomes: unknown[] = [];
    const tracking = await type.execute(restored, {
      signal: new AbortController().signal,
      context,
      authorizeReplacement: () => false,
      start: () => ({
        runId: newId(),
        generation: newId(),
        startedAt: new Date().toISOString(),
        progress() {},
        complete(value) {
          outcomes.push(value);
        },
        fail(value) {
          outcomes.push(value);
        },
      }),
    });
    await tracking.finished;
    assert.deepEqual(outcomes, [
      { ok: false, problems: [{ kind: "internal", id: "bad", parameters: { name: "first" } }] },
    ]);
    const revokedSource = createArtifactSource({
      allowedOrigins: [],
      authorize() {
        assert.fail("Revoked roots must reject before scope callback.");
      },
    });
    const revokedType = createCheckTaskType({
      source: revokedSource,
      directory: join(f.root, "revoked-workers"),
    });
    try {
      await assert.rejects(
        revokedType.execute(restored, {
          signal: new AbortController().signal,
          context,
          authorizeReplacement: () => false,
          start() {
            throw new Error("Revoked root must not start.");
          },
        }),
        /outside configured roots/,
      );
    } finally {
      await revokedType.close();
      await revokedSource.close();
    }
    f.deny();
    await assert.rejects(
      type.execute(restored, {
        signal: new AbortController().signal,
        context,
        authorizeReplacement: () => false,
        start() {
          throw new Error("Denied restore must not start.");
        },
      }),
      /denied/,
    );
  } finally {
    await type.close();
    await f.close();
  }
});
