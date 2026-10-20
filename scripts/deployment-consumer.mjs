import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { releaseVersion } from "./release-packages.mjs";

export function consumerMode(args) {
  assert.ok(
    args.every((arg) => ["--published", "--latest"].includes(arg)),
    "Unknown verification argument",
  );
  assert.ok(
    new Set(args).size === args.length && args.length <= 1,
    "Select only one consumer mode",
  );
  return args[0] === "--latest" ? "latest" : args[0] === "--published" ? "published" : "packed";
}

export function consumerManifest(mode, versions, tarballs = new Map(), entries = ["pguide"]) {
  assert.ok(["packed", "published", "latest"].includes(mode), "Unknown consumer mode");
  for (const [name, version] of versions) {
    assert.ok(releaseVersion.test(version), `Unsupported release version: ${name}@${version}`);
    if (mode === "packed") assert.ok(tarballs.has(name), `Missing tarball: ${name}`);
  }
  assert.ok(versions.has("pguide"), "Missing entry package");
  return {
    name: "pguide-deployment-consumer",
    private: true,
    dependencies: Object.fromEntries(
      entries.map((name) => [
        name,
        mode === "packed"
          ? pathToFileURL(tarballs.get(name)).href
          : mode === "latest" && name === "pguide"
            ? "latest"
            : versions.get(name),
      ]),
    ),
    ...(mode === "packed"
      ? {
          overrides: Object.fromEntries(
            [...tarballs]
              .filter(([name]) => name !== "pguide")
              .map(([name, path]) => [name, pathToFileURL(path).href]),
          ),
        }
      : {}),
  };
}

export function assertLatestVersion(actual, expected) {
  assert.equal(actual, expected, "Registry pguide@latest must match the candidate manifest");
}

// Resolve from each actual parent, not just a flat top-level node_modules directory:
// a nested incompatible internal dependency must not be hidden by a correct hoisted copy.
export async function verifyConsumerGraph(consumer, versions, entries = ["pguide"]) {
  const visited = new Set();
  const reached = new Set();
  async function visit(name, from) {
    const require = createRequire(from);
    let path;
    let manifest;
    for (const directory of require.resolve.paths(name) ?? []) {
      const candidate = join(directory, ...name.split("/"), "package.json");
      const location = relative(consumer, candidate);
      if (isAbsolute(location) || location === ".." || location.startsWith(`..${sep}`)) continue;
      try {
        manifest = JSON.parse(await readFile(candidate, "utf8"));
        path = await realpath(candidate);
        const physicalLocation = relative(consumer, path);
        assert.ok(
          !isAbsolute(physicalLocation) &&
            physicalLocation !== ".." &&
            !physicalLocation.startsWith(`..${sep}`),
          `Dependency escaped consumer: ${path}`,
        );
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    assert.ok(path, `Missing transitive package: ${name} from ${from}`);
    if (visited.has(path)) return;
    visited.add(path);
    assert.equal(manifest.name, name);
    assert.equal(manifest.version, versions.get(name), `Unexpected transitive version: ${name}`);
    reached.add(name);
    for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
      assert.doesNotMatch(range, /^workspace:/u, `${name}: unresolved workspace range`);
      if (versions.has(dependency)) {
        assert.equal(
          range,
          `^${versions.get(dependency)}`,
          `${name}: packed internal range must match the upstream candidate`,
        );
        await visit(dependency, path);
      }
    }
  }
  for (const entry of entries) await visit(entry, join(consumer, "package.json"));
  assert.deepEqual(
    [...reached].sort(),
    [...versions.keys()].sort(),
    "Selected entries must reach every expected internal package",
  );
}
