import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  canonicalManifestUri,
  canonicalObjectiveUri,
  pilotResourceUri,
  validateGitPilotSource,
} from "../src/index.js";

test("legacy commit-only and forged source evidence cannot be treated as directory tree evidence", () => {
  const id = "git+https://example.test/r.git#rules/";
  const tree = "a".repeat(40);
  const source = {
    kind: "git-tree",
    repository: "https://example.test/r.git",
    directory: "rules",
    tree,
    commit: "b".repeat(40),
    repositoryTree: "c".repeat(40),
  };
  assert.doesNotThrow(() => validateGitPilotSource(id, tree, source));
  for (const value of [
    undefined,
    tree,
    { ...source, kind: "commit" },
    { ...source, tree: source.commit },
    { ...source, directory: "other" },
    { ...source, repositoryTree: undefined },
  ])
    assert.throws(() => validateGitPilotSource(id, tree, value), /evidence/);
});

test("directory identity normalizes roots, trailing slash, encoded names and Windows file paths without trimming resources", () => {
  for (const value of [
    "git+https://example.test/r.git#rules",
    "git+https://example.test/r.git#rules/",
    "git+https://example.test/r.git#%72ules/",
    "git+https://EXAMPLE.test:443/r.git#%72ules/",
  ])
    assert.equal(canonicalObjectiveUri(value), "git+https://example.test/r.git#rules/");
  for (const value of [
    "git+https://example.test/r.git",
    "git+https://example.test/r.git#",
    "git+https://example.test/r.git#/",
  ])
    assert.equal(canonicalObjectiveUri(value), "git+https://example.test/r.git#/");
  assert.equal(
    pilotResourceUri("git+https://example.test/r.git#/", "pilot.yaml"),
    "git+https://example.test/r.git#pilot.yaml",
  );
  assert.equal(
    pilotResourceUri("git+https://example.test/r.git#folder", "checks/run.js"),
    "git+https://example.test/r.git#folder/checks/run.js",
  );
  assert.notEqual(
    canonicalManifestUri("git+https://example.test/r.git#a/run.js"),
    canonicalManifestUri("git+https://example.test/r.git#a/pilot.yaml"),
  );
  const local = resolve("packages", "objective-pilot");
  assert.equal(canonicalObjectiveUri(local), `${pathToFileURL(local).href}/`);
  assert.equal(
    canonicalObjectiveUri(`${pathToFileURL(local).href}/`),
    canonicalObjectiveUri(local),
  );
});

test("identity rejects old manifest IDs and path escapes, while distinct folders remain distinct", () => {
  for (const value of [
    "#rules/pilot.yaml",
    "#../rules/",
    "#rules/../a/",
    "#rules//",
    "#/absolute/",
    "#rules\\a",
    "#%00",
    "#a%3Ab/",
  ]) {
    assert.throws(
      () => canonicalObjectiveUri(`git+https://example.test/r.git${value}`),
      /directory|unambiguous|Invalid/,
    );
  }
  for (const path of ["../a", "%2e%2e/a", "/a", "a\\b", "a:b"])
    assert.throws(() => pilotResourceUri("git+https://example.test/r.git#rules/", path));
  assert.notEqual(
    canonicalObjectiveUri("git+https://example.test/r.git#one/"),
    canonicalObjectiveUri("git+https://example.test/r.git#two/"),
  );
});
