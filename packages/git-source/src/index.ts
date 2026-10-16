import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Schedule, type Scope, Stream, SubscriptionRef } from "@potential-guide/effects";

export interface GitSourceSpec {
  readonly repository: string;
  readonly revision:
    | { readonly type: "commit"; readonly value: string }
    | { readonly type: "ref"; readonly value: string };
  readonly refresh:
    | { readonly type: "once" }
    | { readonly type: "poll"; readonly intervalMs: number };
}

export type GitSourceErrorCode =
  | "invalid-spec"
  | "command"
  | "invalid-path"
  | "not-found"
  | "unsupported-entry"
  | "closed";

export class GitSourceError extends Error {
  readonly _tag = "GitSourceError";
  constructor(
    readonly code: GitSourceErrorCode,
    readonly operation: string,
    message: string,
    readonly exitCode?: number,
  ) {
    super(message);
    this.name = "GitSourceError";
  }
}

export interface GitCommand {
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly operation: string;
}

export interface GitSourceEnvironment {
  /** Effect interruption must terminate the command and wait for its resources to close. */
  readonly runGit?: (command: GitCommand) => Effect.Effect<Uint8Array, GitSourceError>;
  readonly cacheDirectory?: string;
  /** Local credentials/configuration are never stored in GitSourceSpec or diagnostics. */
  readonly environment?: NodeJS.ProcessEnv;
}

export interface GitDirectoryEntry {
  readonly name: string;
  readonly kind: "file" | "directory" | "symlink" | "submodule";
}

export interface GitSnapshot {
  readonly repository: string;
  readonly commit: string;
  readonly readFile: (path: string) => Effect.Effect<Uint8Array, GitSourceError>;
  readonly readText: (path: string) => Effect.Effect<string, GitSourceError>;
  readonly readDirectory: (
    path?: string,
  ) => Effect.Effect<readonly GitDirectoryEntry[], GitSourceError>;
}

export type GitSourceState =
  | { readonly state: "initial" }
  | { readonly state: "ready"; readonly snapshot: GitSnapshot }
  | { readonly state: "failed"; readonly error: GitSourceError };

export function validateGitSourceSpec(input: unknown): readonly string[] {
  if (input === null || typeof input !== "object") return ["Expected a Git source object."];
  const issues: string[] = [];
  if (
    !("repository" in input) ||
    typeof input.repository !== "string" ||
    !validRepository(input.repository)
  ) {
    issues.push(
      "repository must be a local absolute path or a credential-free https, ssh or file URL.",
    );
  }
  if (!("revision" in input) || input.revision === null || typeof input.revision !== "object") {
    issues.push("revision must select a ref or full commit hash.");
  } else {
    const revision = input.revision;
    if (Object.keys(revision).some((key) => !["type", "value"].includes(key))) {
      issues.push("revision accepts only type and value.");
    }
    if (!("type" in revision) || !("value" in revision) || typeof revision.value !== "string") {
      issues.push("revision requires type and value.");
    } else if (revision.type === "commit") {
      if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(revision.value)) {
        issues.push("commit must be a full hexadecimal object ID.");
      }
    } else if (revision.type !== "ref" || !validRef(revision.value)) {
      issues.push("ref must be a valid Git ref name, not a revision expression.");
    }
  }
  if (!("refresh" in input) || input.refresh === null || typeof input.refresh !== "object") {
    issues.push("refresh must select once or poll.");
  } else if (
    !("type" in input.refresh) ||
    (input.refresh.type !== "once" && input.refresh.type !== "poll")
  ) {
    issues.push("refresh must select once or poll.");
  } else if (
    input.refresh.type === "poll" &&
    (!("intervalMs" in input.refresh) ||
      typeof input.refresh.intervalMs !== "number" ||
      !Number.isSafeInteger(input.refresh.intervalMs) ||
      input.refresh.intervalMs <= 0)
  ) {
    issues.push("poll intervalMs must be a positive safe integer.");
  }
  if ("refresh" in input && input.refresh !== null && typeof input.refresh === "object") {
    const allowed =
      "type" in input.refresh && input.refresh.type === "poll" ? ["type", "intervalMs"] : ["type"];
    if (Object.keys(input.refresh).some((key) => !allowed.includes(key))) {
      issues.push("refresh accepts only its type and poll intervalMs.");
    }
  }
  if (Object.keys(input).some((key) => !["repository", "revision", "refresh"].includes(key))) {
    issues.push("Git source accepts only repository, revision and refresh.");
  }
  return issues;
}

