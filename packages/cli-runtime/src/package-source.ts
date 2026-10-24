import { createHash, randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, lstat, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  ensurePrivateDirectory,
  hostDirectory,
  publishArtifact,
  readArtifact,
  readPrivateFile,
  createPrivateFile,
} from "@potential-guide/check-host";
import {
  createWorkerCheckProbe,
  captureFilesystemObservation,
  observationResource,
  isObjectivePackageName,
  loadPilotSpec,
  type NpmObjectiveSource,
  type PageResource,
  type PilotRuntime,
  type PilotSpec,
  type ResourceResolver,
  type RunEvidence,
  type Subject,
  validatePilotSource,
  sameObjectiveSource,
} from "@potential-guide/objective-pilot";
import npa from "npm-package-arg";
import { killProcessTree } from "@potential-guide/cli-core";
import type { FetchResult } from "pacote";
import * as tar from "tar";
import type { PilotSourceOptions } from "./pilot-source.js";
import type { PackageFetchRequest } from "./package-fetch.js";

export const packageDigestFormat = "sha256-pguide-package-v1:";
const maximumPackageBytes = 256 * 1024 * 1024;
const maximumPackageFiles = 16_384;
type Modes = Readonly<Record<string, number>>;
function validModes(value: unknown): value is Modes {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((mode) => Number.isSafeInteger(mode) && mode >= 0 && mode <= 0o7777)
  );
}
function alias(value: npa.Result): value is npa.AliasResult {
  return value.type === "alias" && "subSpec" in value;
}
function safePackageComponent(name: string): boolean {
  return (
    !!name &&
    name !== "." &&
    name !== ".." &&
    name === name.normalize("NFC") &&
    name.toLowerCase() !== "node_modules" &&
    !/[\\:<>"|?*]/.test(name) &&
    ![...name].some((character) => character.charCodeAt(0) < 32) &&
    !/[. ]$/.test(name) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  );
}

/** v1: UTF-8 JSON [path, byteLength, executable], NUL, bytes; unsigned UTF-8 path order. */
export async function digestObjectivePackage(directory: string, modes?: Modes): Promise<string> {
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink())
    throw new Error("Package root must be a regular directory.");
  const files: { name: string; bytes: Buffer; executable: boolean }[] = [];
  const names = new Set<string>();
  let total = 0;
  async function visit(path: string, prefix: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (!safePackageComponent(entry.name))
        throw new Error(`Package contains a forbidden path: ${prefix}${entry.name}.`);
      const name = `${prefix}${entry.name}`;
      if (entry.name.toLowerCase() === "objective.yaml" && prefix !== "")
        throw new Error("An npm package must contain exactly one root Objective definition.");
      const folded = name.normalize("NFC").toLowerCase();
      if (names.has(folded) || name !== name.normalize("NFC"))
        throw new Error(`Package contains an ambiguous path: ${name}.`);
      names.add(folded);
      if (names.size > maximumPackageFiles * 2)
        throw new Error("Objective package exceeds its path bounds.");
      const path = join(directory, ...name.split("/"));
      const before = await lstat(path, { bigint: true });
      if (before.isDirectory()) await visit(path, `${name}/`);
      else {
        if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n)
          throw new Error("Package links and special files are forbidden.");
        if (
          files.length >= maximumPackageFiles ||
          before.size > BigInt(maximumPackageBytes - total)
        )
          throw new Error("Objective package exceeds its delivered-tree bounds.");
        const bytes = await readFile(path);
        const after = await lstat(path, { bigint: true });
        if (
          before.ino !== after.ino ||
          before.mtimeNs !== after.mtimeNs ||
          before.ctimeNs !== after.ctimeNs ||
          BigInt(bytes.length) !== before.size
        )
          throw new Error("Package changed while calculating its digest.");
        const mode = modes && Object.hasOwn(modes, name) ? (modes[name] ?? 0) : Number(before.mode);
        total += bytes.length;
        files.push({ name, bytes, executable: (mode & 0o111) !== 0 });
      }
    }
  }
  await visit(directory, "");
  const hash = createHash("sha256").update("pguide-package\0v1\0");
  for (const file of files.sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name))))
    hash
      .update(JSON.stringify([file.name, file.bytes.length, file.executable]))
      .update("\0")
      .update(file.bytes);
  return `${packageDigestFormat}${hash.digest("hex")}`;
}

