import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const recorded = JSON.parse(
  await readFile(new URL("./inner/Measurements.json", import.meta.url), "utf8"),
);
assert.equal(recorded.measurements.length, 8);
const verified = [];
for (const expected of recorded.measurements) {
  const { role, artifactSha256, ...measurement } = expected;
  const relativePath = `./raw/${expected.node.slice(1)}/${role}/${expected.label}.json`;
  const bytes = await readFile(new URL(relativePath, import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), artifactSha256);
  assert.deepEqual(JSON.parse(bytes.toString("utf8")), measurement);
  assert.equal(measurement.code, 0);
  verified.push({ role, artifactSha256, ...measurement });
}
const comparisons = [];
for (const node of ["v22.13.0", "v24.11.1"]) {
  for (const [label, thresholdPercent] of [
    ["cold", 10],
    ["warm", 25],
  ]) {
    const select = (role) => {
      const matches = verified.filter(
        (entry) => entry.node === node && entry.label === label && entry.role === role,
      );
      assert.equal(matches.length, 1);
      return matches[0];
    };
    const controlSeconds = select("control").seconds;
    const candidateSeconds = select("candidate").seconds;
    const improvementPercent = ((controlSeconds - candidateSeconds) / controlSeconds) * 100;
    assert.ok(improvementPercent >= thresholdPercent);
    comparisons.push({
      node,
      label,
      controlSeconds,
      candidateSeconds,
      improvementPercent,
      thresholdPercent,
    });
  }
}
console.log(
  JSON.stringify(
    {
      kind: "historical-artifact-reverification-not-new-benchmark",
      verifier: "./VerifyMeasurements.mjs",
      benchmarkRun: recorded.benchmarkRun,
      controlRevision: recorded.controlRevision,
      candidateRevision: recorded.candidateRevision,
      verified,
      comparisons,
    },
    null,
    2,
  ),
);
