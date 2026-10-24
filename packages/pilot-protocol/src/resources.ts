import { isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  GitObjectiveSource,
  ObjectiveSource,
  PageResource,
  ObjectiveManifest,
  ReferencePage,
} from "./types.js";
import {
  fields,
  identifier,
  immutable,
  ObjectiveConfigurationError,
  parseStrictYaml,
  record,
  text,
} from "./validation.js";

export interface LoadedLocale {
  pages: ReadonlyMap<string, ReferencePage>;
}

export function isObjectivePackageName(value: string): boolean {
  return (
    /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value) &&
    value.length <= 214 &&
    !["node_modules", "favicon.ico"].includes(value)
  );
}

export function objectiveSourceVersion(source: ObjectiveSource): string {
  return source.kind === "npm-package" ? source.packageDigest : source.tree;
}
export function isObjectiveRevision(objectiveId: string, version: string): boolean {
  if (!isObjectivePackageName(objectiveId) && !objectiveId.startsWith("git+")) return false;
  return (
    canonicalObjectiveUri(objectiveId) === objectiveId &&
    (isObjectivePackageName(objectiveId)
      ? /^sha256-pguide-package-v1:[a-f0-9]{64}$/.test(version)
      : objectiveId.startsWith("git+") && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(version))
  );
}

export function sameObjectiveSource(
  left: ObjectiveSource | undefined,
  right: ObjectiveSource | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.kind === "npm-package" && right.kind === "npm-package")
    return (
      left.packageName === right.packageName &&
      left.packageDigest === right.packageDigest &&
      left.resolved === right.resolved &&
      left.version === right.version &&
      left.integrity === right.integrity &&
      left.commit === right.commit &&
      Object.keys(left.bindings ?? {}).length === Object.keys(right.bindings ?? {}).length &&
      Object.entries(left.bindings ?? {}).every(([id, source]) =>
        sameObjectiveSource(source, right.bindings?.[id]),
      )
    );
  return (
    left.kind === "git-tree" &&
    right.kind === "git-tree" &&
    left.repository === right.repository &&
    left.directory === right.directory &&
    left.commit === right.commit &&
    left.tree === right.tree &&
    left.repositoryTree === right.repositoryTree
  );
}

export function validatePilotSource(
  objectiveId: string,
  version: string,
  source: unknown,
): asserts source is ObjectiveSource {
  if (record(source) && source.kind === "npm-package") {
    fields(
      source,
      ["kind", "packageName", "packageDigest", "spec", "resolved"],
      ["version", "integrity", "commit", "bindings"],
    );
    if (
      !isObjectivePackageName(objectiveId) ||
      source.packageName !== objectiveId ||
      source.packageDigest !== version ||
      !/^sha256-pguide-package-v1:[a-f0-9]{64}$/.test(version) ||
      !text(source.spec) ||
      !text(source.resolved) ||
      (source.version !== undefined && !text(source.version)) ||
      (source.integrity !== undefined && !text(source.integrity)) ||
      (source.commit !== undefined &&
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(String(source.commit)))
    )
      throw new ObjectiveConfigurationError(
        `Invalid npm package source evidence for ${objectiveId}.`,
      );
    if (source.bindings !== undefined) {
      if (!record(source.bindings) || Object.keys(source.bindings).length > 128)
        throw new ObjectiveConfigurationError("Invalid fixed npm dependency bindings.");
      for (const [id, binding] of Object.entries(source.bindings)) {
        if (
          id === objectiveId ||
          !record(binding) ||
          binding.kind !== "npm-package" ||
          Object.hasOwn(binding, "bindings") ||
          typeof binding.packageDigest !== "string"
        )
          throw new ObjectiveConfigurationError(
            "Dependency bindings must be flat exact npm package sources.",
          );
        validatePilotSource(id, binding.packageDigest, binding);
      }
    }
    return;
  }
  validateGitPilotSource(objectiveId, version, source);
}

