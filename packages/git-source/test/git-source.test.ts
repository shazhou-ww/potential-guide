import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Effect, Exit, Stream, SubscriptionRef, startEffect } from "@potential-guide/effects";
import {
  type GitCommand,
  type GitSnapshot,
  GitSourceError,
  type GitSourceSpec,
  type GitSourceState,
  loadGitSnapshot,
  makeGitSourceSpec,
  runGitCommand,
  validateGitSourceSpec,
  watchGitSnapshot,
} from "../src/index.js";

const execute = promisify(execFile);
async function git(repository: string, ...args: string[]) {
  return (await execute("git", ["-C", repository, ...args], { encoding: "utf8" })).stdout.trim();
}

async function testDirectory(prefix: string) {
  const cache = resolve(".cache");
  await mkdir(cache, { recursive: true });
  return mkdtemp(join(cache, prefix));
}

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await testDirectory("git-source-test-");
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "Git Source Test");
  await git(root, "config", "user.email", "git-source@example.test");
  await writeFile(join(root, "definition.txt"), "first");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "first");
  const first = await git(root, "rev-parse", "HEAD");
  const advance = async () => {
    await writeFile(join(root, "definition.txt"), "second");
    await git(root, "commit", "-am", "second");
    return git(root, "rev-parse", "HEAD");
  };
  return { root, first, advance };
}

function source(repository: string): GitSourceSpec {
  return makeGitSourceSpec({
    repository,
    revision: { type: "ref", value: "refs/heads/main" },
    refresh: { type: "once" },
  });
}

test("deep consumer caches support commit pinning beyond Windows MAX_PATH", {
  timeout: 20_000,
}, async (t) => {
  const repo = await fixture(t);
  const cacheRoot = await testDirectory("git-source-long-cache-");
  t.after(() => rm(cacheRoot, { recursive: true, force: true }));
  const cacheDirectory = join(cacheRoot, "x".repeat(Math.max(1, 170 - cacheRoot.length - 1)));
  let pinPathLength = 0;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const snapshot = yield* loadGitSnapshot(
          {
            cacheDirectory,
            runGit: (command) => {
              if (command.operation === "pin") {
                const directory = command.args[1];
                const reference = command.args[3];
                assert.ok(directory && reference);
                pinPathLength = join(directory, `${reference}.lock`).length;
              }
              return runGitCommand(command);
            },
          },
          { ...source(pathToFileURL(repo.root).href), revision: { type: "ref", value: "HEAD" } },
        );
        assert.equal(snapshot.commit, repo.first);
        assert.equal(yield* snapshot.readText("definition.txt"), "first");
      }),
    ),
  );
  assert.ok(pinPathLength > 260, `Expected a long commit-pin path, received ${pinPathLength}.`);
});

function nextState(
  state: SubscriptionRef.SubscriptionRef<GitSourceState>,
  predicate: (sample: GitSourceState) => boolean,
) {
  return SubscriptionRef.changes(state).pipe(
    Stream.filter(predicate),
    Stream.take(1),
    Stream.runCollect,
    Effect.map((values) => {
      const sample = values[0];
      assert.ok(sample);
      return sample;
    }),
    Effect.timeout(10_000),
  );
}

test("fixed commit, moved ref and old snapshots all read immutable objects, not checkout", {
  timeout: 20_000,
}, async (t) => {
  const repo = await fixture(t);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const original = yield* loadGitSnapshot(
          {},
          {
            ...source(repo.root),
            revision: { type: "commit", value: repo.first },
          },
        );
        assert.equal(original.commit, repo.first);
        assert.equal(yield* original.readText("definition.txt"), "first");
        const second = yield* Effect.promise(repo.advance);
        yield* Effect.promise(() =>
          writeFile(join(repo.root, "definition.txt"), "uncommitted checkout content"),
        );
        const latest = yield* loadGitSnapshot({}, source(repo.root));
        assert.equal(latest.commit, second);
        assert.equal(yield* latest.readText("definition.txt"), "second");
        assert.equal(yield* original.readText("definition.txt"), "first");
        assert.deepEqual(yield* original.readDirectory(), [
          { name: "definition.txt", kind: "file" },
        ]);
        assert.equal(
          Buffer.from(yield* original.readFile("definition.txt")).toString("utf8"),
          "first",
        );
      }),
    ),
  );
});

