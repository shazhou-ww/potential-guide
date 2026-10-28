import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  checkerSchemaUri,
  inspectContractFiles,
  objectiveSchemaUri,
  type ArtifactReference,
} from "@potential-guide/check-artifacts";
import {
  CheckerMaterializer,
  CheckerService,
  CheckKernel,
  createServiceRouter,
  serveServices,
  type ContractRepository,
  type ResolvedContract,
} from "@potential-guide/checker-host";
import { CheckTaskClient } from "@potential-guide/checker-host/v3";
import { ObjectiveService, ObjectiveTaskClient } from "../src/index.js";
const page = (title: string) =>
  Buffer.from(`---\ntitle: ${title}\ndescription: Guidance\n---\nBody\n`);
function checker(code: string, problems: string[] = []) {
  return inspectContractFiles(
    new Map([
      [
        "checker.yaml",
        Buffer.from(
          JSON.stringify({
            $schema: checkerSchemaUri,
            runtime: { type: "node", minVersion: "22.13.0" },
            entry: "checker.cjs",
            subjectSchema: { type: "object" },
            languages: ["en"],
            problems,
          }),
        ),
      ],
      ["checker.cjs", Buffer.from(code)],
      ["references/en/checker.md", page("Checker")],
      ...problems.map((id) => [`references/en/problems/${id}.md`, page(id)] as [string, Buffer]),
    ]),
  );
}
function objective(url: string, digest: string) {
  return inspectContractFiles(
    new Map([
      [
        "objective.yaml",
        Buffer.from(
          JSON.stringify({
            $schema: objectiveSchemaUri,
            subjectSchema: { type: "object" },
            languages: ["en"],
            levels: [{ id: "ready", checks: ["check"] }],
            checkers: { check: { url, digest, subjectMapping: "$" } },
          }),
        ),
      ],
      ["references/en/objective.md", page("Objective")],
      ["references/en/levels/ready.md", page("Ready")],
    ]),
  );
}
class Repository implements ContractRepository {
  readonly entries = new Map<string, ResolvedContract>();
  readonly grants = new Map<string, Set<string>>();
  register(url: string, artifact: ReturnType<typeof checker>) {
    const value = {
      ...artifact,
      metadata: {
        digest: artifact.digest,
        source: url,
        checkedAt: new Date().toISOString(),
        manifest: artifact.manifest,
      },
    };
    this.entries.set(url, value);
    return value;
  }
  authorize(reference: ArtifactReference) {
    if (!reference.url.startsWith("https://example.test/")) throw new Error("Denied.");
  }
  async resolve(reference: ArtifactReference, scope: string, signal: AbortSignal) {
    this.authorize(reference);
    signal.throwIfAborted();
    const artifact = this.entries.get(reference.url);
    if (!artifact || (reference.digest && reference.digest !== artifact.digest))
      throw new Error("Digest mismatch.");
    const grants = this.grants.get(scope) ?? new Set();
    grants.add(artifact.digest);
    this.grants.set(scope, grants);
    return artifact;
  }
  async artifact(digest: string, scope: string) {
    const value = [...this.entries.values()].find((value) => value.digest === digest);
    if (!value || !this.grants.get(scope)?.has(digest)) throw new Error("Denied.");
    return value;
  }
}
async function fixture() {
  const directory = resolve(".cache", `objective-host-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const repository = new Repository();
  const kernel = await CheckKernel.create(join(directory, "snapshots"));
  const checks = new CheckerService(
    repository,
    new CheckerMaterializer(join(directory, "capsules")),
    kernel,
    ["en"],
  );
  const service = new ObjectiveService(repository, checks, ["en"]);
  const token = randomUUID();
  const host = await serveServices(
    [
      createServiceRouter(checks, "/checks", "checker"),
      createServiceRouter(service, "/observations", "objective"),
    ],
    token,
    async () => {
      await service.close();
      await checks.close();
    },
  );
  const client = new ObjectiveTaskClient({ endpoint: host.endpoint, token }, "/observations");
  const checkerClient = new CheckTaskClient({ endpoint: host.endpoint, token }, "/checks");
  return {
    directory,
    repository,
    kernel,
    checks,
    service,
    host,
    client,
    checkerClient,
    token,
    async close() {
      client.close();
      checkerClient.close();
      await host.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
test("mounted services and symmetric SDK execute real Checker, project progress and reject missing pages", async () => {
  const f = await fixture();
  try {
    const check = f.repository.register(
      "https://example.test/check/1.tgz",
      checker(
        "exports.execute = async () => { await new Promise(r=>setTimeout(r,40)); return {status:200,message:'',payload:{ok:true,problems:[]}}; };",
      ),
    );
    const root = f.repository.register(
      "https://example.test/objective/1.tgz",
      objective(check.metadata.source, check.digest),
    );
    const task = await f.client.probe({ objective: { url: root.metadata.source }, subject: {} });
    const events = [];
    for await (const event of task.events()) {
      events.push(event.snapshot);
      if (["completed", "failed", "cancelled"].includes(event.snapshot.state)) break;
    }
    const result = await task.result();
    assert.equal(result.result.current.levelId, "ready");
    assert.equal(result.result.current.objective.digest, root.digest);
    assert.equal(result.evidence.checks.length, 1);
    const leaf = result.evidence.checks[0]?.snapshot;
    assert.equal(leaf?.freshness, "started-after-request");
    assert.equal(leaf?.evidence?.runtime.version, process.versions.node);
    assert.equal(leaf?.evidence?.runtime.adapter, "node-commonjs-v1");
    assert.ok(leaf?.evidence?.revision.match(/^[a-f0-9]{64}$/));
    assert.ok(
      events.some((event) => event.progress?.invocations.some((invocation) => invocation.taskId)),
    );
    assert.equal(result.progress?.observations[0]?.attainedLevel, "ready");
    assert.equal((await f.client.reference(root.digest, "objective")).id, "objective");
    assert.equal(
      (await f.client.reference(root.digest, "checkers/check")).origin.artifactDigest,
      check.digest,
    );
    await assert.rejects(() => f.client.reference(root.digest, "system/404"), /not found/);
    await assert.rejects(() => f.client.reference(root.digest, "objective", { language: "zh-CN" }));
    const standalone = await f.checkerClient.check({
      checker: { url: check.metadata.source, digest: check.digest },
      subject: {},
    });
    assert.deepEqual((await standalone.result()).result, { ok: true, problems: [] });
    assert.equal(
      (
        await fetch(`${f.host.endpoint}/observations/events`, {
          headers: { authorization: `Bearer ${f.token}` },
        })
      ).status,
      400,
    );
    assert.equal(
      (await fetch(`${f.host.endpoint}/observations/probe-tasks/${task.taskId}`)).status,
      401,
    );
  } finally {
    await f.close();
  }
});
test("dynamic dependency bindings, second invocation, cancellation and exact recovery", async () => {
  const f = await fixture();
  try {
    const dependencyCheck = f.repository.register(
      "https://example.test/dependency-check/1.tgz",
      checker("exports.execute=async()=>({status:200,message:'',payload:{ok:true,problems:[]}});"),
    );
    const dependency = f.repository.register(
      "https://example.test/dependency/1.tgz",
      objective(dependencyCheck.metadata.source, dependencyCheck.digest),
    );
    const check = f.repository.register(
      "https://example.test/root-check/1.tgz",
      checker(
        `exports.execute=async(subject,context)=>({status:200,message:"",payload:context.data.resolutions?{ok:true,problems:[]}:{ok:false,problems:[],requirements:[{objective:{kind:"objective",url:"${dependency.metadata.source}"},subject:{},expectedLevelId:"ready"}]}});`,
      ),
    );
    const root = f.repository.register(
      "https://example.test/root/1.tgz",
      objective(check.metadata.source, check.digest),
    );
    const result = await (
      await f.client.probe({ objective: { url: root.metadata.source }, subject: {} })
    ).result();
    assert.equal(result.result.bindings[dependency.metadata.source], dependency.digest);
    assert.equal(result.evidence.checks.length, 3);
    assert.equal(result.progress?.observations.length, 2);
    assert.ok(result.progress?.observations[1]?.parentInvocation);
    const changedCheck = f.repository.register(
      "https://example.test/dependency-check/2.tgz",
      checker(
        "exports.execute=async()=>({status:200,message:'changed',payload:{ok:true,problems:[]}});",
      ),
    );
    f.repository.register(
      dependency.metadata.source,
      objective(changedCheck.metadata.source, changedCheck.digest),
    );
    const recovered = await f.client.probe({
      objective: { url: root.metadata.source },
      subject: {},
      bindings: result.result.bindings,
    });
    await assert.rejects(() => recovered.result(), /failed/i);
    const slow = f.repository.register(
      "https://example.test/slow/1.tgz",
      checker(
        "exports.execute=async()=>{await new Promise(r=>setTimeout(r,500));return {status:200,message:'',payload:{ok:true,problems:[]}}};",
      ),
    );
    const slowRoot = f.repository.register(
      "https://example.test/slow-root/1.tgz",
      objective(slow.metadata.source, slow.digest),
    );
    const task = await f.client.probe({
      objective: { url: slowRoot.metadata.source },
      subject: {},
    });
    await task.cancel();
    assert.equal((await task.snapshot()).state, "cancelled");
    const timeout = await f.client.probe({
      objective: { url: slowRoot.metadata.source },
      subject: {},
      timeoutMs: 10,
    });
    await assert.rejects(() => timeout.result(), /deadline/);
    const initial = await f.client.probe({
      objective: { url: slowRoot.metadata.source },
      subject: {},
      targetLevel: "initial",
    });
    assert.equal((await initial.result()).evidence.checks.length, 0);
  } finally {
    await f.close();
  }
});
test("real Observation Executions share weak demand while new strong demand owns newer children", async () => {
  const f = await fixture();
  try {
    const check = f.repository.register(
      "https://example.test/gated/1.tgz",
      checker(`
      const fs=require("node:fs");
      exports.execute=async(subject,context)=>{
        while(!fs.existsSync(subject.gate)){context.signal.throwIfAborted();await new Promise(r=>setTimeout(r,5));}
        return {status:200,message:"",payload:{ok:true,problems:[]}};
      };`),
    );
    const root = f.repository.register(
      "https://example.test/gated-root/1.tgz",
      objective(check.metadata.source, check.digest),
    );
    const gate = join(f.directory, "release");
    const request = { objective: { url: root.metadata.source }, subject: { gate } };
    const first = await f.client.probe(request);
    for await (const event of first.events()) if (event.snapshot.state === "running") break;
    const weak = await f.client.probe({ ...request, freshness: "completed-after-request" });
    const strong = await f.client.probe(request);
    for await (const event of weak.events()) if (event.snapshot.state === "running") break;
    for await (const event of strong.events()) if (event.snapshot.state === "running") break;
    assert.equal((await weak.snapshot()).executionId, (await first.snapshot()).executionId);
    assert.notEqual((await strong.snapshot()).executionId, (await first.snapshot()).executionId);
    await first.cancel();
    await writeFile(gate, "go", { flag: "wx" });
    const [weakResult, strongResult] = await Promise.all([weak.result(), strong.result()]);
    assert.notEqual(
      weakResult.evidence.checks[0]?.snapshot.taskId,
      strongResult.evidence.checks[0]?.snapshot.taskId,
    );
    assert.equal((await first.snapshot()).state, "cancelled");
    assert.equal(weakResult.result.current.levelId, "ready");
    assert.equal(strongResult.result.current.levelId, "ready");
  } finally {
    await f.close();
  }
});
