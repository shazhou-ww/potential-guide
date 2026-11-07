import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const [base, destination] = process.argv.slice(2).map((path) => resolve(path));
await mkdir(destination, { recursive: true });
const copyDirectory = async (source, target) => {
  await mkdir(target, { recursive: true });
  for (const filename of await readdir(source)) {
    await copyFile(join(source, filename), join(target, filename));
  }
};
await copyDirectory(join(base, "consumer", "proof"), destination);
await copyDirectory(join(base, "consumer", "proof-initial"), join(destination, "initial-run"));
await copyDirectory(join(base, "consumer", "proof-prelint"), join(destination, "prelint-run"));
for (const filename of [
  "tarballs.json",
  "npm-graph.json",
  "npm-install.log",
  "pack.log",
  "build.log",
  "install.log",
  "install-alternative.log",
  "install-relay.log",
  "deployment-run.log",
  "deployment-run-initial.log",
  "deployment-run-prelint.log",
  "deployment-run-setup-error.log",
]) {
  await copyFile(join(base, "author-cache", filename), join(destination, filename));
}
for (const filename of ["package.json", "package-lock.json", "verify-consumer.mjs"]) {
  await copyFile(join(base, "consumer", filename), join(destination, filename));
}
const proof = JSON.parse(await readFile(join(destination, "deployment.json"), "utf8"));
assert.deepEqual(proof.counts, { pass: 16, fail: 0 });
assert.equal(proof.fatal, undefined);
assert.equal(proof.cleanup.length, 9);
assert.ok(proof.cleanup.every((item) => item.closed === true || item.graceful === true));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const paths = [
  ...(await readdir(destination)).filter((name) => !["initial-run", "prelint-run"].includes(name)),
  ...(await readdir(join(destination, "initial-run"))).map((name) => `initial-run/${name}`),
  ...(await readdir(join(destination, "prelint-run"))).map((name) => `prelint-run/${name}`),
];
const files = [];
for (const path of paths) {
  const bytes = await readFile(join(destination, path));
  files.push({ path, bytes: bytes.length, sha256: hash(bytes) });
}
await writeFile(
  join(destination, "provenance.json"),
  JSON.stringify(
    {
      sourceCommit: "5b02ee0cd4c12d1cf0c0700171d8f4d8dbcba424",
      sourceTree: "32a9643c39b0dafd5c45f1822c82b26d0742325f",
      synchronizedOuterRevisionBeforeVerification: "738ed3a6641b",
      sourceArchiveSha256: "9bbdb0f9cecf88f7bbcc6bb86144ff9f39803d38ad9b316c2ff045ebaaf4b5ea",
      nativeOwnedRoot: base,
      authorInstall:
        "pnpm 11.22.0 install --frozen-lockfile; normal existing store and supply-chain policy",
      authorBuild: "pnpm build",
      consumerInstall:
        "npm 11.11.0 install --ignore-scripts --no-audit --no-fund --cache ../author-cache/npm-cache",
      consumerGraph: "npm ls --all --json, exit 0",
      consumerOnlyPath: proof.runtime.path,
      finalCounts: proof.counts,
      initialCounts: JSON.parse(
        await readFile(join(destination, "initial-run", "deployment.json"), "utf8"),
      ).counts,
      prelintCounts: JSON.parse(
        await readFile(join(destination, "prelint-run", "deployment.json"), "utf8"),
      ).counts,
      finalScriptSha256: proof.verificationScriptSha256,
      sharedScriptSha256: proof.sharedConsumerScriptSha256,
      lockfileSha256: proof.lockfileSha256,
      setupCorrections: [
        "Fresh explicit pnpm store encountered ECONNREFUSED through inherited localhost:10808 proxy; operation stopped.",
        "One offline normal-store alternative explicitly failed ERR_PNPM_NO_OFFLINE_META, without disabling policy.",
        "A restricted owned TLS relay to the two authorized origins restored actual native HTTPS reads.",
        "Author helper map(resolve) argument error corrected before packing.",
        "Final verifier rerun hit owned-directory EEXIST before scenarios/helpers; corrected with recursive owned-directory creation. Raw failure retained.",
      ],
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    destination,
    counts: proof.counts,
    deploymentSha256: hash(await readFile(join(destination, "deployment.json"))),
    provenanceSha256: hash(await readFile(join(destination, "provenance.json"))),
  }),
);