test("relative paths are contained and symlinks are never followed", {
  timeout: 20_000,
}, async (t) => {
  const repo = await fixture(t);
  await writeFile(join(repo.root, "target.txt"), "../outside-secret");
  const linkBlob = await git(repo.root, "hash-object", "-w", "target.txt");
  await git(repo.root, "update-index", "--add", "--cacheinfo", "120000", linkBlob, "link");
  await git(repo.root, "commit", "-m", "add symlink object without OS symlink privilege");
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const snapshot = yield* loadGitSnapshot({}, source(repo.root));
        for (const path of [
          "../secret",
          "/secret",
          "C:\\secret",
          "\\\\host\\secret",
          "a/../definition.txt",
          "a//b",
          "a\\b",
          "a\0b",
        ]) {
          const result = yield* snapshot.readFile(path).pipe(
            Effect.match({
              onFailure: (error) => error.code,
              onSuccess: () => "unexpected-success",
            }),
          );
          assert.equal(result, "invalid-path", path);
        }
        for (const path of ["link", "link/secret"]) {
          const result = yield* snapshot.readFile(path).pipe(
            Effect.match({
              onFailure: (error) => error.code,
              onSuccess: () => "unexpected-success",
            }),
          );
          assert.equal(result, "unsupported-entry");
        }
        assert.ok(
          (yield* snapshot.readDirectory()).some(
            (entry) => entry.name === "link" && entry.kind === "symlink",
          ),
        );
        assert.equal(
          yield* snapshot.readFiles().pipe(
            Stream.runCollect,
            Effect.match({
              onFailure: (error) => error.code,
              onSuccess: () => "unexpected-success",
            }),
          ),
          "unsupported-entry",
        );
        const missing = yield* snapshot.readText("absent").pipe(
          Effect.match({
            onFailure: (error) => error.code,
            onSuccess: () => "unexpected-success",
          }),
        );
        assert.equal(missing, "not-found");
      }),
    ),
  );
});

test("watch exposes an initial current value, follows ref changes, and keeps old snapshots stable", {
  timeout: 20_000,
}, async (t) => {
  const repo = await fixture(t);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* watchGitSnapshot(
          {},
          {
            ...source(repo.root),
            refresh: { type: "poll", intervalMs: 10 },
          },
        );
        assert.deepEqual(yield* SubscriptionRef.get(state), { state: "initial" });
        const first = yield* nextState(state, (sample) => sample.state === "ready");
        assert.equal(first.state, "ready");
        if (first.state !== "ready") throw new Error("Expected ready snapshot.");
        const secondCommit = yield* Effect.promise(repo.advance);
        const second = yield* nextState(
          state,
          (sample) => sample.state === "ready" && sample.snapshot.commit === secondCommit,
        );
        assert.equal(second.state, "ready");
        if (second.state !== "ready") throw new Error("Expected updated snapshot.");
        assert.equal(yield* second.snapshot.readText("definition.txt"), "second");
        assert.equal(yield* first.snapshot.readText("definition.txt"), "first");
      }),
    ),
  );
});

test("load and watch propagate source failures explicitly; invalid specs never run commands", {
  timeout: 20_000,
}, async (t) => {
  const repo = await fixture(t);
  const invalid = [
    {},
    { repository: "https://user:secret@example.test/repo" },
    { ...source(repo.root), revision: { type: "ref", value: "--upload-pack=bad" } },
    { ...source(repo.root), revision: { type: "ref", value: "main:other" } },
    { ...source(repo.root), refresh: { type: "poll", intervalMs: 0 } },
    { ...source(repo.root), credentials: "secret" },
  ];
  for (const spec of invalid) assert.ok(validateGitSourceSpec(spec).length > 0);
  assert.ok(
    validateGitSourceSpec({
      ...source(repo.root),
      revision: { type: "ref", value: "main", credentials: "secret" },
    }).length > 0,
  );
  assert.ok(
    validateGitSourceSpec({
      ...source(repo.root),
      refresh: { type: "once", credentials: "secret" },
    }).length > 0,
  );
  assert.ok(
    validateGitSourceSpec({
      ...source(repo.root),
      repository: "file:///C:/invalid%2Fpath",
    }).length > 0,
  );
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const spec: GitSourceSpec = {
          ...source(repo.root),
          revision: { type: "ref", value: "missing-ref" },
        };
        const result = yield* loadGitSnapshot({}, spec).pipe(
          Effect.match({
            onFailure: (error) => error,
            onSuccess: () => undefined,
          }),
        );
        assert.ok(result instanceof GitSourceError);
        assert.equal(result.operation, "fetch");
        const state = yield* watchGitSnapshot({}, spec);
        const sample = yield* nextState(state, (sample) => sample.state === "failed");
        assert.equal(sample.state, "failed");
        assert.equal(Object.hasOwn(sample, "snapshot"), false);
      }),
    ),
  );
});

