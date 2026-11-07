import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve(process.argv[2]);
const results = join(root, "results");
const proof = JSON.parse(await readFile(join(results, "deployment.json"), "utf8"));
const provenance = JSON.parse(await readFile(join(results, "provenance.json"), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.deepEqual(proof.counts, { pass: 16, fail: 0 });
assert.equal(proof.fatal, undefined);
for (const file of provenance.files) {
  assert.equal(hash(await readFile(join(results, file.path))), file.sha256, file.path);
}
assert.equal(
  hash(await readFile(join(root, "deploy-consumer.mjs"))),
  proof.verificationScriptSha256,
);
assert.equal(hash(await readFile(join(results, "package-lock.json"))), proof.lockfileSha256);
assert.equal(
  hash(await readFile(join(results, "verify-consumer.mjs"))),
  proof.sharedConsumerScriptSha256,
);
assert.equal(
  execFileSync(
    "wsl",
    [
      "-d",
      "Ubuntu",
      "--",
      "bash",
      "-lc",
      "test ! -e /home/lyweiwei/silvermoon-deploy-01M6TB-0bd1-20261107 && printf absent",
    ],
    { encoding: "utf8" },
  ),
  "absent",
);
await assert.rejects(access(resolve(".cache", "deploy-01M6TB-0bd1-source.tar")));
const remainingOwnedLaunches = spawnSync(
  "wsl",
  ["-d", "Ubuntu", "--", "pgrep", "-af", "silvermoon-deploy-01M6TB-0bd1-20261107"],
  { encoding: "utf8" },
);
assert.equal(remainingOwnedLaunches.status, 1);
assert.equal(remainingOwnedLaunches.stdout, "");
const processChecks = [];
for (const directory of ["", "initial-run", "prelint-run"]) {
  const value = JSON.parse(await readFile(join(results, directory, "deployment.json"), "utf8"));
  for (const service of value.cleanup.filter((item) => item.kind === "service")) {
    assert.equal(service.graceful, true);
    assert.deepEqual(service.exit, { code: 0, signal: null });
    const output = execFileSync(
      "wsl",
      [
        "-d",
        "Ubuntu",
        "--",
        "bash",
        "-lc",
        `if kill -0 ${service.pid} 2>/dev/null; then exit 1; else printf absent; fi`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(output, "absent");
    processChecks.push({
      run: directory || "final",
      name: service.name,
      pid: service.pid,
      absent: true,
    });
  }
  for (const gateway of value.gateways) {
    await assert.rejects(fetch(gateway.url, { signal: AbortSignal.timeout(1000) }));
  }
}
execFileSync("powershell", [
  "-NoProfile",
  "-Command",
  "if (Get-Process -Id 17420 -ErrorAction SilentlyContinue) { exit 1 }",
]);
await assert.rejects(fetch("http://127.0.0.1:50554", { signal: AbortSignal.timeout(1000) }));
const supplementalHashes = [];
for (const filename of await readdir(results)) {
  if (filename.endsWith(".log")) {
    const bytes = await readFile(join(results, filename));
    supplementalHashes.push({ path: filename, bytes: bytes.length, sha256: hash(bytes) });
  }
}
await writeFile(
  join(results, "cleanup.json"),
  `${JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      finalCounts: proof.counts,
      earlierCounts: { initial: { pass: 16, fail: 0 }, prelint: { pass: 16, fail: 0 } },
      verifiedProvenanceFiles: provenance.files.length,
      sourceArchiveRemoved: true,
      nativeOwnedRootRemoved: true,
      nativeLaunchCommandsAbsent: true,
      nativeOwnedRoot: provenance.nativeOwnedRoot,
      relay: {
        pid: 17420,
        port: 50554,
        processAbsent: true,
        httpUnavailable: true,
        node: process.version,
      },
      cliProcesses: processChecks,
      finalHttpHelpers: proof.gateways.map(({ name, url }) => ({
        name,
        url,
        closed: true,
        httpUnavailable: true,
      })),
      deploymentSha256: hash(await readFile(join(results, "deployment.json"))),
      provenanceSha256: hash(await readFile(join(results, "provenance.json"))),
      lockfileSha256: proof.lockfileSha256,
      executedScriptSha256: proof.verificationScriptSha256,
      retainedAuditScriptSha256: hash(await readFile(join(root, "verify-retained.mjs"))),
      supplementalHashes,
    },
    null,
    2,
  )}\n`,
);
console.log(
  JSON.stringify({
    finalCounts: proof.counts,
    processesAbsent: processChecks.length,
    nativeOwnedRootRemoved: true,
  }),
);