export function makeGitSourceSpec(spec: GitSourceSpec): GitSourceSpec {
  const issues = validateGitSourceSpec(spec);
  if (issues.length > 0) throw new GitSourceError("invalid-spec", "validate", issues.join(" "));
  return Object.freeze({
    repository: spec.repository,
    revision: Object.freeze({ ...spec.revision }),
    refresh: Object.freeze({ ...spec.refresh }),
  });
}

function hasControlCharacters(value: string): boolean {
  return [...value].some(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
}

function validRepository(repository: string): boolean {
  if (!repository || hasControlCharacters(repository)) return false;
  if (isAbsolute(repository) && !repository.startsWith("\\\\")) return true;
  try {
    const url = new URL(repository);
    if (url.protocol === "file:") fileURLToPath(url);
    return (
      ["https:", "ssh:", "file:"].includes(url.protocol) &&
      !url.password &&
      (url.protocol === "ssh:" || !url.username) &&
      !url.search &&
      !url.hash &&
      (url.protocol === "file:"
        ? url.hostname === "" || url.hostname === "localhost"
        : url.hostname.length > 0)
    );
  } catch {
    return false;
  }
}

function validRef(ref: string): boolean {
  return (
    ref.length > 0 &&
    ref !== "@" &&
    !ref.startsWith("-") &&
    !hasControlCharacters(ref) &&
    !/[ ~^:?*[\]\\]/.test(ref) &&
    !ref.includes("..") &&
    !ref.includes("@{") &&
    !ref.includes("//") &&
    ref
      .split("/")
      .every(
        (part) =>
          part.length > 0 &&
          !part.startsWith(".") &&
          !part.endsWith(".") &&
          !part.endsWith(".lock"),
      )
  );
}

/** Spawn arguments are never interpreted by a shell. Diagnostics intentionally omit Git stderr. */
export function runGitCommand(
  command: GitCommand,
  environment?: NodeJS.ProcessEnv,
): Effect.Effect<Uint8Array, GitSourceError> {
  return Effect.callback((resume, signal) => {
    const args =
      process.platform === "win32"
        ? ["-c", "core.longpaths=true", ...command.args]
        : [...command.args];
    const child = spawn("git", args, {
      ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
      env: { ...process.env, ...environment, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    const closed = new Promise<void>((resolve) => {
      child.once("close", () => resolve());
    });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64 * 1024 * 1024) {
        failed = true;
        child.kill("SIGKILL");
      } else {
        chunks.push(chunk);
      }
    });
    child.stderr.resume();
    child.once("error", () => {
      failed = true;
    });
    child.once("close", (code) => {
      if (signal.aborted) return;
      if (failed || code !== 0) {
        resume(
          Effect.fail(
            new GitSourceError(
              "command",
              command.operation,
              failed
                ? `Git ${command.operation} could not execute or exceeded the 64 MiB output limit (exit code: ${code ?? "unavailable"}).`
                : `Git ${command.operation} failed (exit code: ${code ?? "unavailable"}).`,
              code ?? undefined,
            ),
          ),
        );
      } else {
        resume(Effect.succeed(Buffer.concat(chunks)));
      }
    });
    return Effect.promise(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await closed;
    });
  });
}

interface RepositoryLease {
  readonly directory: string;
  readonly isOpen: () => boolean;
  readonly run: (
    operation: string,
    args: readonly string[],
  ) => Effect.Effect<Uint8Array, GitSourceError>;
}