export function validateGitPilotSource(
  objectiveId: string,
  version: string,
  source: unknown,
): asserts source is GitObjectiveSource {
  const id = canonicalObjectiveUri(objectiveId);
  const url = new URL(id);
  const directory = decodeURIComponent(url.hash.slice(1)).replace(/\/$/, "");
  url.hash = "";
  const oid = (value: unknown) =>
    typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
  if (
    !id.startsWith("git+") ||
    !record(source) ||
    source.kind !== "git-tree" ||
    source.repository !== url.href.slice(4) ||
    source.directory !== directory ||
    !oid(source.commit) ||
    !oid(source.tree) ||
    source.tree !== version ||
    !oid(source.repositoryTree)
  )
    throw new ObjectiveConfigurationError(
      `Invalid commit/tree source evidence for ${objectiveId}.`,
    );
}

/** Directory identities are distinct from addresses of resources inside them. */
export function canonicalObjectiveUri(uri: string): string {
  if (isObjectivePackageName(uri)) return uri;
  const canonical = canonicalManifestUri(uri);
  const url = new URL(canonical);
  if (canonical.startsWith("git+")) {
    const folder = decodeURIComponent(url.hash.slice(1)).replace(/\/$/, "");
    if (["objective.yaml", "pilot.yaml"].includes(folder.split("/").at(-1) ?? ""))
      throw new ObjectiveConfigurationError(
        "Objective identity must be a directory URI, not a manifest file. Legacy pilot.yaml requires explicit objective-contract-migrate migration.",
      );
    url.hash = folder === "" ? "/" : `${folder.split("/").map(encodeURIComponent).join("/")}/`;
  } else {
    if (["/objective.yaml", "/pilot.yaml"].some((name) => url.pathname.endsWith(name)))
      throw new ObjectiveConfigurationError(
        "Objective identity must be a directory URI, not a manifest file. Legacy pilot.yaml requires explicit objective-contract-migrate migration.",
      );
    url.pathname = `${url.pathname.replace(/\/$/, "")}/`;
  }
  return url.href;
}

export function pilotResourceUri(objectiveId: string, path: string): string {
  const directory = canonicalObjectiveUri(objectiveId);
  const decoded = decodeURIComponent(path);
  if (
    !decoded ||
    decoded.startsWith("/") ||
    decoded.split("/").some((part) => part === ".." || part === "." || /[\\:]/.test(part))
  )
    throw new ObjectiveConfigurationError("Pilot resources must remain inside their directory.");
  return canonicalManifestUri(
    path,
    isObjectivePackageName(directory)
      ? `npm-objective:///${encodeURIComponent(directory)}/`
      : directory,
  );
}

export function canonicalManifestUri(uri: string, base?: string): string {
  try {
    if (uri.startsWith("git+")) {
      const url = new URL(uri);
      const path = decodeURIComponent(url.hash.slice(1));
      if (
        (path.startsWith("/") && path !== "/") ||
        /[\\:]/.test(path) ||
        [...path].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        path
          .replace(/\/$/, "")
          .split("/")
          .some(
            (part) => part === ".." || part === "." || (part === "" && path !== "" && path !== "/"),
          ) ||
        url.username ||
        url.password ||
        url.search
      ) {
        throw new ObjectiveConfigurationError(
          "Git Objective URI requires an unambiguous repository-relative fragment.",
        );
      }
      url.hash =
        path === "/" || path === "" ? "/" : path.split("/").map(encodeURIComponent).join("/");
      const repository = new URL(url.href.slice(4));
      repository.hash = "";
      return `git+${repository.href}${url.hash}`;
    }
    if (base?.startsWith("git+")) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
        throw new ObjectiveConfigurationError(
          "Git resources require a Git Objective URI or a repository-relative reference.",
        );
      }
      const url = new URL(base);
      const root = decodeURIComponent(url.hash.slice(1)).replace(/^\//, "");
      const path = new URL(uri, `https://resource.invalid/${root}`).pathname.slice(1);
      url.hash = path;
      return canonicalManifestUri(url.href);
    }
    const url = base === undefined && isAbsolute(uri) ? pathToFileURL(uri) : new URL(uri, base);
    if (url.hash || url.username || url.password || (url.protocol === "file:" && url.search)) {
      throw new ObjectiveConfigurationError(
        "Manifest URI cannot carry credentials, fragments or file queries.",
      );
    }
    if (url.protocol === "file:") return pathToFileURL(fileURLToPath(url)).href;
    const normalize = (value: string) =>
      value.replace(/%[0-9a-f]{2}/gi, (encoded) => {
        const character = String.fromCharCode(Number.parseInt(encoded.slice(1), 16));
        return /^[A-Za-z0-9._~-]$/.test(character) ? character : encoded.toUpperCase();
      });
    url.pathname = normalize(url.pathname);
    url.search = normalize(url.search);
    return url.href;
  } catch (caught) {
    if (caught instanceof ObjectiveConfigurationError) throw caught;
    if (!(caught instanceof Error)) throw caught;
    throw new ObjectiveConfigurationError(`Invalid Manifest URI: ${uri}.`, { cause: caught });
  }
}

