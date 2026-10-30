import assert from "node:assert/strict";
import { createRequire, registerHooks, syncBuiltinESMExports } from "node:module";
import { relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
let forbiddenIoCalls = 0;
const denied = () => {
  forbiddenIoCalls++;
  throw Error("Contract entry attempted forbidden IO.");
};
for (const [module, names] of [
  ["node:fs", ["writeFile", "writeFileSync", "appendFile", "appendFileSync", "mkdir", "mkdirSync", "createWriteStream", "rename", "renameSync", "unlink", "unlinkSync", "rm", "rmSync", "chmod", "chmodSync"]],
  ["node:fs/promises", ["writeFile", "appendFile", "mkdir", "rename", "unlink", "rm", "chmod"]],
  ["node:net", ["connect", "createConnection"]],
  ["node:http", ["request", "get", "createServer"]],
  ["node:https", ["request", "get", "createServer"]],
  ["node:worker_threads", ["Worker"]],
  ["node:child_process", ["spawn", "spawnSync", "fork", "exec", "execSync", "execFile", "execFileSync"]],
]) for (const name of names) require(module)[name] = denied;
globalThis.fetch = denied;
syncBuiltinESMExports();
const resolved = new Set();
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const resolution = next(specifier, context);
    resolved.add(resolution.url);
    return resolution;
  },
});
const c = await import("@potential-guide/check-artifacts/contracts");
const local = { kind: "checker", url: pathToFileURL(resolve("not-required-to-exist.tgz")).href, digest: `sha256:${"a".repeat(64)}` };
assert.deepEqual(c.parseArtifactReference(c.formatArtifactReference(local)), local);
assert.equal(c.parseFileArtifactUrl(local.url), resolve("not-required-to-exist.tgz"));
assert.throws(() => c.validateArtifactReference({ ...local, kind: "objective" }));
assert.throws(() => c.validateArtifactReference({ ...local, url: `${local.url}?query=denied` }));
const page = Buffer.from("---\ntitle: Independent\ndescription: Independent\n---\nBody\n");
const value = {
  $schema: c.checkerSchemaUri, runtime: { type: "node", minVersion: "22.13.0" },
  entry: "checker.cjs", subjectSchema: { type: "object" }, languages: ["en"], problems: [],
};
const manifestBytes = Buffer.from(JSON.stringify(value));
const manifest = c.parseCheckerManifest(manifestBytes);
const files = new Map([
  ["checker.yaml", manifestBytes], ["checker.cjs", Buffer.from("exports.execute=()=>{}")],
  ["references/en/checker.md", page],
]);
const artifact = c.inspectContractFiles(files);
assert.equal(artifact.digest, c.gitTreeDigest(files));
assert.ok(c.validateArtifactSubject(manifest, c.mapSubject("$", {})));
assert.equal(c.parseCheckerResult({ status: 200, message: "", payload: { ok: true, problems: [] } }, manifest).ok, true);
c.assertRuntime(manifest, { type: "node", version: process.versions.node });
assert.throws(() => c.inspectContractFiles(new Map([["checker.yaml", manifestBytes]])));
assert.throws(() => c.parseCheckerManifest(Buffer.from(JSON.stringify({ ...value, unknown: true }))));
const changed = new Map(files);
changed.set("checker.cjs", Buffer.from("exports.execute=()=>null"));
assert.notEqual(c.gitTreeDigest(changed), artifact.digest);
const unavailable = c.parseCheckerManifest(Buffer.from(JSON.stringify({ ...value, runtime: { type: "node", minVersion: "999.0.0" } })));
assert.throws(() => c.assertRuntime(unavailable, { type: "node", version: process.versions.node }));
const objective = {
  $schema: c.objectiveSchemaUri, subjectSchema: { type: "object" }, languages: ["en"],
  levels: [{ id: "ready", checks: ["check"] }],
  checkers: { check: { url: "https://deployment.invalid/checker.tgz", digest: artifact.digest, subjectMapping: "$" } },
};
const objectiveBytes = Buffer.from(JSON.stringify(objective));
c.parseObjectiveArtifactManifest(objectiveBytes);
const objectiveFiles = new Map([
  ["objective.yaml", objectiveBytes], ["references/en/objective.md", page], ["references/en/levels/ready.md", page],
]);
const objectiveArtifact = c.inspectContractFiles(objectiveFiles);
objectiveFiles.delete("references/en/levels/ready.md");
assert.throws(() => c.inspectContractFiles(objectiveFiles));
hooks.deregister();
const imports = [...resolved].map((url) => {
  if (!url.startsWith("file:")) return url;
  const path = relative(process.cwd(), fileURLToPath(url));
  assert.ok(!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
  return path;
});
assert.ok(!imports.some((path) => /^node:(?:fs|net|https?|tls|dgram|child_process|worker_threads)(?:\/|$)/.test(path)));
assert.ok(!imports.some((path) => /check-artifacts[\\/]dist[\\/](?:index|archive|build|manifest)\.js$/.test(path)));
assert.equal(forbiddenIoCalls, 0);
console.log(JSON.stringify({
  status: "passed", checkerDigest: artifact.digest, objectiveDigest: objectiveArtifact.digest,
  forbiddenIoCalls, manifests: ["checker", "objective"], subjectAndResult: true,
  missingFilesRejected: true, unknownFieldsRejected: true, changedDigestDetected: true,
  missingReferencesRejected: true, actualRuntimeCheckedSeparately: true,
  importedFrom: import.meta.resolve("@potential-guide/check-artifacts/contracts"),
  fileReferenceRoundtrip: local,
  actualImportGraph: imports,
}));
