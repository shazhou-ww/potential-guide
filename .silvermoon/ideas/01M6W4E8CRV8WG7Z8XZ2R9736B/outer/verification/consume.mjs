import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { CarBlockIterator } from "@ipld/car";
import { stringify } from "yaml";
import { prepareCheck, verifyCheckResources } from "@potential-guide/check-sdk/authoring";
import { prepareProbe, verifyProbeResources } from "@potential-guide/probe-sdk/authoring";
import { createPinboardResolver } from "@potential-guide/probe-sdk/publication";
import { buildTask } from "@potential-guide/pguide-task-bundle";
import { readTaskArtifact } from "@potential-guide/pguide-task-bundle/artifact";
import { createIpfsGatewayClient, readContentTree, validateContentCar } from "@potential-guide/ipfs-content";
import { startTaskServer } from "@potential-guide/task-engine-server";
import { TaskClient } from "@potential-guide/task-engine-http";
import { newId } from "@potential-guide/task-engine";
import { TaskError, bundleCid, validateBundleReference } from "@potential-guide/task-protocol";

const destination = resolve(process.argv[2]);
const consumer = process.cwd();
await mkdir(destination, { recursive: true });
const output = join(destination, "deployment.json");
const currentTools = "bafybeifydrqggqypfapxiwt2bpovdprxae6iysrjhiua3d2jebico74u7a";
const evidence = {
  contractRevision: "29a525be2ef5f8cbdb7ab0b2b1306e88496a236b",
  sourceCommit: "5428223891ebd6a049048aa5d8eb7e3cd972e017",
  startedAt: new Date().toISOString(), modules: {}, cases: [], http: [], gateway: [], closed: false,
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function put(root, path, value) {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, value);
}
const page = (title) => `---\ntitle: ${title}\ndescription: Independent Probe delivery verification.\n---\n${title}\n`;
for (const name of ["@potential-guide/probe-sdk", "@potential-guide/task-engine-server",
  "@potential-guide/pguide-task-bundle", "@potential-guide/check-sdk"]) {
  const path = await realpath(fileURLToPath(import.meta.resolve(name)));
  assert.ok(path.startsWith(join(consumer, "node_modules") + sep), path);
  evidence.modules[name] = path;
}
const blocks = new Map();
async function loadCar(archive, expected) {
  await validateContentCar(archive, expected);
  const iterator = await CarBlockIterator.fromBytes(archive);
  for await (const block of iterator) {
    assert.equal(block.cid.multihash.code, 0x12);
    assert.equal(sha(block.bytes), Buffer.from(block.cid.multihash.digest).toString("hex"));
    blocks.set(block.cid.toString(), block.bytes);
  }
}
async function getBytes(client, root, path) {
  const tree = await readContentTree(client, root, { signal: AbortSignal.timeout(30000) });
  const bytes = tree.files.get(path);
  assert.ok(bytes, `${root}/${path}`);
  return bytes;
}
let publication = { id: "owned-tools", currentRevision: 1, current: { revision: 1, cid: currentTools } };
let publicationCalls = 0;
const gateway = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/publication") {
    publicationCalls++;
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(publication));
    return;
  }
  const cid = url.pathname.startsWith("/ipfs/") ? url.pathname.slice(6) : "";
  const bytes = blocks.get(cid);
  evidence.gateway.push({ cid, status: bytes ? 200 : 404 });
  if (!bytes) { res.writeHead(404).end("Not found"); return; }
  res.writeHead(200, { "content-type": "application/vnd.ipld.raw", "content-length": bytes.length });
  res.end(bytes);
});
let server;
let gatewayUrl;
let api;
let primary;
const cleanupErrors = [];
try {
  const origin = "https://pinboard.shazhou.work";
  const liveReads = [];
  const live = createIpfsGatewayClient(origin, {
    timeoutMs: 30000,
    fetch: async (url, init) => {
      const response = await fetch(url, init);
      liveReads.push({ url: String(url), status: response.status, type: response.headers.get("content-type") });
      return response;
    },
  });
  const tools = await readContentTree(live, currentTools, { signal: AbortSignal.timeout(120000) });
  await loadCar(tools.archive, currentTools);
  evidence.liveTools = {
    origin, cid: currentTools, files: [...tools.files.keys()], reads: liveReads,
    blocks: [...blocks].map(([cid, bytes]) => ({ cid, size: bytes.length, sha256: sha(bytes) })),
  };
  await new Promise((done, reject) => {
    gateway.once("error", reject);
    gateway.listen(0, "127.0.0.1", done);
  });
  gatewayUrl = `http://127.0.0.1:${gateway.address().port}`;
  const client = createIpfsGatewayClient(gatewayUrl);
  const scope = "probe-delivery";
  const caller = { scope, subject: "owned-loopback" };
  const capability = "owned-loopback-delivery-only";
  server = await startTaskServer({
    host: "127.0.0.1", port: 0, database: join(destination, "tasks.sqlite"),
    ipfsClient: client, authorize: (who) => who.scope === scope,
    resolveCaller(request) {
      if (request.headers.get("authorization") !== capability) throw new TaskError("forbidden", "Unauthorized local fixture.");
      return caller;
    },
  });
  evidence.transport = { gateway: gatewayUrl, engine: server.url, scope };
  const httpFetch = async (url, init) => {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
    evidence.http.push({
      method: init?.method ?? "GET", path: new URL(url).pathname, status: response.status,
      body: await response.clone().json(),
    });
    return response;
  };
  api = new TaskClient({ url: server.url, headers: { authorization: capability }, fetch: httpFetch });
  const invocationSource = (cid, definitionName, childMs = 10000) => `
import {runTask} from "@potential-guide/task-sdk";
import {createProbeTask} from "@potential-guide/probe-sdk";
import {createCheckInvoker} from "@potential-guide/probe-sdk/execution";
import {createIpfsGatewayClient} from "@potential-guide/ipfs-content";
import {TaskClient} from "@potential-guide/task-engine-http";
import {definitions} from "../dist/definitions/${definitionName}.js";
const service = new TaskClient({url:${JSON.stringify(server.url)},headers:{authorization:${JSON.stringify(capability)}},
fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(10000)})});
const invoke = createCheckInvoker({service,client:createIpfsGatewayClient(${JSON.stringify(gatewayUrl)}),
caller:${JSON.stringify(caller)},timeoutMs:${childMs},cleanupTimeoutMs:3000,
authorize:request=>request.cid===${JSON.stringify(cid)}&&request.scope===${JSON.stringify(scope)}});
runTask(createProbeTask(definitions,invoke));`;
  const parent = join(consumer, "author-tools");
  await put(parent, "src/main.ts", invocationSource(currentTools, "tools-ready"));
  await put(parent, "src/contract.ts", `
import {Type} from "@sinclair/typebox";
import {createProbeContract} from "@potential-guide/probe-sdk/contracts";
import {definitions} from "../dist/definitions/tools-ready.js";
const tools=Type.Object({checkTimeoutMs:Type.Integer(),tools:Type.Array(Type.Object({
command:Type.String(),args:Type.Array(Type.String()),minimumVersion:Type.String()
},{additionalProperties:false}))},{additionalProperties:false});
export default createProbeContract(Type.Object({environment:tools,project:tools},
{additionalProperties:false}),definitions);`);
  const config = {
    name: "Independent tools readiness", kind: "tools-ready",
    source: { root: "src", entry: "src/main.ts", contract: "src/contract.ts" },
    languages: ["en"], referenceRoot: "references",
    bundles: { tools: { source: { kind: "publication", url: "https://owned.invalid/publications/owned-tools" } } },
    checks: {
      environment: { bundle: "tools", inputMapping: "environment" },
      project: { bundle: "tools", inputMapping: "project" },
    },
    levels: [
      { id: "prepare-environment", checks: ["environment"] },
      { id: "prepare-project", checks: ["project"] },
    ],
  };
  await put(parent, "tools.probe.build.yaml", stringify(config));
  for (const suffix of ["objective", "levels/prepare-environment", "levels/prepare-project",
    "levels/terminal", "checks/environment/check", "checks/environment/problems/tool-version"])
    await put(parent, `references/en/${suffix}.md`, page(`Probe ${suffix}`));
  const resolver = createPinboardResolver({
    origin: "https://owned.invalid",
    getPublication: async (id, signal) => {
      assert.equal(id, "owned-tools");
      const response = await fetch(`${gatewayUrl}/publication`, { signal });
      assert.equal(response.status, 200);
      return response.json();
    },
  });
  const prepared = await prepareProbe(join(parent, "tools.probe.build.yaml"), {
    client, resolvePublication: resolver,
  });
  assert.equal(publicationCalls, 1);
  const built = await buildTask(prepared.buildFile);
  const artifact = await readTaskArtifact(built.car);
  await verifyProbeResources(prepared, artifact);
  await loadCar(artifact.archive, built.cid);
  await writeFile(join(destination, "tools-probe.car"), artifact.archive);
  evidence.probe = { cid: built.cid, lock: prepared.lock, files: [...artifact.files.keys()], carSha256: sha(artifact.archive) };
  const received = await readContentTree(client, built.cid, { signal: AbortSignal.timeout(30000) });
  assert.equal(received.roots.get("resources/checks/tools"), currentTools);
  assert.deepEqual([...received.files.keys()].sort(), [...artifact.files.keys()].sort());
  for (const [path, bytes] of received.files) {
    assert.deepEqual(Buffer.from(bytes), Buffer.from(artifact.files.get(path)));
    await put(join(destination, "materialized"), path, bytes);
    assert.equal(sha(await readFile(join(destination, "materialized", path))), sha(bytes));
  }
  evidence.materialization = { files: received.files.size, childCid: received.roots.get("resources/checks/tools") };
  const input = (minimumVersion) => ({
    checkTimeoutMs: 5000,
    tools: [{ command: process.execPath, args: ["--version"], minimumVersion }],
  });
  async function submit(root, data, timeoutMs = 30000) {
    const requestId = newId();
    let decision = await api.submit({ requestId, bundle: root, timeoutMs, ...data });
    while (decision.status === "preparing")
      decision = await api.getRequestStatus(requestId, { waitMs: 500 });
    assert.equal(decision.status, "accepted", JSON.stringify(decision));
    return { requestId, taskId: decision.taskId };
  }
  async function settle(taskId) {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const task = await api.getTask(taskId);
      if (["completed", "failed", "stopped"].includes(task.stage)) return task;
      await delay(50);
    }
    throw new Error(`Task did not settle: ${taskId}`);
  }
  async function docs(result) {
    const uris = [result.documentation.en, result.currentLevel.documentation.en];
    for (const check of result.checks) {
      uris.push(check.documentation.en);
      for (const problem of check.problems) uris.push(problem.documentation.en);
    }
    const records = [];
    for (const uri of uris) {
      const parsed = new URL(uri);
      const bytes = await getBytes(client, parsed.hostname, parsed.pathname.slice(1));
      assert.match(Buffer.from(bytes).toString("utf8"), /title:/);
      records.push({ uri, sha256: sha(bytes), bytes: bytes.length });
    }
    return records;
  }
  for (const [name, first, second, level, ref] of [
    ["first-failure", "999.0.0", "22.13.0", "prepare-environment", "environment"],
    ["later-failure", "22.13.0", "999.0.0", "prepare-project", "project"],
    ["terminal", "22.13.0", "22.13.0", "terminal", null],
  ]) {
    const ids = await submit(built.cid, { environment: input(first), project: input(second) });
    const task = await settle(ids.taskId);
    assert.equal(task.stage, "completed", JSON.stringify(task));
    assert.equal(task.result.objective, built.cid);
    assert.equal(task.result.currentLevel.id, level);
    assert.deepEqual(task.result.checks.map((check) => check.id), ref ? [ref] : []);
    if (ref) {
      const problem = task.result.checks[0].problems[0];
      assert.equal(problem.code, "tool-version");
      assert.ok(problem.documentation.en.startsWith(`ipfs://${ref === "environment" ? built.cid : currentTools}/`));
    }
    evidence.cases.push({ name, ...ids, task, documents: await docs(task.result) });
  }
  const original = await getBytes(client, currentTools, "resources/references/en/problems/tool-version.md");
  evidence.originalDocument = { cid: currentTools, sha256: sha(original) };
  const slow = join(consumer, "author-slow");
  await put(slow, "src/main.ts", `
import {runTask} from "@potential-guide/task-sdk";
import {createCheckTask} from "@potential-guide/check-sdk";
import {setTimeout as delay} from "node:timers/promises";
import {languages,problemCodes} from "../dist/definitions/slow.js";
runTask(createCheckTask(problemCodes,languages,async(input,context)=>{
if(input.mode==="fault") throw new Error("owned child failure");
if(input.mode==="slow") await delay(60000,undefined,{signal:context.signal});
return [];
}));`);
  await put(slow, "src/contract.ts", `
import {Type} from "@sinclair/typebox";
import {createCheckContract} from "@potential-guide/check-sdk/contracts";
import {languages,problemCodes} from "../dist/definitions/slow.js";
export default createCheckContract(Type.Object({mode:Type.String()},{additionalProperties:false}),problemCodes,languages);`);
  await put(slow, "references/en/check.md", page("Owned slow Check"));
  await put(slow, "slow.check.build.yaml", stringify({
    name: "Owned slow check", kind: "slow", source: config.source,
    languages: ["en"], problemCodes: [], referenceRoot: "references",
  }));
  const childPrepared = await prepareCheck(join(slow, "slow.check.build.yaml"));
  const childBuilt = await buildTask(childPrepared.buildFile);
  const childArtifact = await readTaskArtifact(childBuilt.car);
  verifyCheckResources(childPrepared, childArtifact.files);
  await loadCar(childArtifact.archive, childBuilt.cid);
  publication = { ...publication, currentRevision: 2, current: { revision: 2, cid: childBuilt.cid } };
  const locked = await prepareProbe(join(parent, "tools.probe.build.yaml"), {
    client, mode: "locked", lock: prepared.lock, resolvePublication: resolver,
  });
  assert.deepEqual(locked.lock, prepared.lock);
  assert.equal(publicationCalls, 1);
  const again = await submit(built.cid, { environment: input("22.13.0"), project: input("22.13.0") });
  assert.equal((await settle(again.taskId)).result.currentLevel.id, "terminal");
  assert.equal(publicationCalls, 1);
  evidence.frozenPublication = {
    source: "owned HTTP fixture, not a public Pinboard update",
    initialRevision: 1, currentRevision: 2, currentCid: childBuilt.cid,
    resolveCalls: publicationCalls, lockedCid: currentTools,
  };
  const cancelAuthor = join(consumer, "author-cancel");
  await put(cancelAuthor, "src/main.ts", invocationSource(childBuilt.cid, "owned-probe", 15000));
  await put(cancelAuthor, "src/contract.ts", `
import {Type} from "@sinclair/typebox";
import {createProbeContract} from "@potential-guide/probe-sdk/contracts";
import {definitions} from "../dist/definitions/owned-probe.js";
export default createProbeContract(Type.Object({mode:Type.String()},{additionalProperties:false}),definitions);`);
  await put(cancelAuthor, "owned.probe.build.yaml", stringify({
    name: "Owned cancellation probe", kind: "owned-probe", source: config.source,
    languages: ["en"], referenceRoot: "references",
    bundles: { slow: { source: { kind: "ipfs", cid: childBuilt.cid } } },
    checks: { slow: { bundle: "slow", inputMapping: "$" } },
    levels: [{ id: "wait-for-check", checks: ["slow"] }],
  }));
  for (const suffix of ["objective", "levels/wait-for-check", "levels/terminal"])
    await put(cancelAuthor, `references/en/${suffix}.md`, page(`Owned ${suffix}`));
  const cancelPrepared = await prepareProbe(join(cancelAuthor, "owned.probe.build.yaml"), { client });
  const cancelBuilt = await buildTask(cancelPrepared.buildFile);
  const cancelArtifact = await readTaskArtifact(cancelBuilt.car);
  await verifyProbeResources(cancelPrepared, cancelArtifact);
  await loadCar(cancelArtifact.archive, cancelBuilt.cid);
  const faultIds = await submit(cancelBuilt.cid, { mode: "fault" });
  const fault = await settle(faultIds.taskId);
  assert.equal(fault.stage, "failed");
  assert.equal(fault.result, undefined);
  evidence.cases.push({ name: "child-invocation-failure", ...faultIds, task: fault });
  const cancelIds = await submit(cancelBuilt.cid, { mode: "slow" });
  const waitUntil = Date.now() + 10000;
  let runningChild;
  while (Date.now() < waitUntil) {
    const tasks = await api.listTasks({ bundleCid: childBuilt.cid, stage: "running" }, { limit: 100 });
    runningChild = tasks.items.find((task) => bundleCid(validateBundleReference(task.bundle)) === childBuilt.cid);
    if (runningChild) break;
    await delay(50);
  }
  assert.ok(runningChild, "Independent slow child must be running before cancellation.");
  await api.cancelTask(cancelIds.taskId);
  const canceled = await settle(cancelIds.taskId);
  const canceledChild = await settle(runningChild.taskId);
  assert.ok(canceled.canceledAt);
  assert.ok(canceledChild.canceledAt);
  evidence.cases.push({ name: "parent-cancellation", ...cancelIds, task: canceled, child: canceledChild });
  const reclaimDeadline = Date.now() + 15000;
  for (;;) {
    const runs = await api.listRuns({}, { limit: 100 });
    assert.equal(runs.next, undefined);
    if (runs.items.length && runs.items.every((run) => run.reclaimedAt)) {
      evidence.runs = await Promise.all(runs.items.map((run) => api.getRun(run.runId)));
      assert.ok(evidence.runs.every((run) => run.reclaimedAt && !run.cleanupUnknown && run.exit));
      break;
    }
    if (Date.now() > reclaimDeadline) throw new Error("Not all parent/child Runs were reclaimed.");
    await delay(50);
  }
  const taskPage = await api.listTasks({}, { limit: 100 });
  assert.equal(taskPage.next, undefined);
  evidence.tasks = taskPage.items;
  assert.ok(evidence.tasks.some((task) => bundleCid(validateBundleReference(task.bundle)) === currentTools));
  evidence.passed = true;
} catch (error) {
  primary = error;
  evidence.error = { name: error.name, message: error.message, stack: error.stack };
} finally {
  if (server) {
    try { await server.close(); } catch (error) { cleanupErrors.push(error); }
  }
  if (gateway.listening) {
    try {
      gateway.closeAllConnections();
      await new Promise((done, reject) => gateway.close((error) => error ? reject(error) : done()));
    } catch (error) { cleanupErrors.push(error); }
  }
  for (const url of [server?.url, gatewayUrl].filter(Boolean)) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      cleanupErrors.push(new Error(`Owned endpoint still responds: ${url}`));
    } catch (error) {
      if (!(error instanceof TypeError)) cleanupErrors.push(error);
    }
  }
  evidence.closed = cleanupErrors.length === 0;
  evidence.cleanupErrors = cleanupErrors.map((error) => String(error));
  evidence.finishedAt = new Date().toISOString();
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
}
if (primary || cleanupErrors.length)
  throw new AggregateError([...(primary ? [primary] : []), ...cleanupErrors], "Independent deployment failed.");
console.log(JSON.stringify({ passed: evidence.passed, cases: evidence.cases.length, cid: evidence.probe.cid, closed: evidence.closed }));