function parsePage(resource: PageResource, id: string): ReferencePage {
  const normalized = resource.source.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/.exec(normalized);
  if (match === null || match[1] === undefined)
    throw new ObjectiveConfigurationError(`Reference page needs frontmatter: ${resource.uri}.`);
  const metadata: unknown = parseStrictYaml(match[1]);
  if (!record(metadata))
    throw new ObjectiveConfigurationError(`Invalid page metadata: ${resource.uri}.`);
  fields(metadata, ["title", "description"], ["references"]);
  if (!text(metadata.title) || !text(metadata.description)) {
    throw new ObjectiveConfigurationError(`Incomplete page metadata: ${resource.uri}.`);
  }
  if ([...metadata.description].length > 200) {
    throw new ObjectiveConfigurationError(
      `Reference description must contain at most 200 Unicode code points: ${resource.uri}.`,
    );
  }
  const references: unknown = Object.hasOwn(metadata, "references") ? metadata.references : [];
  if (
    !Array.isArray(references) ||
    !references.every(
      (reference: unknown) =>
        typeof reference === "string" &&
        /^(?:(?:system|levels|checks|problems|pages)\/[a-z0-9]+(?:-[a-z0-9]+)*|levels\/[a-z0-9-]+\/checks\/[a-z0-9-]+(?:\/problems\/[a-z0-9-]+)?)$/.test(
          reference,
        ),
    ) ||
    new Set(references).size !== references.length
  ) {
    throw new ObjectiveConfigurationError(
      `Reference references must be an array of unique page IDs: ${resource.uri}.`,
    );
  }
  const content = (match[2] ?? "").trim();
  return immutable({
    id,
    title: metadata.title,
    description: metadata.description,
    references,
    content,
  });
}

