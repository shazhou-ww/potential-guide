import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { CliError } from "@potential-guide/cli-core";
import { Cause, Effect, Exit, Scope, Stream } from "@potential-guide/effects";
import { type GitSnapshot, loadGitSnapshot } from "@potential-guide/git-source";
import {
  type CheckResult,
  canonicalObjectiveUri,
  createProcessCheckProbe,
  type Envelope,
  type GitPilotSource,
  loadPilotSpec,
  type PageResource,
  type PilotRuntime,
  type PilotSpec,
  type ResourceResolver,
  RunEvidence,
  validateGitPilotSource,
} from "@potential-guide/objective-pilot";

const execute = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execute("git", ["--no-pager", "-C", cwd, ...args], {
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return result.stdout.trim();
}

function repositoryUri(value: string): string {
  const url = new URL(value);
  if (
    !["https:", "file:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new PilotSourceError("Pilot origin must be a credential-free HTTPS or file Git URL.");
  return url.href;
}

class PilotSourceError extends CliError {
  constructor(message: string, cause?: unknown) {
    super(message, 2, "pilot-error");
    if (cause !== undefined) this.cause = cause;
  }
}

async function afterCleanup<T>(
  operation: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  let outcome: { value: T } | { error: unknown };
  try {
    outcome = { value: await operation() };
  } catch (error) {
    outcome = { error };
  }
  try {
    await cleanup();
  } catch (cleanupError) {
    if ("error" in outcome) {
      const combined = new AggregateError(
        [outcome.error, cleanupError],
        `${String(outcome.error)}; cleanup failed: ${String(cleanupError)}`,
        { cause: outcome.error },
      );
      if (outcome.error instanceof CliError) {
        const error = new CliError(
          combined.message,
          outcome.error.exitCode,
          outcome.error.status,
          outcome.error.guidance,
        );
        error.cause = combined;
        throw error;
      }
      throw combined;
    }
    throw cleanupError;
  }
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

async function bindPilot<T>(
  location: string,
  cwd: string,
  revision: string | undefined,
  use: (spec: PilotSpec, runtime: PilotRuntime) => Promise<T>,
  options: PilotSourceOptions,
  evidence: RunEvidence | undefined,
): Promise<T> {
  const preparationTimeoutMs = options.preparationTimeoutMs ?? 60_000;
  if (
    !Number.isSafeInteger(preparationTimeoutMs) ||
    preparationTimeoutMs < 1 ||
    preparationTimeoutMs > 2_147_483_647
  )
    throw new PilotSourceError("preparationTimeoutMs must be a positive safe timer duration.");
  let objectiveUri: string;
  let repository: string;
  let snapshotRepository: string;
  let commitOrRef: string;
  if (location.startsWith("git+")) {
    const uri = new URL(location);
    const origin = new URL(uri);
    origin.hash = "";
    repository = repositoryUri(origin.href.slice(4));
    objectiveUri = canonicalObjectiveUri(uri.href);
    snapshotRepository = repository;
    commitOrRef = revision ?? "HEAD";
  } else {
    let path = await realpath(resolve(cwd, location));
    if (!(await stat(path)).isDirectory()) {
      if (basename(path) !== "pilot.yaml")
        throw new PilotSourceError(
          "Pilot sources must be directories; only an exact pilot.yaml entry can be converted at the CLI boundary.",
        );
      path = dirname(path);
    }
    const directory = path;
    const root = await realpath(await git(directory, "rev-parse", "--show-toplevel"));
    if (await git(root, "status", "--porcelain", "--untracked-files=all"))
      throw new PilotSourceError(
        "Pilot repository is dirty or contains uncommitted files. Commit the Pilot before probing or regulating.",
      );
    repository = repositoryUri(await git(root, "remote", "get-url", "origin"));
    snapshotRepository = pathToFileURL(root).href;
    if (revision !== undefined && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(revision)) {
      throw new PilotSourceError("Local Pilot revisions must be full commit hashes, not refs.");
    }
    commitOrRef = revision ?? (await git(root, "rev-parse", "HEAD"));
    const pathInRepository = relative(root, path).split("\\").join("/");
    if (pathInRepository.startsWith("../") || isAbsolute(pathInRepository))
      throw new PilotSourceError("Pilot manifest must be inside its Git repository.");
    objectiveUri = canonicalObjectiveUri(
      `git+${repository}#${pathInRepository.split("/").map(encodeURIComponent).join("/")}`,
    );
  }
  const parentDirectory = process.env.PGUIDE_PROBE_TEMP_DIR;
  if (
    options.cacheDirectory === undefined &&
    parentDirectory !== undefined &&
    !isAbsolute(parentDirectory)
  )
    throw new PilotSourceError("Invalid PGUIDE_PROBE_TEMP_DIR runtime metadata.");
  // Nested CLIs stay inside their owning check, without repeating deep fixture cwd paths.
  const scratch =
    options.cacheDirectory ??
    (parentDirectory === undefined
      ? resolve(".cache", "pguide-sources")
      : join(parentDirectory, "sources"));
  await mkdir(scratch, { recursive: true });
  const cache = await mkdtemp(join(scratch, "pguide-runtime-"));
  return afterCleanup(
    async () => {
      const preparationStarted = performance.now();
      const preparation = new AbortController();
      const pendingReads = new Set<Promise<unknown>>();
      function read<A, E>(effect: Effect.Effect<A, E>, signal = preparation.signal): Promise<A> {
        const pending = Effect.runPromise(effect, {
          signal: AbortSignal.any([signal, preparation.signal]),
        });
        pendingReads.add(pending);
        void pending.then(
          () => pendingReads.delete(pending),
          () => pendingReads.delete(pending),
        );
        return pending;
      }
      let preparationTimedOut = false;
      const timer = setTimeout(() => {
        preparationTimedOut = true;
        preparation.abort(
          new Error(`Pilot source preparation timed out after ${preparationTimeoutMs}ms.`),
        );
      }, preparationTimeoutMs);
      const result = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const scope = yield* Effect.scope;
            const snapshot = yield* loadGitSnapshot(
              { cacheDirectory: cache },
              {
                repository: snapshotRepository,
                revision: /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(commitOrRef)
                  ? { type: "commit", value: commitOrRef }
                  : { type: "ref", value: commitOrRef },
                refresh: { type: "once" },
              },
            );
            type Source = { snapshot: GitSnapshot; checkout: string };
            function checkoutPath(checkout: string, path: string): string {
              if (
                path.length > 0 &&
                path
                  .split("/")
                  .some((part) => !part || part === "." || part === ".." || /[\\:]/.test(part))
              ) {
                throw new PilotSourceError(
                  "Snapshot entry cannot be materialized safely on this platform.",
                );
              }
              return join(checkout, ...path.split("/"));
            }
            function materialize(source: Source) {
              return source.snapshot.readFiles().pipe(
                Stream.runForEach(({ path, bytes }) =>
                  Effect.tryPromise({
                    try: async () => {
                      const destination = checkoutPath(source.checkout, path);
                      await mkdir(dirname(destination), { recursive: true });
                      await writeFile(destination, bytes);
                    },
                    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
                  }).pipe(Effect.uninterruptible),
                ),
              );
            }
            const initialSource = { snapshot, checkout: join(cache, "checkout-0") };
            yield* materialize(initialSource);
            const sources = new Map<string, Promise<Source>>([
              [`${repository}\n${snapshot.commit}`, Promise.resolve(initialSource)],
            ]);
            const requestedVersions = new Map(Object.entries(options.versions ?? {}));
            const requestedSources = new Map(Object.entries(options.sources ?? {}));
            const boundSources = new Map<string, Source>([[objectiveUri, initialSource]]);
            const sourceSignals = new Map<string, AbortSignal>();
            function resourcePath(uri: string): string {
              const url = new URL(uri);
              const path = decodeURIComponent(url.hash.slice(1)).replace(/\/$/, "");
              if (
                path.length > 0 &&
                path.split("/").some((part) => part === ".." || part === "." || !part)
              )
                throw new PilotSourceError("Invalid Git resource path.");
              return path;
            }
            function sourceFor(uri: string): Promise<Source> {
              const origin = new URL(uri);
              origin.hash = "";
              const remote = repositoryUri(origin.href.slice(4));
              const owner = [
                ...new Set([
                  ...boundSources.keys(),
                  ...requestedSources.keys(),
                  ...requestedVersions.keys(),
                ]),
              ]
                .sort((a, b) => b.length - a.length)
                .find((id) => uri === id || uri.startsWith(id));
              const selected = owner ?? uri;
              const evidence = requestedSources.get(selected);
              const required = requestedVersions.get(selected);
              const bound = boundSources.get(selected);
              if (bound !== undefined) {
                if (evidence !== undefined && bound.snapshot.commit !== evidence.commit)
                  throw new PilotSourceError(
                    `Conflicting immutable source binding for ${selected}.`,
                  );
                return Promise.resolve(bound);
              }
              if (required !== undefined && evidence === undefined)
                throw new PilotSourceError(
                  `Missing commit/tree source evidence for ${uri}; a tree is not a commit.`,
                );
              if (
                evidence !== undefined &&
                (evidence.kind !== "git-tree" ||
                  evidence.repository !== remote ||
                  evidence.directory !== resourcePath(selected) ||
                  (required !== undefined && evidence.tree !== required))
              )
                throw new PilotSourceError(`Invalid pinned directory source evidence for ${uri}.`);
              const key = `${remote}\n${evidence?.commit ?? (remote === repository ? snapshot.commit : "HEAD")}`;
              const existing = sources.get(key);
              if (existing !== undefined) return existing;
              const checkout = join(cache, `checkout-${sources.size}`);
              const pending = read(
                loadGitSnapshot(
                  { cacheDirectory: cache },
                  {
                    repository: remote === repository ? snapshotRepository : remote,
                    revision:
                      evidence !== undefined
                        ? { type: "commit", value: evidence.commit }
                        : remote === repository
                          ? { type: "commit", value: snapshot.commit }
                          : { type: "ref", value: "HEAD" },
                    refresh: { type: "once" },
                  },
                ).pipe(Effect.provideService(Scope.Scope, scope)),
                sourceSignals.get(uri),
              ).then(async (snapshot) => {
                const source = { snapshot, checkout };
                await read(materialize(source), sourceSignals.get(uri));
                return source;
              });
              sources.set(key, pending);
              return pending;
            }
            async function sourceEvidence(uri: string): Promise<GitPilotSource> {
              const source = await sourceFor(uri);
              const directory = resourcePath(uri);
              const tree = await read(source.snapshot.treeOid(directory), sourceSignals.get(uri));
              const required = requestedVersions.get(uri);
              if (required !== undefined && required !== tree)
                throw new PilotSourceError(`Pinned tree version mismatch for ${uri}.`);
              boundSources.set(uri, source);
              const origin = new URL(uri);
              origin.hash = "";
              const repositoryTree = await read(source.snapshot.treeOid(), sourceSignals.get(uri));
              const expected = requestedSources.get(uri);
              if (
                expected !== undefined &&
                (expected.kind !== "git-tree" ||
                  expected.commit !== source.snapshot.commit ||
                  expected.tree !== tree ||
                  expected.repository !== repositoryUri(origin.href.slice(4)) ||
                  expected.directory !== directory ||
                  expected.repositoryTree !== repositoryTree)
              )
                throw new PilotSourceError(
                  `Pinned commit/tree source evidence mismatch for ${uri}.`,
                );
              return {
                kind: "git-tree",
                repository: repositoryUri(origin.href.slice(4)),
                directory,
                commit: source.snapshot.commit,
                tree,
                repositoryTree,
              };
            }
            const resources: ResourceResolver = {
              version: snapshot.commit,
              versionFor: async (uri) => (await sourceEvidence(uri)).tree,
              sourceFor: sourceEvidence,
              readText: async (uri) => {
                const source = await sourceFor(uri);
                return new TextDecoder("utf-8", { fatal: true }).decode(
                  await readFile(checkoutPath(source.checkout, resourcePath(uri))),
                );
              },
              async readPages(uri) {
                const { checkout } = await sourceFor(uri);
                const origin = new URL(uri);
                origin.hash = "";
                const repoPrefix = origin.href;
                const pages: PageResource[] = [];
                const root = resourcePath(uri);
                async function walk(path: string): Promise<void> {
                  preparation.signal.throwIfAborted();
                  for (const entry of await readdir(checkoutPath(checkout, path), {
                    withFileTypes: true,
                  })) {
                    const child = `${path}/${entry.name}`;
                    if (entry.isDirectory()) await walk(child);
                    else if (entry.isFile() && entry.name.endsWith(".md"))
                      pages.push({
                        uri: `${repoPrefix}#${child}`,
                        source: new TextDecoder("utf-8", { fatal: true }).decode(
                          await readFile(checkoutPath(checkout, child)),
                        ),
                      });
                    else
                      throw new PilotSourceError(
                        "Pilot reference resources must be Markdown files or directories.",
                      );
                  }
                }
                await walk(root);
                return pages;
              },
            };
            const spec = yield* Effect.tryPromise({
              try: () => loadPilotSpec(objectiveUri, resources),
              catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
            });
            return yield* Effect.tryPromise({
              try: async (signal) => {
                const executables = new Map<
                  string,
                  { command: string; args: string[]; cwd: string; dependencyBinding: boolean }
                >();
                async function prepareChecks(
                  pilot: PilotSpec,
                  preparationSignal = signal,
                ): Promise<void> {
                  const source = await sourceFor(pilot.objectiveId);
                  const root = join(source.checkout, ...resourcePath(pilot.objectiveId).split("/"));
                  const allChecks = pilot.manifest.levels.flatMap(
                    ({ advancement }) => advancement.checks,
                  );
                  for (const level of pilot.manifest.levels) {
                    for (const check of level.advancement.checks) {
                      preparationSignal.throwIfAborted();
                      const scoped = join(root, "levels", level.id, "checks", check.id);
                      let directory = scoped;
                      try {
                        if (!(await stat(directory)).isDirectory())
                          throw new PilotSourceError("A check entry must be a directory.");
                      } catch (cause) {
                        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
                        if (allChecks.filter(({ id }) => id === check.id).length !== 1) {
                          throw new PilotSourceError(
                            `Repeated check ID ${check.id} requires a level-scoped executable directory.`,
                          );
                        }

                        directory = join(root, "checks", check.id);
                      }
                      const entries = (await readdir(directory)).filter(
                        (name) => name === "run" || name.startsWith("run."),
                      );
                      const [entryName] = entries;
                      if (entries.length !== 1 || entryName === undefined)
                        throw new PilotSourceError(
                          `Check ${level.id}/${check.id} requires exactly one run or run.* executable.`,
                        );
                      const entry = join(directory, entryName);
                      if (!(await stat(entry)).isFile())
                        throw new PilotSourceError("Check executable must be a regular file.");
                      let command = entry;
                      let args: string[] = [];
                      const firstLine = entry.toLowerCase().endsWith(".exe")
                        ? ""
                        : ((await readFile(entry, "utf8")).split(/\r?\n/, 1)[0] ?? "");
                      const dependencyBinding = /^#!\/usr\/bin\/env node$/.test(firstLine);
                      if (process.platform === "win32" && !entry.toLowerCase().endsWith(".exe")) {
                        const shebang = /^#!\/usr\/bin\/env ([A-Za-z0-9._+-]+)$/.exec(firstLine);
                        const interpreter = shebang?.[1];
                        if (interpreter === undefined)
                          throw new PilotSourceError(
                            "Windows script probes require #!/usr/bin/env <interpreter>.",
                          );
                        command = interpreter;
                        args = [entry];
                      } else if (process.platform !== "win32") {
                        await chmod(entry, 0o755);
                      }
                      executables.set(JSON.stringify([pilot.objectiveId, level.id, check.id]), {
                        command,
                        args,
                        cwd: directory,
                        dependencyBinding,
                      });
                    }
                  }
                }
                await prepareChecks(spec);
                const activeProbes = new Map<Promise<Envelope<CheckResult>>, AbortSignal>();
                const probeLifecycle = new AbortController();
                const boundObjectives = new Map<string, PilotSpec>([[spec.objectiveId, spec]]);
                const runtime: PilotRuntime = {
                  boundObjectives: () => [...boundObjectives.values()],
                  onObservation: (value) => evidence?.stream.emit("probe.observation", value),
                  async resolveObjective(objectiveId, version, dependencySignal, source) {
                    dependencySignal.throwIfAborted();
                    if (
                      canonicalObjectiveUri(objectiveId) !== objectiveId ||
                      !objectiveId.startsWith("git+")
                    )
                      throw new PilotSourceError(
                        "Dependency requires a canonical Git Pilot directory URI.",
                      );
                    const bound = boundObjectives.get(objectiveId);
                    if (bound !== undefined) {
                      if (version !== undefined && version !== bound.version)
                        throw new PilotSourceError(
                          `Conflicting bound tree version for ${objectiveId}.`,
                        );
                      if (source !== undefined) {
                        validateGitPilotSource(objectiveId, bound.version, source);
                        if (
                          source.commit !== bound.source?.commit ||
                          source.repositoryTree !== bound.source?.repositoryTree
                        )
                          throw new PilotSourceError(
                            `Conflicting bound snapshot evidence for ${objectiveId}.`,
                          );
                      }
                      return { spec: bound, runtime };
                    }
                    if (version !== undefined) requestedVersions.set(objectiveId, version);
                    if (source !== undefined) requestedSources.set(objectiveId, source);
                    sourceSignals.set(objectiveId, dependencySignal);
                    const spec = await loadPilotSpec(objectiveId, resources);
                    dependencySignal.throwIfAborted();
                    await prepareChecks(spec, dependencySignal);
                    dependencySignal.throwIfAborted();
                    boundObjectives.set(objectiveId, spec);
                    return { spec, runtime };
                  },
                  resolveCheck(ref) {
                    const executable = executables.get(
                      JSON.stringify([ref.objectiveId, ref.levelId, ref.checkId]),
                    );
                    if (executable === undefined)
                      throw new PilotSourceError(
                        `Unknown check reference: ${JSON.stringify(ref)}.`,
                      );
                    const probe = createProcessCheckProbe({
                      ...executable,
                      ...(options.probeTimeoutMs === undefined
                        ? {}
                        : { timeoutMs: options.probeTimeoutMs }),
                      log: (message) => process.stderr.write(message),
                      evidence: evidence ?? false,
                      identity: ref,
                    });
                    return (subject, signal) => {
                      const lifetime = AbortSignal.any([signal, probeLifecycle.signal]);
                      const pending = probe(subject, lifetime);
                      activeProbes.set(pending, lifetime);
                      void pending.then(
                        () => activeProbes.delete(pending),
                        () => activeProbes.delete(pending),
                      );
                      return pending;
                    };
                  },
                };
                clearTimeout(timer);
                if (process.env.PGUIDE_TIMINGS === "1")
                  process.stderr.write(
                    `${JSON.stringify({ type: "pguide-timing", phase: "source.preparation", durationMs: Math.round(performance.now() - preparationStarted) })}\n`,
                  );
                return afterCleanup(
                  () => use(spec, runtime),
                  async () => {
                    probeLifecycle.abort(new Error("Pilot source scope closed."));
                    const pending = [...activeProbes];
                    const exits = await Promise.allSettled(pending.map(([probe]) => probe));
                    for (const [index, exit] of exits.entries()) {
                      const signal = pending[index]?.[1];
                      if (
                        exit.status === "rejected" &&
                        (signal?.aborted !== true || exit.reason !== signal.reason)
                      ) {
                        throw exit.reason;
                      }
                    }
                  },
                );
              },
              catch: (error) => (error instanceof Error ? error : new Error(String(error))),
            });
          }),
        ),
        {
          signal:
            options.signal === undefined
              ? preparation.signal
              : AbortSignal.any([preparation.signal, options.signal]),
        },
      ).finally(async () => {
        clearTimeout(timer);
        preparation.abort();
        await Promise.allSettled([...pendingReads]);
      });
      if (Exit.isFailure(result)) {
        if (preparationTimedOut)
          throw new PilotSourceError(
            `Pilot source preparation timed out after ${preparationTimeoutMs}ms.`,
          );
        const cause = Cause.squash(result.cause);
        if (cause instanceof CliError || options.propagateError?.(cause)) throw cause;
        throw new PilotSourceError(cause instanceof Error ? cause.message : String(cause), cause);
      }
      return result.value;
    },
    () => rm(cache, { recursive: true, force: true }),
  );
}

