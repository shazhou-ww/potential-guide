import assert from "node:assert/strict";
import test from "node:test";
import {
  type ArtifactObjectiveSource,
  canonicalObjectiveUri,
  isObjectiveRevision,
  objectiveSourceVersion,
  pilotResourceUri,
  sameObjectiveSource,
  validatePilotSource,
} from "../src/index.js";

test("artifact evidence has a separate exact identity and cannot reinterpret historical revisions", () => {
  const id = "objective:composition";
  const digest = `sha256-pguide-objective-v1:${"a".repeat(64)}`;
  const source: ArtifactObjectiveSource = {
    kind: "objective-artifact",
    objectiveId: id,
    artifactDigest: digest,
    directory: process.cwd(),
    checks: {
      local: { digest: `sha256-pguide-check-v1:${"b".repeat(64)}`, revision: "c".repeat(64) },
    },
  };
  validatePilotSource(id, digest, source);
  assert.equal(canonicalObjectiveUri(id), id);
  assert.equal(objectiveSourceVersion(source), digest);
  assert.ok(isObjectiveRevision(id, digest));
  assert.equal(isObjectiveRevision(id, "a".repeat(40)), false);
  assert.equal(isObjectiveRevision("legacy-package", digest), false);
  assert.throws(() => pilotResourceUri(id, "references/page.md"), /origin\/resourceBase/);
  for (const changed of [
    { ...source, artifactDigest: "latest" },
    { ...source, packageDigest: digest },
    { ...source, checks: { local: { ...source.checks.local, revision: digest } } },
    { ...source, bindings: { [id]: source } },
  ])
    assert.throws(() => validatePilotSource(id, digest, changed));
  assert.equal(sameObjectiveSource(source, structuredClone(source)), true);
  assert.equal(sameObjectiveSource(source, { ...source, checks: {} }), false);
});
