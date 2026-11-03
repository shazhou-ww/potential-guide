import { killProcessTree, stateRoot } from "@potential-guide/cli-core";
import {
  ensurePrivateDirectory,
  readPrivateFile,
  createPrivateFile,
} from "@potential-guide/check-runtime-files";
import {
  isObjectivePackageName,
  type NpmObjectiveSource,
  validatePilotSource,
} from "@potential-guide/objective-pilot";
import { fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { chmod, lstat, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import npa from "npm-package-arg";
import type { FetchResult } from "pacote";
import * as tar from "tar";
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
        const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        let bytes: Buffer;
        let observedMode: number;
        try {
          // Match Check Host's handle-bound read: NTFS can update path ChangeTime on first read.
          const stable = await handle.stat({ bigint: true });
          const missingDevice = process.platform === "win32" && before.dev === 0n;
          if (
            stable.ino !== before.ino ||
            (!missingDevice && stable.dev !== before.dev) ||
            !stable.isFile() ||
            stable.nlink !== 1n ||
            stable.size > BigInt(maximumPackageBytes - total)
          )
            throw new Error("Package changed while calculating its digest.");
          bytes = await handle.readFile();
          const after = await handle.stat({ bigint: true });
          if (
            stable.mtimeNs !== after.mtimeNs ||
            stable.ctimeNs !== after.ctimeNs ||
            after.nlink !== 1n ||
            BigInt(bytes.length) !== stable.size
          )
            throw new Error("Package changed while calculating its digest.");
          observedMode = Number(stable.mode);
        } finally {
          await handle.close();
        }
        const mode = modes && Object.hasOwn(modes, name) ? (modes[name] ?? 0) : observedMode;
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
  const root = resolve(options.cacheDirectory ?? join(stateRoot(), "packages"));
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
  const root = resolve(options.cacheDirectory ?? join(stateRoot(), "packages"));
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