function acquireRepository(environment: GitSourceEnvironment, spec: GitSourceSpec) {
  return Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const cache = resolve(environment.cacheDirectory ?? join(process.cwd(), ".cache"));
          await mkdir(cache, { recursive: true });
          return mkdtemp(join(cache, "potential-guide-git-"));
        },
        catch: () => new GitSourceError("command", "cache", "Could not create Git cache."),
      }),
      (root) =>
        Effect.promise(() =>
          rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }),
        ),
    );
    let open = true;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        open = false;
      }),
    );
    const directory = join(root, "repository.git");
    const execute =
      environment.runGit ??
      ((command: GitCommand) => runGitCommand(command, environment.environment));
    const repository = spec.repository.startsWith("file:")
      ? fileURLToPath(spec.repository)
      : spec.repository;
    yield* execute({
      operation: "clone",
      args: ["clone", "--bare", "--no-hardlinks", "--dissociate", "--", repository, directory],
    });
    return {
      directory,
      isOpen: () => open,
      run: (operation: string, args: readonly string[]) =>
        // Explicit selection respects safe.bareRepository=explicit without relaxing Git policy.
        execute({ operation, args: ["--git-dir", directory, ...args], cwd: directory }),
    } satisfies RepositoryLease;
  });
}

function resolveSnapshot(lease: RepositoryLease, spec: GitSourceSpec) {
  return Effect.gen(function* () {
    const repository = spec.repository.startsWith("file:")
      ? fileURLToPath(spec.repository)
      : spec.repository;
    yield* lease.run("fetch", [
      "fetch",
      "--no-tags",
      "--force",
      "--",
      repository,
      spec.revision.value,
    ]);
    const commit = Buffer.from(
      yield* lease.run("resolve", [
        "rev-parse",
        "--verify",
        "--end-of-options",
        "FETCH_HEAD^{commit}",
      ]),
    )
      .toString("utf8")
      .trim();
    if (
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit) ||
      (spec.revision.type === "commit" && commit !== spec.revision.value.toLowerCase())
    ) {
      return yield* Effect.fail(
        new GitSourceError("command", "resolve", "Git returned an unexpected commit."),
      );
    }
    yield* lease.run("pin", ["update-ref", `refs/potential-guide/snapshots/${commit}`, commit]);
    return snapshotFromCommit(lease, spec.repository, commit);
  });
}

interface TreeEntry extends GitDirectoryEntry {
  readonly objectId: string;
}

function pathSegments(path: string): Effect.Effect<readonly string[], GitSourceError> {
  if (path === "" || path === ".") return Effect.succeed([]);
  const segments = path.split("/");
  if (
    hasControlCharacters(path) ||
    /[\\:]/.test(path) ||
    segments.some((part) => !part || part === "." || part === "..")
  ) {
    return Effect.fail(
      new GitSourceError(
        "invalid-path",
        "read",
        "Expected a relative repository path without traversal.",
      ),
    );
  }
  return Effect.succeed(segments);
}

