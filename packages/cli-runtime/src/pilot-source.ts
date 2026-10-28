import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  lstat,
  mkdtemp,
  open,
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
import {
  ensurePrivateDirectory,
  hostDirectory,
  publishArtifact,
  readArtifact,
} from "@potential-guide/check-host";
import { CliError, markdownInlineCode, markdownText } from "@potential-guide/cli-core";
import { Cause, Effect, Exit, Scope, Stream } from "@potential-guide/effects";
import { type GitSnapshot, loadGitSnapshot } from "@potential-guide/git-source";
import {
  type CheckResult,
  canonicalObjectiveUri,
  captureFilesystemObservation,
  createWorkerCheckProbe,
  type Envelope,
  type GitObjectiveSource,
  type ObjectiveSource,
  loadPilotSpec,
  observationResource,
  type PageResource,
  type PilotRuntime,
  type PilotSpec,
  type ResourceResolver,
  RunEvidence,
  validateGitPilotSource,
} from "@potential-guide/objective-pilot";
import { ObjectiveInputError } from "@potential-guide/pilot-protocol";
import { withNpmPilot, type PackagePreparationOptions } from "./package-source.js";
import { parseObjectiveArtifactLocation, withObjectiveArtifact } from "./objective-artifact.js";

const execute = promisify(execFile);