export async function withPilot<T>(
  location: string,
  cwd: string,
  revision: string | undefined,
  use: (spec: PilotSpec, runtime: PilotRuntime) => Promise<T>,
  options: PilotSourceOptions = {},
): Promise<T> {
  const evidence =
    options.reports?.enabled === false || process.env.PGUIDE_EVIDENCE_DISABLED === "1"
      ? undefined
      : new RunEvidence(options.reports);
  try {
    const result = await bindPilot(location, cwd, revision, use, options, evidence);
    evidence?.stream.emit("run.finished", { outcome: "completed" });
    return result;
  } catch (cause) {
    evidence?.stream.emit("run.failed", { outcome: "interrupted-or-error" });
    if (cause instanceof CliError || options.propagateError?.(cause)) throw cause;
    throw new PilotSourceError(cause instanceof Error ? cause.message : String(cause), cause);
  }
}

export interface PilotSourceOptions {
  readonly propagateError?: (cause: unknown) => boolean;
  readonly signal?: AbortSignal;
  readonly reports?: { readonly enabled?: boolean; readonly directory?: string } | undefined;
  readonly versions?: Readonly<Record<string, string>>;
  readonly sources?: Readonly<Record<string, GitPilotSource>>;
  readonly cacheDirectory?: string;
  readonly probeTimeoutMs?: number | undefined;
  readonly preparationTimeoutMs?: number;
}