test("snapshot scope releases its cache and later reads fail explicitly", {
  timeout: 20_000,
}, async (t) => {
  const repo = await fixture(t);
  const cache = await testDirectory("git-source-cache-test-");
  t.after(() => rm(cache, { recursive: true, force: true }));
  let snapshot: GitSnapshot | undefined;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        snapshot = yield* loadGitSnapshot({ cacheDirectory: cache }, source(repo.root));
        assert.equal((yield* Effect.promise(() => readdir(cache))).length, 1);
      }),
    ),
  );
  assert.deepEqual(await readdir(cache), []);
  assert.ok(snapshot);
  const result = await Effect.runPromise(
    snapshot.readText("definition.txt").pipe(
      Effect.match({
        onFailure: (error) => error.code,
        onSuccess: () => "unexpected-success",
      }),
    ),
  );
  assert.equal(result, "closed");
});

test("cancelling acquisition interrupts commands and releases the temporary cache before exit", {
  timeout: 20_000,
}, async (t) => {
  const repo = await fixture(t);
  const cache = await testDirectory("git-source-cancel-test-");
  t.after(() => rm(cache, { recursive: true, force: true }));
  let started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  let aborted = false;
  let cleaned = false;
  const commands: GitCommand[] = [];
  const handle = startEffect(
    Effect.scoped(
      loadGitSnapshot(
        {
          cacheDirectory: cache,
          runGit: (command) =>
            Effect.callback<Uint8Array, GitSourceError>((_resume, signal) => {
              commands.push(command);
              signal.addEventListener(
                "abort",
                () => {
                  aborted = true;
                },
                { once: true },
              );
              started();
              return Effect.sync(() => {
                cleaned = true;
              });
            }),
        },
        source(repo.root),
      ),
    ),
  );
  t.after(async () => {
    handle.cancel();
    await handle.exit();
  });
  await running;
  handle.cancel();
  assert.ok(Exit.hasInterrupts(await handle.exit()));
  assert.ok(aborted && cleaned);
  assert.deepEqual(await readdir(cache), []);
  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.operation, "clone");
});

test("native git runner reports spawn and exit failures without success-shaped fallback", async () => {
  const error = await Effect.runPromise(
    runGitCommand({
      operation: "invalid-command",
      args: ["not-a-real-git-command"],
    }).pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => undefined })),
  );
  assert.ok(error instanceof GitSourceError);
  assert.equal(error.code, "command");
  assert.equal(error.operation, "invalid-command");
  assert.ok(error.exitCode && error.exitCode > 0);
  assert.match(error.message, /invalid-command/);
  assert.match(error.message, /exit code: \d+/);
  assert.equal(error.message.includes("not-a-real-git-command"), false);
});

test("once watcher keeps its snapshot alive until cancellation, then releases cache", {
  timeout: 20_000,
}, async (t) => {
  const repo = await fixture(t);
  const cache = await testDirectory("git-source-once-test-");
  t.after(() => rm(cache, { recursive: true, force: true }));
  let publish!: (snapshot: GitSnapshot) => void;
  const ready = new Promise<GitSnapshot>((resolve) => {
    publish = resolve;
  });
  const handle = startEffect(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* watchGitSnapshot({ cacheDirectory: cache }, source(repo.root));
        const sample = yield* nextState(state, (sample) => sample.state === "ready");
        assert.equal(sample.state, "ready");
        if (sample.state !== "ready") throw new Error("Expected snapshot.");
        assert.equal(yield* sample.snapshot.readText("definition.txt"), "first");
        publish(sample.snapshot);
        yield* Effect.never;
      }),
    ),
  );
  t.after(async () => {
    handle.cancel();
    await handle.exit();
  });
  const snapshot = await ready;
  assert.equal(await Effect.runPromise(snapshot.readText("definition.txt")), "first");
  handle.cancel();
  assert.ok(Exit.hasInterrupts(await handle.exit()));
  assert.deepEqual(await readdir(cache), []);
  assert.equal(
    await Effect.runPromise(
      snapshot.readText("definition.txt").pipe(
        Effect.match({
          onFailure: (error) => error.code,
          onSuccess: () => "unexpected-success",
        }),
      ),
    ),
    "closed",
  );
});