async function git(
  cwd: string,
  signal: AbortSignal | undefined,
  ...args: string[]
): Promise<string> {
  const result = await execute("git", ["--no-pager", "-C", cwd, ...args], {
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    ...(signal === undefined ? {} : { signal }),
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
    super(
      message,
      2,
      "pilot-error",
      undefined,
      cause instanceof ObjectiveInputError ? inputErrorMessage(cause) : undefined,
    );
    if (cause !== undefined) this.cause = cause;
  }
}

function inputErrorMessage(error: ObjectiveInputError): string {
  const details = error.details;
  const objective = markdownInlineCode(details.objectiveId);
  if (details.kind === "language") {
    return [
      `Unsupported language ${markdownInlineCode(details.requested)} for ${objective}.`,
      `Supported languages: ${details.supported.map(markdownInlineCode).join(", ")}.`,
      "Next: choose a supported --language, or omit it to use the Objective default.",
    ].join("\n\n");
  }

  const issues = details.issues?.map(
    (issue) =>
      `- ${markdownInlineCode(issue.instancePath || "/")}: ${markdownText(issue.message)} (${markdownInlineCode(issue.keyword)})`,
  ) ?? ["- Subject must be a JSON object matching the Objective subjectSchema."];
  return [
    `Invalid subject for ${objective}.`,
    `Input issues:\n${issues.join("\n")}`,
    "Next: correct the subject fields against subjectSchema and retry --subject-file <path> or stdin.",
  ].join("\n\n");
}

function aggregateFailure(cause: unknown): boolean {
  return (
    cause instanceof AggregateError ||
    (cause instanceof Error && cause.cause instanceof AggregateError)
  );
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
          outcome.error.humanMessage === undefined
            ? undefined
            : `${outcome.error.humanMessage}\n\nCleanup failed: ${markdownText(cleanupError instanceof Error ? cleanupError.message : String(cleanupError))}`,
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

async function writeInputView(path: string, text: string): Promise<void> {
  const handle = await open(path, "wx");
  try {
    await afterCleanup(
      () => handle.writeFile(text),
      () => handle.close(),
    );
  } catch (error) {
    await afterCleanup(
      () => Promise.reject(error),
      () => rm(path, { force: true }),
    );
  }
}

async function bindPilot<T>(
  location: string,
  cwd: string,
  revision: string | undefined,
  use: (spec: PilotSpec, runtime: PilotRuntime) => Promise<T>,
  options: PilotSourceOptions,
  evidence: RunEvidence | undefined,
): Promise<T> {
  const pinnedArtifact = options.sources?.[location];
  if (pinnedArtifact?.kind === "objective-artifact") {
    if (revision !== undefined && revision !== pinnedArtifact.artifactDigest)
      throw new PilotSourceError("Conflicting Objective artifact recovery digest.");
    return withObjectiveArtifact(
      pinnedArtifact.directory,
      pinnedArtifact.artifactDigest,
      use,
      options,
      evidence,
    );
  }
  if (location.startsWith("artifact+file:")) {
    const source = parseObjectiveArtifactLocation(location);
    if (revision !== undefined && revision !== source.digest)
      throw new PilotSourceError("Conflicting Objective artifact digest.");
    return withObjectiveArtifact(source.directory, source.digest, use, options, evidence);
  }
  if (revision?.startsWith("sha256-pguide-objective-v1:"))
    return withObjectiveArtifact(resolve(cwd, location), revision, use, options, evidence);
  if (
    !location.startsWith("git+") &&
    (isAbsolute(location) || !/^[a-z][a-z0-9+.-]*:/i.test(location))
  ) {
    try {
      await lstat(join(resolve(cwd, location), "objective.json"));
      throw new PilotSourceError(
        "Objective artifacts require --revision <exact digest> or an artifact+file location.",
      );
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
  let legacy = location.startsWith("git+") && location.includes("#") && location.endsWith("/");
  if (!legacy && (isAbsolute(location) || !/^[a-z][a-z0-9+.-]*:/i.test(location))) {
    const local = resolve(cwd, location);
    try {
      const directory = basename(local) === "objective.yaml" ? dirname(local) : local;
      await readFile(join(directory, "objective.yaml"));
      try {
        await readFile(join(directory, "package.json"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        legacy = true;
      }
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
  if (!legacy) {
    return withNpmPilot(location, cwd, revision, use, options, evidence);
  }
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
      if (basename(path) !== "objective.yaml")
        throw new PilotSourceError(
          "Pilot sources must be directories; only an exact objective.yaml entry can be converted at the CLI boundary.",
        );
      path = dirname(path);
    }
    const directory = path;
    const root = await realpath(
      await git(directory, options.signal, "rev-parse", "--show-toplevel"),
    );
    if (await git(root, options.signal, "status", "--porcelain", "--untracked-files=all"))
      throw new PilotSourceError(
        "Pilot repository is dirty or contains uncommitted files. Commit the Pilot before probing or regulating.",
      );
    repository = repositoryUri(await git(root, options.signal, "remote", "get-url", "origin"));
    snapshotRepository = pathToFileURL(root).href;
    if (revision !== undefined && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(revision)) {
      throw new PilotSourceError("Local Pilot revisions must be full commit hashes, not refs.");
    }
    commitOrRef = revision ?? (await git(root, options.signal, "rev-parse", "HEAD"));
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
            const requestedSources = new Map<string, GitObjectiveSource>();
            for (const [id, source] of Object.entries(options.sources ?? {})) {
              if (source.kind !== "git-tree")
                throw new PilotSourceError(
                  "Legacy Git binding cannot consume npm package evidence.",
                );
              requestedSources.set(id, source);
            }
            const boundSources = new Map<string, Source>([[objectiveUri, initialSource]]);
            const sourceSignals = new Map<string, AbortSignal>();
            function resourceSignal(uri: string): AbortSignal {
              let selected = preparation.signal;
              let length = 0;
              for (const [id, signal] of sourceSignals) {
                if (uri.startsWith(id) && id.length > length) {
                  selected = signal;
                  length = id.length;
                }
              }
              return AbortSignal.any([preparation.signal, selected]);
            }
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
                resourceSignal(uri),
              ).then(async (snapshot) => {
                const source = { snapshot, checkout };
                await read(materialize(source), resourceSignal(uri));
                return source;
              });
              sources.set(key, pending);
              return pending;
            }
            async function sourceEvidence(uri: string): Promise<GitObjectiveSource> {
              const source = await sourceFor(uri);
              const directory = resourcePath(uri);
              const tree = await read(source.snapshot.treeOid(directory), resourceSignal(uri));
              const required = requestedVersions.get(uri);
              if (required !== undefined && required !== tree)
                throw new PilotSourceError(`Pinned tree version mismatch for ${uri}.`);
              boundSources.set(uri, source);
              const origin = new URL(uri);
              origin.hash = "";
              const repositoryTree = await read(source.snapshot.treeOid(), resourceSignal(uri));
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
                  await readFile(checkoutPath(source.checkout, resourcePath(uri)), {
                    signal: resourceSignal(uri),
                  }),
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
                  resourceSignal(uri).throwIfAborted();
                  for (const entry of await readdir(checkoutPath(checkout, path), {
                    withFileTypes: true,
                  })) {
                    const child = `${path}/${entry.name}`;
                    if (entry.isDirectory()) await walk(child);
                    else if (entry.isFile() && entry.name.endsWith(".md"))
                      pages.push({
                        uri: `${repoPrefix}#${child}`,
                        source: new TextDecoder("utf-8", { fatal: true }).decode(
                          await readFile(checkoutPath(checkout, child), {
                            signal: resourceSignal(uri),
                          }),
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
                  { directory: string; revision: string; sourceDirectory: string }
                >();
                const observationInputs = new Map<string, readonly string[]>();
                async function prepareChecks(
                  objective: PilotSpec,
                  preparationSignal = AbortSignal.any([
                    signal,
                    preparation.signal,
                    ...(options.signal === undefined ? [] : [options.signal]),
                  ]),
                ): Promise<void> {
                  const source = await sourceFor(objective.objectiveId);
                  const root = join(
                    source.checkout,
                    ...resourcePath(objective.objectiveId).split("/"),
                  );
                  try {
                    const descriptor: unknown = JSON.parse(
                      await readFile(join(root, "observation-inputs.json"), "utf8"),
                    );
                    if (
                      typeof descriptor !== "object" ||
                      descriptor === null ||
                      Object.keys(descriptor).sort().join(",") !== "contract,subjectRoot" ||
                      !("contract" in descriptor) ||
                      descriptor.contract !== "bounded-readonly-filesystem-v1" ||
                      !("subjectRoot" in descriptor) ||
                      !Array.isArray(descriptor.subjectRoot) ||
                      descriptor.subjectRoot.length === 0 ||
                      !descriptor.subjectRoot.every(
                        (part: unknown) =>
                          typeof part === "string" && /^[A-Za-z][A-Za-z0-9]*$/.test(part),
                      )
                    )
                      throw new PilotSourceError(
                        "Invalid observation-inputs.json read-only input contract.",
                      );
                    observationInputs.set(
                      objective.objectiveId,
                      descriptor.subjectRoot as string[],
                    );
                  } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                  }
                  const allChecks = objective.manifest.levels.flatMap(({ checks }) => checks);
                  for (const level of objective.manifest.levels) {
                    for (const check of level.checks) {
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
                      const entries = await readdir(directory);
                      if (
                        entries.some((name) => name === "run" || name.startsWith("run.")) ||
                        !entries.includes("worker.cjs")
                      )
                        throw new PilotSourceError(
                          "Legacy run.* checks are unsupported; provide a self-contained worker.cjs artifact.",
                        );
                      const identity = JSON.stringify([objective.objectiveId, level.id, check.id]);
                      const stable = join(
                        hostDirectory(),
                        "artifacts",
                        createHash("sha256").update(identity).digest("hex"),
                      );
                      const artifactRevision = (await readArtifact(directory)).revision;
                      executables.set(JSON.stringify([objective.objectiveId, level.id, check.id]), {
                        directory: stable,
                        revision: artifactRevision,
                        sourceDirectory: directory,
                      });
                    }
                  }
                }
                await prepareChecks(spec);
                const activeProbes = new Map<Promise<Envelope<CheckResult>>, AbortSignal>();
                const probeLifecycle = new AbortController();
                const boundObjectives = new Map<string, PilotSpec>([[spec.objectiveId, spec]]);
                async function inputView(objectiveId: string, subject: unknown) {
                  const pointer = observationInputs.get(objectiveId);
                  if (pointer === undefined) return undefined;
                  let value = subject;
                  for (const part of pointer) {
                    if (typeof value !== "object" || value === null || Array.isArray(value))
                      throw new PilotSourceError(
                        "Input-view subjectRoot must resolve to a filesystem root string.",
                      );
                    value = (value as Record<string, unknown>)[part];
                  }
                  if (typeof value !== "string")
                    throw new PilotSourceError(
                      "Input-view subjectRoot must resolve to a filesystem root string.",
                    );
                  const requestedRoot = value;
                  const root = await observationResource(
                    `bounded-readonly-root-v1:${resolve(requestedRoot)}`,
                    () => realpath(requestedRoot),
                    async () => {},
                  );
                  return observationResource<{ path: string; sha256: string } | undefined>(
                    `bounded-readonly-filesystem-v1:${root}`,
                    async (signal) => {
                      const started = performance.now();
                      const view = await captureFilesystemObservation(
                        root,
                        AbortSignal.any([
                          signal,
                          ...(options.signal === undefined ? [] : [options.signal]),
                        ]),
                        (diagnostic) => {
                          const value = { objectiveId, ...diagnostic };
                          evidence?.stream.emit("input-view.unavailable", value);
                          if (process.env.PGUIDE_TIMINGS === "1")
                            process.stderr.write(
                              `${JSON.stringify({
                                type: "pguide-timing",
                                phase: "input-view.capture",
                                status: "unavailable",
                                durationMs: Math.round(performance.now() - started),
                                ...value,
                              })}\n`,
                            );
                        },
                      );
                      if (view === undefined) return undefined;
                      const text = JSON.stringify(view);
                      const path = join(cache, `input-view-${randomUUID()}.json`);
                      await writeInputView(path, text);
                      if (process.env.PGUIDE_TIMINGS === "1")
                        process.stderr.write(
                          `${JSON.stringify({
                            type: "pguide-timing",
                            phase: "input-view.capture",
                            status: "captured",
                            durationMs: Math.round(performance.now() - started),
                            entries: Object.keys(view.entries).length,
                            bytes: Buffer.byteLength(text),
                          })}\n`,
                        );
                      return { path, sha256: createHash("sha256").update(text).digest("hex") };
                    },
                    async (view) => {
                      if (view !== undefined) await rm(view.path, { force: true });
                    },
                  );
                }
                const runtime: PilotRuntime = {
                  ...(options.observationBudget === undefined
                    ? {}
                    : { observationBudget: options.observationBudget }),
                  async observationRevision(input, signal) {
                    signal.throwIfAborted();
                    const view = await inputView(input.spec.objectiveId, input.subject);
                    if (view === undefined) return undefined;
                    const digest = createHash("sha256")
                      .update(await readFile(view.path))
                      .digest("hex");
                    signal.throwIfAborted();
                    if (digest !== view.sha256)
                      throw new PilotSourceError("Input view integrity mismatch.");
                    return view.sha256;
                  },
                  boundObjectives: () => [...boundObjectives.values()],
                  onObservation: (value) => evidence?.stream.emit("probe.observation", value),
                  async resolveObjective(objectiveId, version, dependencySignal, source) {
                    const started = performance.now();
                    const deadline = new AbortController();
                    const timer = setTimeout(
                      () =>
                        deadline.abort(
                          new PilotSourceError(
                            `source-preparation-timeout: ${objectiveId}: dependency source preparation exceeded ${preparationTimeoutMs}ms.`,
                          ),
                        ),
                      preparationTimeoutMs,
                    );
                    const requestSignal = AbortSignal.any([
                      dependencySignal,
                      deadline.signal,
                      ...(options.signal === undefined ? [] : [options.signal]),
                    ]);
                    try {
                      requestSignal.throwIfAborted();
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
                            bound.source?.kind !== "git-tree" ||
                            source.commit !== bound.source.commit ||
                            source.repositoryTree !== bound.source.repositoryTree
                          )
                            throw new PilotSourceError(
                              `Conflicting bound snapshot evidence for ${objectiveId}.`,
                            );
                        }
                        return { spec: bound, runtime };
                      }
                      if (version !== undefined) requestedVersions.set(objectiveId, version);
                      if (source !== undefined) {
                        validateGitPilotSource(objectiveId, version ?? "", source);
                        requestedSources.set(objectiveId, source);
                      }
                      sourceSignals.set(objectiveId, requestSignal);
                      const spec = await loadPilotSpec(objectiveId, resources);
                      requestSignal.throwIfAborted();
                      await prepareChecks(spec, requestSignal);
                      requestSignal.throwIfAborted();
                      boundObjectives.set(objectiveId, spec);
                      return { spec, runtime };
                    } catch (error) {
                      if (requestSignal.aborted) throw requestSignal.reason;
                      throw error;
                    } finally {
                      clearTimeout(timer);
                      if (process.env.PGUIDE_TIMINGS === "1")
                        process.stderr.write(
                          `${JSON.stringify({
                            type: "pguide-timing",
                            phase: "source.dependency-preparation",
                            objectiveId,
                            durationMs: Math.round(performance.now() - started),
                          })}\n`,
                        );
                    }
                  },
                  resolveCheck(ref) {
                    const executable = executables.get(
                      JSON.stringify([ref.objectiveId, ref.levelId, ref.checkId]),
                    );
                    if (executable === undefined)
                      throw new PilotSourceError(
                        `Unknown check reference: ${JSON.stringify(ref)}.`,
                      );
                    return async (subject, signal, resolutions) => {
                      const view = await inputView(ref.objectiveId, subject);
                      signal.throwIfAborted();
                      await ensurePrivateDirectory(hostDirectory());
                      const revision = await publishArtifact(
                        executable.sourceDirectory,
                        executable.directory,
                      );
                      if (revision !== executable.revision)
                        throw new PilotSourceError(
                          "Bound worker artifact changed before invocation.",
                        );
                      signal.throwIfAborted();
                      const probe = createWorkerCheckProbe({
                        ...executable,
                        ...(view === undefined
                          ? {}
                          : { inputView: JSON.parse(await readFile(view.path, "utf8")) }),
                        ...(options.probeTimeoutMs === undefined
                          ? {}
                          : { timeoutMs: options.probeTimeoutMs }),
                        evidence: evidence ?? false,
                        identity: ref,
                      });
                      const lifetime = AbortSignal.any([
                        signal,
                        probeLifecycle.signal,
                        ...(options.signal === undefined ? [] : [options.signal]),
                      ]);
                      const pending = probe(subject, lifetime, resolutions);
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
            }).pipe(Effect.uninterruptible);
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
        const cause = Cause.squash(result.cause);
        if (aggregateFailure(cause)) throw cause;
        if (preparationTimedOut)
          throw new PilotSourceError(
            `source-preparation-timeout: ${objectiveUri}: Pilot source preparation timed out after ${preparationTimeoutMs}ms.`,
          );
        if (options.signal?.aborted) throw options.signal.reason;
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
  const preparationTimeoutMs = options.preparationTimeoutMs ?? 60_000;
  if (
    !Number.isSafeInteger(preparationTimeoutMs) ||
    preparationTimeoutMs < 1 ||
    preparationTimeoutMs > 2_147_483_647
  )
    throw new PilotSourceError("preparationTimeoutMs must be a positive safe timer duration.");
  const deadline = new AbortController();
  const timer = setTimeout(
    () =>
      deadline.abort(
        new PilotSourceError(
          `source-preparation-timeout: ${location}: Pilot source preparation timed out after ${preparationTimeoutMs}ms.`,
        ),
      ),
    preparationTimeoutMs,
  );
  const evidence =
    options.reports?.enabled === false || process.env.PGUIDE_EVIDENCE_DISABLED === "1"
      ? undefined
      : new RunEvidence(options.reports);
  try {
    const result = await bindPilot(
      location,
      cwd,
      revision,
      async (spec, runtime) => {
        clearTimeout(timer);
        deadline.signal.throwIfAborted();
        return use(spec, runtime);
      },
      {
        ...options,
        signal: AbortSignal.any([
          deadline.signal,
          ...(options.signal === undefined ? [] : [options.signal]),
        ]),
      },
      evidence,
    );
    evidence?.stream.emit("run.finished", { outcome: "completed" });
    return result;
  } catch (cause) {
    evidence?.stream.emit("run.failed", { outcome: "interrupted-or-error" });
    if (!aggregateFailure(cause)) {
      if (deadline.signal.aborted) throw deadline.signal.reason;
      if (options.signal?.aborted) throw options.signal.reason;
    }
    if (cause instanceof CliError || options.propagateError?.(cause)) throw cause;
    throw new PilotSourceError(cause instanceof Error ? cause.message : String(cause), cause);
  } finally {
    clearTimeout(timer);
  }
}

export interface PilotSourceOptions {
  readonly propagateError?: (cause: unknown) => boolean;
  readonly signal?: AbortSignal;
  readonly reports?: { readonly enabled?: boolean; readonly directory?: string } | undefined;
  readonly versions?: Readonly<Record<string, string>>;
  readonly sources?: Readonly<Record<string, ObjectiveSource>>;
  readonly packagePreparation?: Omit<PackagePreparationOptions, "cacheDirectory" | "signal">;
  readonly packageSpecs?: Readonly<Record<string, string>>;
  readonly cacheDirectory?: string;
  readonly probeTimeoutMs?: number | undefined;
  readonly preparationTimeoutMs?: number;
  readonly observationBudget?: PilotRuntime["observationBudget"];
}

export function pilotSourceBudgets(probe?: {
  readonly timeoutMs: number;
  readonly checkTimeoutMs?: number;
  readonly preparationTimeoutMs?: number;
  readonly observationBudget?: PilotRuntime["observationBudget"];
}): Pick<PilotSourceOptions, "probeTimeoutMs" | "preparationTimeoutMs" | "observationBudget"> {
  return {
    ...(probe === undefined ? {} : { probeTimeoutMs: probe.checkTimeoutMs ?? probe.timeoutMs }),
    ...(probe?.preparationTimeoutMs === undefined
      ? {}
      : { preparationTimeoutMs: probe.preparationTimeoutMs }),
    ...(probe?.observationBudget === undefined
      ? {}
      : { observationBudget: probe.observationBudget }),
  };
}