export function validateReferences(
  resources: readonly PageResource[],
  sourceUri: string,
  manifest: ObjectiveManifest,
): ReadonlyMap<string, LoadedLocale> {
  const root = canonicalManifestUri(sourceUri.endsWith("/") ? sourceUri : `${sourceUri}/`);
  const languages = new Set(manifest.languages);
  const levelIds = new Set(manifest.levels.map(({ id }) => id));
  const checks = manifest.levels.flatMap(({ checks }) => checks);
  const checkIds = new Set(checks.map(({ id }) => id));
  const problemIds = new Set(checks.flatMap(({ problems }) => problems));
  const nodes = new Map<string, Map<string, ReferencePage>>();
  for (const resource of resources) {
    const uri = canonicalManifestUri(resource.uri);
    if (!uri.startsWith(root))
      throw new ObjectiveConfigurationError(`Reference escapes source: ${uri}.`);
    const parts = decodeURIComponent(uri.slice(root.length)).split("/");
    const file = parts.at(-1);
    if (![3, 5, 7].includes(parts.length) || file === undefined || !file.endsWith(".md")) {
      throw new ObjectiveConfigurationError(
        `References require <namespace>/<id>/<language>.md: ${uri}.`,
      );
    }
    const [namespace, localId] = parts as [string, string, ...string[]];
    const language = file.slice(0, -3);
    if (
      !["system", "levels", "checks", "problems", "pages"].includes(namespace) ||
      !identifier(localId) ||
      !languages.has(language)
    ) {
      throw new ObjectiveConfigurationError(`Invalid Reference identity or language: ${uri}.`);
    }
    if (namespace === "system" && !["overview", "404"].includes(localId)) {
      throw new ObjectiveConfigurationError(`Unknown system Reference: ${localId}.`);
    }
    if (
      namespace === "levels" &&
      !["initial", "terminal"].includes(localId) &&
      !levelIds.has(localId)
    ) {
      throw new ObjectiveConfigurationError(`Unknown level Reference: ${localId}.`);
    }
    if (namespace === "checks" && !checkIds.has(localId)) {
      throw new ObjectiveConfigurationError(`Unknown check Reference: ${localId}.`);
    }
    if (namespace === "problems" && !problemIds.has(localId)) {
      throw new ObjectiveConfigurationError(`Unknown problem Reference: ${localId}.`);
    }
    if (parts.length > 3) {
      const level = manifest.levels.find(({ id }) => id === localId);
      const check = level?.checks.find(({ id }) => id === parts[3]);
      if (
        namespace !== "levels" ||
        parts[2] !== "checks" ||
        check === undefined ||
        (parts.length === 7 &&
          (parts[4] !== "problems" || parts[5] === undefined || !check.problems.includes(parts[5])))
      ) {
        throw new ObjectiveConfigurationError(`Invalid scoped Reference identity: ${uri}.`);
      }
    }
    const id = parts.slice(0, -1).join("/");
    const locales = nodes.get(id) ?? new Map<string, ReferencePage>();
    if (locales.has(language))
      throw new ObjectiveConfigurationError(`Duplicate Reference locale: ${id}/${language}.`);
    locales.set(language, parsePage(resource, id));
    nodes.set(id, locales);
  }
  const required = ["system/overview", "system/404", ...[...levelIds].map((id) => `levels/${id}`)];
  for (const level of manifest.levels) {
    for (const check of level.checks) {
      const scoped = `levels/${level.id}/checks/${check.id}`;
      const uniqueCheck = checks.filter(({ id }) => id === check.id).length === 1;
      required.push(nodes.has(scoped) ? scoped : uniqueCheck ? `checks/${check.id}` : scoped);
      for (const problem of check.problems) {
        const scopedProblem = `${scoped}/problems/${problem}`;
        const uniqueProblem =
          checks.flatMap(({ problems }) => problems).filter((id) => id === problem).length === 1;
        required.push(
          nodes.has(scopedProblem)
            ? scopedProblem
            : uniqueProblem
              ? `problems/${problem}`
              : scopedProblem,
        );
      }
    }
  }
  for (const id of required) {
    if (!nodes.has(id)) throw new ObjectiveConfigurationError(`Missing Reference: ${id}.`);
  }
  for (const [id, locales] of nodes) {
    if (
      locales.size !== languages.size ||
      [...languages].some((language) => !locales.has(language))
    ) {
      throw new ObjectiveConfigurationError(`Reference must cover every language: ${id}.`);
    }
  }
  for (const locales of nodes.values())
    for (const page of locales.values()) {
      for (const reference of page.references) {
        if (!nodes.has(reference))
          throw new ObjectiveConfigurationError(
            `Dangling Reference metadata link from ${page.id}: ${reference}.`,
          );
      }
      for (const match of page.content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
        if (match[1] === undefined || !nodes.has(match[1]))
          throw new ObjectiveConfigurationError(`Dangling References link: ${match[1]}.`);
      }
    }
  return new Map(
    manifest.languages.map((language) => [
      language,
      {
        pages: new Map(
          [...nodes].map(([id, locales]) => {
            const page = locales.get(language);
            if (page === undefined)
              throw new ObjectiveConfigurationError(`Reference must cover every language: ${id}.`);
            return [id, page];
          }),
        ),
      },
    ]),
  );
}