test("snapshot owns its objects even if the local source repository disappears", {
  timeout: 20_000,
}, async (t) => {
  const repo = await fixture(t);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const snapshot = yield* loadGitSnapshot({}, source(repo.root));
        yield* Effect.promise(() => rm(repo.root, { recursive: true }));
        assert.equal(yield* snapshot.readText("definition.txt"), "first");
      }),
    ),
  );
});

test("directory traversal reads tree objects and binary files fail only in text decoding", {
  timeout: 20_000,
}, async (t) => {
  const repo = await fixture(t);
  await mkdir(join(repo.root, "nested"));
  await writeFile(join(repo.root, "nested", "space name.txt"), "nested text");
  await writeFile(join(repo.root, "binary.dat"), Buffer.from([0xff, 0x00, 0x80]));
  await git(repo.root, "add", ".");
  await git(repo.root, "commit", "-m", "nested and binary resources");
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const snapshot = yield* loadGitSnapshot({}, source(repo.root));
        assert.deepEqual(yield* snapshot.readDirectory("nested"), [
          { name: "space name.txt", kind: "file" },
        ]);
        assert.equal(yield* snapshot.readText("nested/space name.txt"), "nested text");
        assert.deepEqual(
          Buffer.from(yield* snapshot.readFile("binary.dat")),
          Buffer.from([0xff, 0x00, 0x80]),
        );
        const failures: readonly Effect.Effect<unknown, GitSourceError>[] = [
          snapshot.readText("binary.dat"),
          snapshot.readFile("nested"),
          snapshot.readDirectory("definition.txt"),
        ];
        for (const effect of failures) {
          assert.equal(
            yield* effect.pipe(
              Effect.match({
                onFailure: (error) => error.code,
                onSuccess: () => "unexpected-success",
              }),
            ),
            "unsupported-entry",
          );
        }
      }),
    ),
  );
});

test("a failed poll is visible and later refresh can recover without corrupting old snapshots", {
  timeout: 20_000,
}, async (t) => {
  const repo = await fixture(t);
  let fetches = 0;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* watchGitSnapshot(
          {
            runGit: (command) => {
              if (command.operation === "fetch" && ++fetches === 2) {
                return Effect.fail(
                  new GitSourceError("command", "fetch", "Simulated transient fetch failure."),
                );
              }
              return runGitCommand(command);
            },
          },
          { ...source(repo.root), refresh: { type: "poll", intervalMs: 10 } },
        );
        const first = yield* nextState(state, (sample) => sample.state === "ready");
        const failed = yield* nextState(state, (sample) => sample.state === "failed");
        assert.equal(failed.state, "failed");
        assert.equal(Object.hasOwn(failed, "snapshot"), false);
        const recovered = yield* nextState(state, (sample) => sample.state === "ready");
        assert.equal(recovered.state, "ready");
        if (first.state !== "ready" || recovered.state !== "ready")
          throw new Error("Expected snapshots.");
        assert.equal(first.snapshot.commit, recovered.snapshot.commit);
        assert.equal(yield* first.snapshot.readText("definition.txt"), "first");
      }),
    ),
  );
  assert.ok(fetches >= 3);
});

