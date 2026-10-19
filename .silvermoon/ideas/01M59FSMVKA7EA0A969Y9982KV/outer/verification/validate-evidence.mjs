import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = import.meta.dirname;
const json = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
for (const file of ["monorepo-git.json", "monorepo-installed.json"]) {
  const report = await json(file);
  assert.equal(report.scenarios.length, 5);
  assert.ok(report.scenarios.every(({ passed }) => passed));
  assert.equal(report.cleaned, true);
}
const health = await json("health-docker.json");
assert.equal(health.scenarios.length, 33);
assert.ok(health.scenarios.every(({ passed }) => passed));
assert.equal(health.passed, true);
assert.equal(health.cleaned, true);
for (const [directory, source] of [
  ["setup-self-runs", "6c75d927aaefe361cb85746c055cb1a01114ad1c"],
  ["current-setup-self-runs", "7f1487ad93741f9fafd8c73560d2acf6b871101a"],
]) {
  const runs = await readdir(join(root, directory));
  assert.equal(runs.length, 6);
  const combinations = new Set();
  for (const run of runs) {
    const base = join(directory, run);
    const report = await json(join(base, "verification.json"));
    combinations.add(`${report.kind}/${report.mode}`);
    assert.equal(report.sourceRevision, source);
    assert.equal(report.promptCount, 1);
    assert.equal(report.scratchCleaned, true);
    assert.equal(report.verified, true);
    const probe = await json(join(base, "probe.json"));
    assert.equal(probe.status, 200);
    assert.equal(probe.payload.versions[
      `git+file:///opt/objective#packages/pguide-${report.kind}-pilot/pilot.yaml`
    ], report.objectiveRevision);
    assert.equal(probe.payload.current.levelId, report.mode === "fix" ? "terminal" : "configured");
    if (report.mode === "fix") assert.deepEqual(probe.payload.problems, []);
    else assert.ok(probe.payload.problems.some(({ ref }) => ref.problemId === "sanity-failed"));
    const prompts = (await readFile(join(root, base, "prompts.jsonl"), "utf8"))
      .trim().split("\n").map(JSON.parse);
    assert.deepEqual(prompts, [{ method: "session/prompt", mode: report.mode }]);
    assert.deepEqual(await readdir(join(root, base, "scratch")), ["keep.txt"]);
    assert.equal(await readFile(join(root, base, "scratch", "keep.txt"), "utf8"), "unrelated scratch survives");
  }
  assert.equal(combinations.size, 6);
}
const fixture = await json("fixture-behavior.json");
for (const field of ["verified", "actualMaterialization", "markerAndCacheIgnored",
  "cleanGitStatusAfterCacheWrite", "markerCheckerIgnoresTemplateContents", "ownedScratchRemoved"])
  assert.equal(fixture[field], true);
assert.equal(fixture.modelPrompts, 0);
console.log("Evidence verified: 10 monorepo observations, 12 installed setup/self-check probes, 33 health scenarios, materialized ignore behavior and owned cleanup.");