function snapshotFromCommit(
  lease: RepositoryLease,
  repository: string,
  commit: string,
): GitSnapshot {
  const trees = new Map<string, readonly TreeEntry[]>();
  const tree = (objectId: string): Effect.Effect<readonly TreeEntry[], GitSourceError> =>
    Effect.gen(function* () {
      if (!lease.isOpen()) {
        return yield* Effect.fail(
          new GitSourceError("closed", "read", "Git snapshot scope has closed."),
        );
      }
      const cached = trees.get(objectId);
      if (cached !== undefined) return cached;
      const bytes = yield* lease.run("list", ["ls-tree", "-z", objectId]);
      const entries = yield* Effect.try({
        try: () => {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          return text
            .split("\0")
            .filter(Boolean)
            .map((record): TreeEntry => {
              const match = /^(\d{6}) (blob|tree|commit) ([0-9a-f]+)\t([\s\S]*)$/.exec(record);
              if (!match?.[1] || !match[3] || match[4] === undefined)
                throw new Error("Invalid tree.");
              const kind =
                match[1] === "120000"
                  ? "symlink"
                  : match[1] === "160000"
                    ? "submodule"
                    : match[2] === "tree"
                      ? "directory"
                      : "file";
              return { name: match[4], kind, objectId: match[3] };
            });
        },
        catch: () =>
          new GitSourceError("command", "list", "Git returned an invalid or non-UTF-8 tree."),
      });
      trees.set(objectId, entries);
      return entries;
    });
  const lookup = (path: string) =>
    Effect.gen(function* () {
      const segments = yield* pathSegments(path);
      let entry: TreeEntry = { name: "", kind: "directory", objectId: commit };
      for (const segment of segments) {
        if (entry.kind !== "directory") {
          return yield* Effect.fail(
            new GitSourceError(
              "unsupported-entry",
              "read",
              "Cannot traverse a non-directory Git entry.",
            ),
          );
        }
        const found = (yield* tree(entry.objectId)).find((candidate) => candidate.name === segment);
        if (!found)
          return yield* Effect.fail(
            new GitSourceError("not-found", "read", "Repository path does not exist."),
          );
        entry = found;
      }
      return entry;
    });
  const readFile = (path: string) =>
    Effect.gen(function* () {
      const entry = yield* lookup(path);
      if (entry.kind !== "file") {
        return yield* Effect.fail(
          new GitSourceError(
            "unsupported-entry",
            "read",
            "Only regular Git blobs can be read as files.",
          ),
        );
      }
      return yield* lease.run("read", ["cat-file", "blob", entry.objectId]);
    });
  return Object.freeze({
    repository,
    commit,
    readFile,
    readText: (path: string) =>
      readFile(path).pipe(
        Effect.flatMap((bytes) =>
          Effect.try({
            try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            catch: () =>
              new GitSourceError("unsupported-entry", "read", "File is not valid UTF-8."),
          }),
        ),
      ),
    readDirectory: (path = "") =>
      Effect.gen(function* () {
        const entry = yield* lookup(path);
        if (entry.kind !== "directory") {
          return yield* Effect.fail(
            new GitSourceError("unsupported-entry", "list", "Expected a Git directory."),
          );
        }
        return (yield* tree(entry.objectId)).map(({ name, kind }) => ({ name, kind }));
      }),
  });
}

/** Snapshots remain usable until the caller's Scope closes. No shared checkout is read. */
export function loadGitSnapshot(
  environment: GitSourceEnvironment,
  spec: GitSourceSpec,
): Effect.Effect<GitSnapshot, GitSourceError, Scope.Scope> {
  return Effect.gen(function* () {
    const validated = yield* Effect.try({
      try: () => makeGitSourceSpec(spec),
      catch: (error) =>
        error instanceof GitSourceError
          ? error
          : new GitSourceError("invalid-spec", "validate", "Invalid Git source."),
    });
    const lease = yield* acquireRepository(environment, validated);
    return yield* resolveSnapshot(lease, validated);
  });
}

/** Scope owns the worker and cache. The ref exposes both current state and native changes. */
export function watchGitSnapshot(
  environment: GitSourceEnvironment,
  spec: GitSourceSpec,
): Effect.Effect<SubscriptionRef.SubscriptionRef<GitSourceState>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const state = yield* SubscriptionRef.make<GitSourceState>({ state: "initial" });
    const worker = Effect.gen(function* () {
      const validated = yield* Effect.try({
        try: () => makeGitSourceSpec(spec),
        catch: (error) =>
          error instanceof GitSourceError
            ? error
            : new GitSourceError("invalid-spec", "validate", "Invalid Git source."),
      });
      const lease = yield* acquireRepository(environment, validated);
      const sample = resolveSnapshot(lease, validated).pipe(
        Effect.match({
          onFailure: (error): GitSourceState => ({ state: "failed", error }),
          onSuccess: (snapshot): GitSourceState => ({ state: "ready", snapshot }),
        }),
      );
      const snapshots =
        validated.refresh.type === "once"
          ? Stream.fromEffect(sample)
          : Stream.fromEffectSchedule(sample, Schedule.spaced(validated.refresh.intervalMs));
      yield* Stream.runForEach(snapshots, (sample) => SubscriptionRef.set(state, sample));
      // A once-loaded snapshot must outlive its worker's last publication.
      yield* Effect.never;
    }).pipe(Effect.catch((error) => SubscriptionRef.set(state, { state: "failed", error })));
    yield* Effect.forkScoped(Effect.scoped(worker));
    return state;
  });
}