test("default cache is project-local and failed acquisition removes only its owned child", async () => {
  let cloneDirectory: string | undefined;
  const error = await Effect.runPromise(
    Effect.scoped(
      loadGitSnapshot(
        {
          runGit: (command) => {
            cloneDirectory = command.args.at(-1);
            return Effect.fail(new GitSourceError("command", "clone", "Simulated clone failure."));
          },
        },
        source(resolve(".")),
      ),
    ).pipe(
      Effect.match({
        onFailure: (error) => error,
        onSuccess: () => undefined,
      }),
    ),
  );
  assert.ok(error instanceof GitSourceError);
  assert.ok(cloneDirectory);
  const ownedCache = dirname(cloneDirectory);
  assert.equal(dirname(ownedCache), resolve(".cache"));
  await assert.rejects(readdir(ownedCache), { code: "ENOENT" });
  assert.ok(Array.isArray(await readdir(resolve(".cache"))));
});

test("tree listings are reused across twenty text files, errors retry and warmed caches respect Scope", {
  timeout: 30_000,
}, async (t) => {
  const repo = await fixture(t);
  await mkdir(join(repo.root, "wiki"));
  const names = Array.from({ length: 20 }, (_, index) => `page-${index}.md`);
  await Promise.all(names.map((name) => writeFile(join(repo.root, "wiki", name), name)));
  await git(repo.root, "add", ".");
  await git(repo.root, "commit", "-m", "twenty text pages");
  const listings: GitCommand[] = [];
  let retained: GitSnapshot | undefined;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const snapshot = yield* loadGitSnapshot(
          {
            runGit: (command) => {
              if (command.operation === "list") {
                listings.push(command);
                if (listings.length === 1) {
                  return Effect.fail(
                    new GitSourceError("command", "list", "Transient listing failure."),
                  );
                }
              }
              return runGitCommand(command);
            },
          },
          source(repo.root),
        );
        retained = snapshot;
        const failed = yield* snapshot.readDirectory().pipe(
          Effect.match({
            onFailure: (error) => error.code,
            onSuccess: () => "unexpected-success",
          }),
        );
        assert.equal(failed, "command");
        for (const name of names) {
          assert.equal(yield* snapshot.readText(`wiki/${name}`), name);
        }
        assert.equal(
          Buffer.from(yield* snapshot.readFile("wiki/page-0.md")).toString("utf8"),
          "page-0.md",
        );
        for (let index = 0; index < 10; index++) {
          assert.equal((yield* snapshot.readDirectory("wiki")).length, 20);
        }
        assert.equal(listings.length, 3); // One failure, then exactly two distinct tree objects.
      }),
    ),
  );
  assert.ok(retained);
  assert.equal(
    await Effect.runPromise(
      retained.readDirectory("wiki").pipe(
        Effect.match({
          onFailure: (error) => error.code,
          onSuccess: () => "unexpected-success",
        }),
      ),
    ),
    "closed",
  );
  assert.equal(listings.length, 3);
});

test("whole snapshots batch hundreds of binary files with bounded Git process counts", {
  timeout: 30_000,
}, async (t) => {
  const repo = await fixture(t);
  const bytes = Buffer.from([0, 10, 13, 255, 0, 65]);
  for (let index = 0; index < 600; index++) {
    const directory = join(repo.root, "nested", `${index}`);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "binary file.dat"), bytes);
  }
  await git(repo.root, "add", ".");
  await git(repo.root, "commit", "-m", "many binary files");
  const operations: string[] = [];
  let retained: GitSnapshot | undefined;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const snapshot = yield* loadGitSnapshot(
          {
            runGit: (command) => {
              operations.push(command.operation);
              return runGitCommand(command);
            },
          },
          source(repo.root),
        );
        retained = snapshot;
        const files = yield* snapshot.readFiles().pipe(Stream.runCollect);
        assert.equal(files.length, 601);
        for (const file of files) {
          assert.deepEqual(
            Buffer.from(file.bytes),
            file.path === "definition.txt" ? Buffer.from("first") : bytes,
          );
        }
        assert.equal(operations.filter((operation) => operation === "list-files").length, 1);
        assert.equal(operations.filter((operation) => operation === "read-batch").length, 3);
        assert.equal(operations.length, 8);
      }),
    ),
  );
  assert.ok(retained);
  const count = operations.length;
  const closed = await Effect.runPromise(
    retained
      .readFiles()
      .pipe(
        Stream.runCollect,
        Effect.match({ onFailure: (error) => error.code, onSuccess: () => "unexpected-success" }),
      ),
  );
  assert.equal(closed, "closed");
  assert.equal(operations.length, count);
});

