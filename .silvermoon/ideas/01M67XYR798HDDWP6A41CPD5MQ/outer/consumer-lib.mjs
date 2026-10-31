import assert from "node:assert/strict";
import { mkdir, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkerSchemaUri, objectiveSchemaUri } from "@potential-guide/check-artifacts/contracts";
import { writeContractArtifact, packContractArtifact } from "@potential-guide/check-artifacts/build";
import { createArtifactSource, createCheckTaskType } from "@potential-guide/check-task";
import { createProbeTaskType } from "@potential-guide/probe-task";
import { startTaskServer } from "@potential-guide/task-engine-server";
import { openSqliteStore } from "@potential-guide/task-engine-storage";
import { TaskError } from "@potential-guide/task-protocol";

export const root = resolve(process.env.VALIDATION_ROOT);
export const caller = { scope: "a", subject: "fixture" };
export const page = (title) => Buffer.from(`---\ntitle: ${title}\ndescription: 自有验证制品\n---\n自有验证正文。\n`);
export function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
export async function until(read, predicate, limit = 12000) {
  const end = Date.now() + limit;
  let value;
  do {
    value = await read();
    if (predicate(value)) return value;
    await new Promise((done) => setTimeout(done, 10));
  } while (Date.now() < end);
  throw new Error(`外部观察超时：${JSON.stringify(value)}`);
}
export async function http(url, path, body, scope = "a") {
  const response = await fetch(url + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer fixture-${scope}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
export async function bundles() {
  const directory = join(root, "artifacts");
  await mkdir(directory, { recursive: true });
  const checkUrl = process.env.VALIDATION_HTTPS_ORIGIN + "/checker.tgz";
  const rootUrl = process.env.VALIDATION_HTTPS_ORIGIN + "/objective.tgz";
  const versions = {};
  for (const version of ["v1", "v2"]) {
    const checker = await writeContractArtifact(new Map([
      ["checker.yaml", Buffer.from(JSON.stringify({
        $schema: checkerSchemaUri, runtime: { type: "node", minVersion: "22.13.0" },
        entry: "checker.cjs", subjectSchema: { type: "object" }, languages: ["en"], problems: ["version"],
      }))],
      ["checker.cjs", Buffer.from(`exports.execute=async(s,c)=>{c.progress({version:"${version}"});await new Promise(r=>setTimeout(r,350));return {status:200,message:"",payload:{ok:false,problems:[{kind:"internal",id:"version",parameters:{version:"${version}"}}]}}}`)],
      ["references/en/checker.md", page(version)],
      ["references/en/problems/version.md", page(version)],
    ]), join(directory, `checker-${version}`));
    const objective = await writeContractArtifact(new Map([
      ["objective.yaml", Buffer.from(JSON.stringify({
        $schema: objectiveSchemaUri, subjectSchema: { type: "object" }, languages: ["en"],
        levels: [{ id: "ready", checks: ["check"] }],
        checkers: { check: { url: checkUrl, digest: checker.digest, subjectMapping: "$" } },
      }))],
      ["references/en/objective.md", page(`root-${version}`)],
      ["references/en/levels/ready.md", page(`root-${version}`)],
    ]), join(directory, `objective-${version}`));
    await packContractArtifact(checker.directory, join(directory, `checker-${version}.tgz`));
    await packContractArtifact(objective.directory, join(directory, `objective-${version}.tgz`));
    versions[version] = { checker: checker.digest, objective: objective.digest };
  }
  await copyFile(join(directory, "checker-v1.tgz"), join(directory, "floating-checker.tgz"));
  await copyFile(join(directory, "objective-v1.tgz"), join(directory, "floating-objective.tgz"));
  return { directory, checkUrl, rootUrl, versions };
}
export function access(request) {
  const value = request.headers.get("authorization");
  if (value === "Bearer fixture-a") return caller;
  if (value === "Bearer fixture-b") return { scope: "b", subject: "fixture" };
  throw new TaskError("unauthenticated", "自有消费者认证必选。");
}
export async function assembly(database, gates = new Map(), extra = []) {
  const reads = [];
  const base = createArtifactSource({
    allowedOrigins: [process.env.VALIDATION_HTTPS_ORIGIN], allowedFileRoots: [join(root, "artifacts")],
    authorize(_reference, scope) {
      if (scope !== "a") throw new TaskError("forbidden", "自有 source 拒绝此 scope。");
    },
  });
  const source = {
    authorize: base.authorize,
    async resolve(reference, scope, signal) {
      const artifact = await base.resolve(reference, scope, signal);
      reads.push({ reference, scope, digest: artifact.digest, selectedAt: new Date().toISOString() });
      const gate = gates.get(reference.url);
      if (gate) {
        gate.selected = artifact.digest;
        await gate.promise;
      }
      return artifact;
    },
  };
  const check = createCheckTaskType({ source, directory: join(root, "business-workers"), workers: 2, languages: ["en"], graceMs: 10 });
  let engine;
  const probe = createProbeTaskType({
    source, checkEnvironment: check.environment, parents: 2, languages: ["en"],
    children(scope) {
      return { service: engine, caller: { scope, subject: "child" },
        waitForTaskRelease: (id, who) => engine.waitForTaskRelease(id, who) };
    },
  });
  const store = openSqliteStore(database);
  const server = await startTaskServer({
    store, types: [check, probe, ...extra], currentVersions: { check: "2", probe: "2", ...Object.fromEntries(extra.map((type) => [type.type, type.version])) },
    port: 0, resolveCaller: access,
    authorize: (who, _operation, scope) => who.scope === scope && ["fixture", "child"].includes(who.subject),
    limits: { maxConcurrent: 4, maxPayloadBytes: 16 * 1024 * 1024 },
    bindService(value) { engine = value; },
    async closeResources() { await check.close(); await probe.close(); await base.close(); },
  });
  assert.ok(engine);
  return { engine, server, store, reads, check, probe,
    async close() { await server.close(); store.close(); } };
}