interface PreparedPackage {
  readonly directory: string;
  readonly source: NpmObjectiveSource;
}
function packageProvenance(source: NpmObjectiveSource): Omit<NpmObjectiveSource, "bindings"> {
  const { bindings: _bindings, ...provenance } = source;
  return provenance;
}

export interface PackagePreparationOptions {
  readonly cacheDirectory?: string;
  readonly allowScripts?: boolean;
  readonly registry?: string;
  readonly signal?: AbortSignal;
}

type ResolvedFetch = FetchResult & {
  readonly selectedName?: string;
  readonly selectedVersion?: string;
};
async function fetchPackage(
  request: PackageFetchRequest,
  signal?: AbortSignal,
): Promise<ResolvedFetch> {
  signal?.throwIfAborted();
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_OPTIONS: "",
    GIT_TERMINAL_PROMPT: "0",
  };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ])
    delete environment[key];
  const child = fork(new URL("./package-fetch.js", import.meta.url), [], {
    cwd: request.cwd,
    execArgv: [],
    env: environment,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let diagnostic = "";
  child.stderr?.on("data", (bytes: Buffer) => {
    if (diagnostic.length < 16_384)
      diagnostic += bytes.toString("utf8").slice(0, 16_384 - diagnostic.length);
  });
  const closed = new Promise<void>((done) => child.once("close", () => done()));
  let received = false;
  let sent = false;
  let outcome: { value: ResolvedFetch } | { error: unknown };
  let abort: (() => void) | undefined;
  try {
    const value = await new Promise<ResolvedFetch>((done, fail) => {
      abort = () => fail(signal?.reason ?? new Error("Package preparation cancelled."));
      signal?.addEventListener("abort", abort, { once: true });
      child.once("error", fail);
      child.once("close", (code, signal) => {
        const kind =
          /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|ENAMETOOLONG|ENOENT|SyntaxError|FATAL ERROR/.exec(
            diagnostic,
          )?.[0] ?? "unknown";
        fail(
          new Error(
            `npm package fetch exited without a result (exit=${code},signal=${signal},kind=${kind}).`,
          ),
        );
      });
      child.on("message", (message: unknown) => {
        if (
          message &&
          typeof message === "object" &&
          "type" in message &&
          message.type === "ready"
        ) {
          if (sent) return fail(new Error("npm fetch helper repeated its readiness handshake."));
          sent = true;
          if (signal?.aborted) return abort?.();
          child.send(request, (error) => {
            if (error) fail(error);
          });
          return;
        }
        received = true;
        if (abort) signal?.removeEventListener("abort", abort);
        if (!message || typeof message !== "object" || !("ok" in message))
          return fail(new Error("Invalid npm fetch response."));
        if (message.ok !== true)
          return fail(
            new Error(
              "error" in message ? String(message.error) : "npm package preparation failed.",
            ),
          );
        if (
          !("result" in message) ||
          !message.result ||
          typeof message.result !== "object" ||
          !("resolved" in message.result) ||
          typeof message.result.resolved !== "string" ||
          !("integrity" in message.result) ||
          typeof message.result.integrity !== "string" ||
          !("from" in message.result) ||
          typeof message.result.from !== "string"
        )
          return fail(new Error("Invalid npm package provenance."));
        done({
          resolved: message.result.resolved,
          integrity: message.result.integrity,
          from: message.result.from,
          ...("selectedName" in message.result && typeof message.result.selectedName === "string"
            ? { selectedName: message.result.selectedName }
            : {}),
          ...("selectedVersion" in message.result &&
          typeof message.result.selectedVersion === "string"
            ? { selectedVersion: message.result.selectedVersion }
            : {}),
        });
      });
      if (signal?.aborted) abort();
    });
    outcome = { value };
  } catch (error) {
    outcome = { error };
  }
  if (abort) signal?.removeEventListener("abort", abort);
  try {
    if (request.allowScripts || !received) await killProcessTree(child);
    await closed;
  } catch (cleanup) {
    throw new AggregateError(
      "error" in outcome ? [outcome.error, cleanup] : [cleanup],
      "npm package preparation cleanup is unconfirmed.",
    );
  }
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

/** Preparation is an explicit boundary. Check execution never calls npm or resolves a spec. */
export async function prepareObjectivePackage(
  spec: string,
  cwd: string,
  options: PackagePreparationOptions = {},
): Promise<PreparedPackage> {
  options.signal?.throwIfAborted();
  const parsed = npa(spec, cwd);
  const root = resolve(options.cacheDirectory ?? join(hostDirectory(), "packages"));
  await ensurePrivateDirectory(root);
  const staging = join(root, `prepare-${randomUUID()}`);
  await ensurePrivateDirectory(staging);
  try {
    const archive = join(staging, "package.tgz");
    const fetchOptions: PackageFetchRequest = {
      spec,
      archive,
      cache: join(root, "npm-cache"),
      cwd,
      allowScripts: options.allowScripts === true,
      ...(options.registry === undefined ? {} : { registry: options.registry }),
    };
    const fetched = await fetchPackage(fetchOptions, options.signal);
    options.signal?.throwIfAborted();
    const modes: Record<string, number> = Object.create(null);
    const seen = new Set<string>();
    const spellings = new Map<string, string>();
    const hardlinks = new Map<string, string>();
    const fileSizes = new Map<string, number>();
    let deliveredBytes = 0;
    let deliveredFiles = 0;
    let archiveRoot: string | undefined;
    const listing = tar.t({
      onReadEntry(entry) {
        try {
          const parts = entry.path.split("/");
          const container = parts.shift();
          if (
            !container ||
            (container !== "." && !safePackageComponent(container)) ||
            (archiveRoot !== undefined && archiveRoot !== container)
          )
            throw new Error("Package tarball escapes its root.");
          archiveRoot = container;
          if (parts.at(-1) === "") parts.pop();
          if (parts.some((part) => !safePackageComponent(part)))
            throw new Error("Package tarball contains an unsafe path.");
          let prefix = "";
          for (const part of parts) {
            prefix += `${part}/`;
            const key = prefix.toLowerCase();
            if (spellings.has(key) && spellings.get(key) !== prefix)
              throw new Error("Package tarball contains ambiguous path casing.");
            spellings.set(key, prefix);
          }
          const name = parts.join("/").replace(/\/$/, "");
          if (!name && entry.type === "Directory") return;
          if (
            !name ||
            seen.has(name.toLowerCase()) ||
            !["File", "Directory", ...(parsed.type === "directory" ? ["Link"] : [])].includes(
              entry.type,
            )
          )
            throw new Error("Package tarball contains a duplicate, link or special entry.");
          seen.add(name.toLowerCase());
          if (seen.size > maximumPackageFiles * 2)
            throw new Error("Objective package exceeds its path bounds.");
          if (entry.type === "Link") {
            if (typeof entry.linkpath !== "string")
              throw new Error("Directory hard link has no target.");
            const target = entry.linkpath.split("/");
            if (
              target.shift() !== archiveRoot ||
              target.some((part) => !safePackageComponent(part))
            )
              throw new Error("Directory package hard-link target escapes its delivered tree.");
            hardlinks.set(name, target.join("/"));
          } else if (entry.type === "File") {
            deliveredBytes += entry.size ?? 0;
            deliveredFiles++;
            if (deliveredBytes > maximumPackageBytes || deliveredFiles > maximumPackageFiles)
              throw new Error("Objective package exceeds its delivered-tree bounds.");
            modes[name] = entry.mode ?? 0o644;
            fileSizes.set(name, entry.size ?? 0);
          }
        } catch (error) {
          listing.abort(error instanceof Error ? error : new Error(String(error)));
        }
      },
    });
    await pipeline(createReadStream(archive), listing, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    for (const [name, target] of hardlinks) {
      const size = fileSizes.get(target);
      if (size === undefined)
        throw new Error("Directory package hard link has no verified regular target.");
      deliveredBytes += size;
      deliveredFiles++;
      if (deliveredBytes > maximumPackageBytes || deliveredFiles > maximumPackageFiles)
        throw new Error("Objective package exceeds its delivered-tree bounds.");
      modes[name] = modes[target] ?? 0o644;
    }
    const directory = join(staging, "content");
    await ensurePrivateDirectory(directory);
    await pipeline(
      createReadStream(archive),
      tar.x({
        cwd: directory,
        strip: 1,
        strict: true,
        preservePaths: false,
      }),
      { ...(options.signal === undefined ? {} : { signal: options.signal }) },
    );
    for (const name of hardlinks.keys()) {
      const path = join(directory, ...name.split("/"));
      const detached = `${path}.${randomUUID()}`;
      await writeFile(detached, await readFile(path), { flag: "wx", mode: 0o600 });
      await chmod(path, 0o600);
      await rename(detached, path);
    }
    async function sealDirectories(path: string): Promise<void> {
      await chmod(path, 0o700);
      for (const entry of await readdir(path, { withFileTypes: true }))
        if (entry.isDirectory()) await sealDirectories(join(path, entry.name));
    }
    await sealDirectories(directory);
    const manifest: unknown = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    if (
      !manifest ||
      typeof manifest !== "object" ||
      !("name" in manifest) ||
      typeof manifest.name !== "string" ||
      !isObjectivePackageName(manifest.name) ||
      ("version" in manifest && (typeof manifest.version !== "string" || !manifest.version.trim()))
    )
      throw new Error(
        "An Objective package needs an actual package.json name and a valid optional version.",
      );
    const expectedName = alias(parsed)
      ? parsed.subSpec.name
      : parsed.registry
        ? parsed.name
        : undefined;
    if (expectedName != null && expectedName !== manifest.name)
      throw new Error(`Resolved package name ${manifest.name} does not match ${expectedName}.`);
    if (
      (fetched.selectedName !== undefined && fetched.selectedName !== manifest.name) ||
      (fetched.selectedVersion !== undefined &&
        fetched.selectedVersion !== ("version" in manifest ? manifest.version : undefined))
    )
      throw new Error("Resolved npm name/version does not match the delivered package.json.");
    const digest = await digestObjectivePackage(directory, modes);
    const source: NpmObjectiveSource = {
      kind: "npm-package",
      packageName: manifest.name,
      packageDigest: digest,
      spec,
      resolved: fetched.resolved,
      ...("version" in manifest && typeof manifest.version === "string"
        ? { version: manifest.version }
        : {}),
      ...(fetched.integrity ? { integrity: String(fetched.integrity) } : {}),
      ...(parsed.type === "git" && /#(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(fetched.resolved)
        ? { commit: fetched.resolved.slice(fetched.resolved.lastIndexOf("#") + 1) }
        : {}),
    };
    validatePilotSource(source.packageName, digest, source);
    await readFile(join(directory, "objective.yaml"));
    const target = join(root, digest.slice(packageDigestFormat.length));
    await createPrivateFile(staging, "modes.json", JSON.stringify(modes));
    await rm(archive);
    for (const name of Object.keys(modes))
      await chmod(join(directory, ...name.split("/")), (modes[name] ?? 0) & 0o111 ? 0o500 : 0o400);
    try {
      await rename(staging, target);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? ""))
        throw error;
      if (
        (await digestObjectivePackage(
          join(target, "content"),
          JSON.parse(await readPrivateFile(target, "modes.json")),
        )) !== digest
      )
        throw new Error("Existing package capsule is corrupt.");
    }
    options.signal?.throwIfAborted();
    return { directory: join(target, "content"), source };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function restoreObjectivePackage(
  source: NpmObjectiveSource,
  options: PackagePreparationOptions = {},
): Promise<PreparedPackage> {
  options.signal?.throwIfAborted();
  validatePilotSource(source.packageName, source.packageDigest, source);
  const root = resolve(options.cacheDirectory ?? join(hostDirectory(), "packages"));
  const target = join(root, source.packageDigest.slice(packageDigestFormat.length));
  try {
    await ensurePrivateDirectory(root);
    const modes: unknown = JSON.parse(await readPrivateFile(target, "modes.json"));
    if (!validModes(modes)) throw new Error("Invalid frozen package modes.");
    if ((await digestObjectivePackage(join(target, "content"), modes)) !== source.packageDigest)
      throw new Error("Frozen package digest mismatch.");
    options.signal?.throwIfAborted();
    return { source, directory: join(target, "content") };
  } catch (cause) {
    throw new Error(
      `Exact frozen package ${source.packageName}@${source.packageDigest} is unavailable; explicitly prepare or migrate it. No floating spec was resolved.`,
      { cause },
    );
  }
}

export async function withNpmPilot<T>(
  location: string,
  cwd: string,
  revision: string | undefined,
  use: (spec: PilotSpec, runtime: PilotRuntime) => Promise<T>,
  options: PilotSourceOptions,
  evidence: RunEvidence | undefined,
): Promise<T> {
  if (basename(location) === "objective.yaml" && (await lstat(resolve(cwd, location))).isFile())
    location = dirname(resolve(cwd, location));
  const prepared = new Map<string, PreparedPackage>();
  const specs = new Map<string, PilotSpec>();
  const executables = new Map<string, { directory: string; revision: string }>();
  const observationInputs = new Map<string, readonly string[]>();
  const executableFiles = new Map<string, readonly string[]>();
  const lifetime = new AbortController();
  const active = new Set<Promise<unknown>>();
  const sources = new Map(Object.entries(options.sources ?? {}));
  for (const [id, source] of [...sources]) {
    if (source.kind !== "npm-package") continue;
    validatePilotSource(id, source.packageDigest, source);
    for (const [dependency, binding] of Object.entries(source.bindings ?? {})) {
      const existing = sources.get(dependency);
      if (
        existing !== undefined &&
        (existing.kind !== "npm-package" ||
          !sameObjectiveSource(packageProvenance(existing), binding))
      )
        throw new Error(`Conflicting exact dependency binding for ${dependency}.`);
      if (existing === undefined) sources.set(dependency, binding);
    }
  }
  function track<A>(pending: Promise<A>): Promise<A> {
    active.add(pending);
    void pending.finally(() => active.delete(pending)).catch(() => {});
    return pending;
  }
  for (const [id, version] of Object.entries(options.versions ?? {})) {
    const source = sources.get(id);
    if (source?.kind !== "npm-package" || source.packageDigest !== version)
      throw new Error(
        `Exact npm package source evidence is required for ${id}; no floating spec was resolved.`,
      );
  }
  const settings: PackagePreparationOptions = {
    ...(options.cacheDirectory === undefined
      ? {}
      : { cacheDirectory: join(options.cacheDirectory, "packages") }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...options.packagePreparation,
  };
  function dependencyReference(item: PreparedPackage, reference: string, raw: string) {
    const origin = npa(item.source.resolved, cwd);
    const localBase = origin.type === "directory" && origin.fetchSpec !== null;
    return {
      parsed: npa.resolve(reference, raw, localBase ? (origin.fetchSpec ?? cwd) : cwd),
      localBase,
    };
  }
  async function bind(
    specifier: string,
    expected?: string,
    source?: NpmObjectiveSource,
    requestSignal = settings.signal,
  ): Promise<PilotSpec> {
    const preparationOptions = {
      ...settings,
      ...(requestSignal === undefined
        ? {}
        : {
            signal: AbortSignal.any([
              requestSignal,
              lifetime.signal,
              ...(settings.signal ? [settings.signal] : []),
            ]),
          }),
    };
    const restored =
      source === undefined
        ? await prepareObjectivePackage(specifier, cwd, preparationOptions)
        : await restoreObjectivePackage(source, preparationOptions);
    const item = { ...restored, source: packageProvenance(restored.source) };
    const id = item.source.packageName;
    if (expected !== undefined && id !== expected)
      throw new Error(`Objective name mismatch: expected ${expected}, received ${id}.`);
    const prior = prepared.get(id);
    if (prior && !sameObjectiveSource(prior.source, item.source))
      throw new Error(`Conflicting sources for Objective ${id}.`);
    const existing = specs.get(id);
    if (existing !== undefined) return existing;
    if (prepared.size >= 128 && prior === undefined)
      throw new Error("Objective preparation exceeds its package bound.");
    prepared.set(id, item);
    const modes: unknown = JSON.parse(await readPrivateFile(dirname(item.directory), "modes.json"));
    if (!validModes(modes)) throw new Error("Invalid frozen package execution modes.");
    executableFiles.set(
      id,
      Object.entries(modes)
        .filter(([, mode]) => (mode & 0o111) !== 0)
        .map(([name]) => name),
    );
    const prefix = `npm-objective:///${encodeURIComponent(id)}/`;
    function path(uri: string) {
      if (!uri.startsWith(prefix)) throw new Error("Resource escapes its Objective package.");
      const name = decodeURIComponent(uri.slice(prefix.length));
      if (name.split("/").some((part) => part === "." || part === ".." || /[\\:]/.test(part)))
        throw new Error("Unsafe Objective resource path.");
      return join(item.directory, ...name.split("/"));
    }
    const resources: ResourceResolver = {
      version: item.source.packageDigest,
      sourceFor: async () => item.source,
      readText: (uri) => readFile(path(uri), "utf8"),
      async readPages(uri) {
        const pages: PageResource[] = [];
        async function visit(directory: string, base: string): Promise<void> {
          for (const entry of await readdir(directory, { withFileTypes: true })) {
            const child = `${base}${encodeURIComponent(entry.name)}`;
            if (entry.isDirectory()) await visit(join(directory, entry.name), `${child}/`);
            else if (entry.isFile() && entry.name.endsWith(".md"))
              pages.push({
                uri: child,
                source: await readFile(join(directory, entry.name), "utf8"),
              });
            else throw new Error("References must be Markdown files or directories.");
          }
        }
        await visit(path(uri), uri);
        return pages;
      },
    };
    const spec = await loadPilotSpec(id, resources);
    try {
      const descriptor: unknown = JSON.parse(
        await readFile(join(item.directory, "observation-inputs.json"), "utf8"),
      );
      if (
        !descriptor ||
        typeof descriptor !== "object" ||
        Object.keys(descriptor).sort().join(",") !== "contract,subjectRoot" ||
        !("contract" in descriptor) ||
        descriptor.contract !== "bounded-readonly-filesystem-v1" ||
        !("subjectRoot" in descriptor) ||
        !Array.isArray(descriptor.subjectRoot) ||
        descriptor.subjectRoot.length === 0 ||
        !descriptor.subjectRoot.every(
          (part) => typeof part === "string" && /^[A-Za-z][A-Za-z0-9]*$/.test(part),
        )
      )
        throw new Error("Invalid observation-inputs.json read-only contract.");
      observationInputs.set(id, descriptor.subjectRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const checks = spec.manifest.levels.flatMap((level) => level.checks);
    for (const level of spec.manifest.levels)
      for (const check of level.checks) {
        let directory = join(item.directory, "levels", level.id, "checks", check.id);
        try {
          await lstat(directory);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          if (checks.filter(({ id }) => id === check.id).length !== 1)
            throw new Error("Repeated check ID requires a level-scoped directory.");
          directory = join(item.directory, "checks", check.id);
        }
        const artifact = await readArtifact(directory);
        const key = JSON.stringify([id, level.id, check.id]);
        const capsule = join(
          hostDirectory(),
          "artifacts",
          createHash("sha256")
            .update(JSON.stringify([id, artifact.revision, key]))
            .digest("hex"),
        );
        await ensurePrivateDirectory(hostDirectory());
        await publishArtifact(directory, capsule);
        executables.set(key, { directory: capsule, revision: artifact.revision });
      }
    specs.set(id, spec);
    const metadata = JSON.parse(await readFile(join(item.directory, "package.json"), "utf8"));
    const references = metadata.objectiveDependencies ?? [];
    if (
      !Array.isArray(references) ||
      references.some(
        (reference) =>
          typeof reference !== "string" ||
          !isObjectivePackageName(reference) ||
          typeof metadata.dependencies?.[reference] !== "string",
      )
    )
      throw new Error("Invalid explicit Objective package dependencies.");
    const bindings: Record<string, Omit<NpmObjectiveSource, "bindings">> = {};
    for (const reference of references) {
      const { parsed: dependency, localBase } = dependencyReference(
        item,
        reference,
        metadata.dependencies[reference],
      );
      const actualName = alias(dependency) ? (dependency.subSpec.name ?? reference) : reference;
      const pinned = sources.get(actualName);
      if (pinned !== undefined && pinned.kind !== "npm-package")
        throw new Error("Legacy Objective dependency requires explicit migration.");
      if (
        !localBase &&
        ["file", "directory"].includes(dependency.type) &&
        options.packageSpecs?.[actualName] === undefined &&
        pinned === undefined
      )
        throw new Error(
          "Local Objective dependencies from delivered archives need an explicit prepared package mapping.",
        );
      const dependencySpec = await bind(
        options.packageSpecs?.[actualName] ?? dependency.toString(),
        actualName,
        pinned,
        requestSignal,
      );
      if (dependencySpec.source?.kind !== "npm-package")
        throw new Error("Missing prepared npm dependency source.");
      if (dependencySpec.objectiveId !== id)
        bindings[dependencySpec.objectiveId] = packageProvenance(dependencySpec.source);
      for (const [name, binding] of Object.entries(dependencySpec.source.bindings ?? {}))
        if (name !== id) bindings[name] = binding;
    }
    if (Object.keys(bindings).length === 0) return spec;
    const bound = Object.freeze({
      ...spec,
      source: Object.freeze({
        ...item.source,
        bindings: Object.freeze(
          Object.fromEntries(
            Object.entries(bindings).sort(([left], [right]) =>
              left < right ? -1 : left > right ? 1 : 0,
            ),
          ),
        ),
      }),
    });
    validatePilotSource(id, bound.version, bound.source);
    specs.set(id, bound);
    return bound;
  }
  const requested = npa(location, cwd);
  const requestedName = alias(requested)
    ? requested.subSpec.name
    : requested.registry
      ? requested.name
      : undefined;
  const pinned =
    (requestedName ? sources.get(requestedName) : undefined) ??
    [...sources.values()].find(
      (source) =>
        source.kind === "npm-package" &&
        (source.spec === location || source.packageName === location),
    );
  if (pinned !== undefined && pinned.kind !== "npm-package")
    throw new Error(
      "Legacy Git source evidence requires explicit migration, not npm reinterpretation.",
    );
  if (Object.keys(options.versions ?? {}).length > 0 && pinned === undefined)
    throw new Error(
      "Pinned package restoration requires its original npm spec or actual package name; no floating spec was resolved.",
    );
  if (revision !== undefined && pinned === undefined)
    throw new Error(
      "Package recovery requires exact package source evidence, not a Git revision or floating spec.",
    );
  const spec = await bind(
    location,
    requestedName ?? undefined,
    pinned?.kind === "npm-package" ? pinned : undefined,
  );
  const expectedVersion = options.versions?.[spec.objectiveId];
  if (expectedVersion !== undefined && expectedVersion !== spec.version)
    throw new Error("Initial Objective digest does not match the frozen binding.");
  async function inputView(objectiveId: string, subject: Subject, requestSignal: AbortSignal) {
    const pointer = observationInputs.get(objectiveId);
    if (pointer === undefined) return undefined;
    let value: unknown = subject;
    for (const part of pointer) {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Input-view subjectRoot must resolve to a filesystem root.");
      value = Reflect.get(value, part);
    }
    if (typeof value !== "string")
      throw new Error("Input-view subjectRoot must resolve to a filesystem root.");
    const requestedRoot = value;
    const root = await observationResource(
      `bounded-readonly-root-v1:${resolve(requestedRoot)}`,
      () => realpath(requestedRoot),
      async () => {},
    );
    return observationResource(
      `npm-bounded-readonly-filesystem-memory-v1:${root}`,
      async (signal) => {
        const view = await captureFilesystemObservation(
          root,
          AbortSignal.any([
            signal,
            requestSignal,
            lifetime.signal,
            ...(options.signal ? [options.signal] : []),
          ]),
          (diagnostic) =>
            evidence?.stream.emit("input-view.unavailable", { objectiveId, ...diagnostic }),
        );
        if (view === undefined) return undefined;
        const bytes = JSON.stringify(view);
        if (Buffer.byteLength(bytes) > 7 * 1024 * 1024) {
          evidence?.stream.emit("input-view.unavailable", { objectiveId, reason: "message-limit" });
          return undefined;
        }
        return { view, digest: createHash("sha256").update(bytes).digest("hex") };
      },
      async () => {},
    );
  }
  const runtime: PilotRuntime = {
    boundObjectives: () => [...specs.values()],
    observationRevision: (input, signal) =>
      track(inputView(input.spec.objectiveId, input.subject, signal).then((view) => view?.digest)),
    onObservation: (value) => evidence?.stream.emit("probe.observation", value),
    ...(options.observationBudget === undefined
      ? {}
      : { observationBudget: options.observationBudget }),
    resolveObjective(id, version, signal, source) {
      return track(
        (async () => {
          if (
            !isObjectivePackageName(id) ||
            (source !== undefined && source.kind !== "npm-package")
          )
            throw new Error("Legacy Git dependencies require explicit migration.");
          if (source !== undefined)
            validatePilotSource(id, version ?? source.packageDigest, source);
          signal.throwIfAborted();
          const bound = specs.get(id);
          if (bound) {
            if (
              (version !== undefined && bound.version !== version) ||
              (source !== undefined && !sameObjectiveSource(bound.source, source))
            )
              throw new Error(`Conflicting frozen binding for ${id}.`);
            return { spec: bound, runtime };
          }
          const pinned = source ?? sources.get(id);
          if (pinned !== undefined && pinned.kind !== "npm-package")
            throw new Error("Legacy Git dependencies require explicit migration.");
          if (version !== undefined && pinned === undefined)
            throw new Error("Pinned dependency is missing package source evidence.");
          const declarations = Object.values(prepared.values()).map(async (item) => ({
            item,
            manifest: JSON.parse(await readFile(join(item.directory, "package.json"), "utf8")),
          }));
          const candidates = new Set<string>();
          for (const { item, manifest } of await Promise.all(declarations)) {
            for (const [reference, raw] of Object.entries(manifest.dependencies ?? {})) {
              if (typeof raw !== "string") throw new Error("Invalid npm dependency spec.");
              const { parsed: dependency, localBase } = dependencyReference(item, reference, raw);
              const actualName = alias(dependency) ? dependency.subSpec.name : reference;
              if (actualName === id) {
                if (
                  !localBase &&
                  ["file", "directory"].includes(dependency.type) &&
                  options.packageSpecs?.[id] === undefined &&
                  pinned === undefined
                )
                  throw new Error(
                    "Local Objective dependencies from archives require an explicit prepared package mapping.",
                  );
                candidates.add(dependency.toString());
              }
            }
          }
          if (candidates.size > 1) throw new Error(`Conflicting declared sources for ${id}.`);
          const resolved = await bind(
            pinned?.spec ?? options.packageSpecs?.[id] ?? [...candidates][0] ?? id,
            id,
            pinned,
            AbortSignal.any([
              signal,
              lifetime.signal,
              AbortSignal.timeout(options.preparationTimeoutMs ?? 60_000),
            ]),
          );
          if (version !== undefined && resolved.version !== version)
            throw new Error("Pinned dependency digest mismatch.");
          return { spec: resolved, runtime };
        })(),
      );
    },
    resolveCheck(ref) {
      const executable = executables.get(
        JSON.stringify([ref.objectiveId, ref.levelId, ref.checkId]),
      );
      if (!executable) throw new Error("Unknown frozen check.");
      return (subject, signal, resolutions) => {
        return track(
          (async () => {
            const view = await inputView(ref.objectiveId, subject, signal);
            signal.throwIfAborted();
            const probe = createWorkerCheckProbe({
              ...executable,
              ...(view === undefined ? {} : { inputView: view.view }),
              objectivePackages: Object.fromEntries(
                [...prepared].map(([id, item]) => [id, item.directory]),
              ),
              objectiveSources: Object.fromEntries(
                [...prepared].map(([id, item]) => [id, item.source]),
              ),
              objectiveExecutables: Object.fromEntries(executableFiles),
              ...(options.probeTimeoutMs === undefined
                ? {}
                : { timeoutMs: options.probeTimeoutMs }),
              evidence: evidence ?? false,
              identity: ref,
            });
            return probe(
              subject,
              AbortSignal.any([
                signal,
                lifetime.signal,
                ...(options.signal ? [options.signal] : []),
              ]),
              resolutions,
            );
          })(),
        );
      };
    },
  };
  try {
    return await use(spec, runtime);
  } finally {
    lifetime.abort(new Error("Pilot scope closed."));
    await Promise.allSettled([...active]);
  }
}