test("batch reads bound large blobs and reject malformed output without yielding corrupt files", {
  timeout: 30_000,
}, async (t) => {
  const repo = await fixture(t);
  await writeFile(join(repo.root, "large.bin"), Buffer.alloc(9 * 1024 * 1024, 255));
  await writeFile(join(repo.root, "small.bin"), Buffer.from([0, 10, 255]));
  await git(repo.root, "add", ".");
  await git(repo.root, "commit", "-m", "large batch boundary");
  let batches = 0;
  let malformed = false;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const snapshot = yield* loadGitSnapshot(
          {
            runGit: (command) => {
              if (command.operation === "read-batch") {
                batches++;
                if (malformed) return Effect.succeed(Buffer.from("not a blob batch\n"));
              }
              return runGitCommand(command);
            },
          },
          source(repo.root),
        );
        const files = yield* snapshot.readFiles().pipe(Stream.runCollect);
        assert.equal(files.length, 3);
        assert.equal(
          files.find((file) => file.path === "large.bin")?.bytes.length,
          9 * 1024 * 1024,
        );
        assert.equal(batches, 3);
        malformed = true;
        const result = yield* snapshot.readFiles().pipe(
          Stream.runCollect,
          Effect.match({
            onFailure: (error) => error.operation,
            onSuccess: () => "unexpected-success",
          }),
        );
        assert.equal(result, "read-batch");
      }),
    ),
  );
});

test("cancelling a blob batch awaits command cleanup and releases its owned cache", {
  timeout: 30_000,
}, async (t) => {
  const repo = await fixture(t);
  const cache = await testDirectory("git-source-batch-cancel-");
  t.after(() => rm(cache, { recursive: true, force: true }));
  let began!: () => void;
  const running = new Promise<void>((resolve) => {
    began = resolve;
  });
  let cleaned = false;
  const handle = startEffect(
    Effect.scoped(
      Effect.gen(function* () {
        const snapshot = yield* loadGitSnapshot(
          {
            cacheDirectory: cache,
            runGit: (command) =>
              command.operation === "read-batch"
                ? Effect.callback<Uint8Array, GitSourceError>(() => {
                    began();
                    return Effect.sync(() => {
                      cleaned = true;
                    });
                  })
                : runGitCommand(command),
          },
          source(repo.root),
        );
        yield* snapshot.readFiles().pipe(Stream.runCollect);
      }),
    ),
  );
  t.after(async () => {
    handle.cancel();
    await handle.exit();
  });
  await running;
  handle.cancel();
  assert.ok(Exit.isFailure(await handle.exit()));
  assert.equal(cleaned, true);
  assert.deepEqual(await readdir(cache), []);
});

test("file URL repository with a self-referencing origin resolves HEAD and reads committed content", {
  timeout: 20_000,
}, async (t) => {
  const repo = await fixture(t);
  const repository = pathToFileURL(repo.root).href;
  await git(repo.root, "remote", "add", "origin", repository);
  await mkdir(join(repo.root, "guide"));
  await writeFile(join(repo.root, "guide", "objective.yaml"), "id: immutable-pilot\n");
  await git(repo.root, "add", ".");
  await git(repo.root, "commit", "-m", "pilot definition");
  const commit = await git(repo.root, "rev-parse", "HEAD");
  const rootTree = await git(repo.root, "rev-parse", `${commit}^{tree}`);
  const guideTree = await git(repo.root, "rev-parse", `${commit}:guide`);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const snapshot = yield* loadGitSnapshot(
          {},
          {
            repository,
            revision: { type: "ref", value: "HEAD" },
            refresh: { type: "once" },
          },
        );
        assert.equal(snapshot.repository, repository);
        assert.equal(snapshot.commit, commit);
        assert.equal(yield* snapshot.treeOid(), rootTree);
        assert.equal(yield* snapshot.treeOid("."), rootTree);
        assert.equal(yield* snapshot.treeOid("guide"), guideTree);
        assert.ok(Exit.isFailure(yield* Effect.exit(snapshot.treeOid("guide/objective.yaml"))));
        assert.ok(Exit.isFailure(yield* Effect.exit(snapshot.treeOid("../guide"))));
        assert.equal(yield* snapshot.readText("guide/objective.yaml"), "id: immutable-pilot\n");
      }),
    ),
  );
});
