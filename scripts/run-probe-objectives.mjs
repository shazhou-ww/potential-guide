import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareCheck, verifyCheckResources } from "../packages/check-sdk/dist/authoring.js";
import { readContentTree } from "../packages/ipfs-content/dist/index.js";
import { MemoryIpfsClient } from "../packages/ipfs-content/dist/testing.js";
import { readTaskArtifact } from "../packages/pguide-task-bundle/dist/artifact.js";
import { buildTask } from "../packages/pguide-task-bundle/dist/authoring.js";
import { prepareProbe, verifyProbeResources } from "../packages/probe-sdk/dist/authoring.js";
import { createTaskEngine, newId } from "../packages/task-engine/dist/index.js";
import { MemoryStore } from "../packages/task-engine/dist/testing.js";
import { createTaskHandler } from "../packages/task-engine-http/dist/index.js";
import { TaskError } from "../packages/task-protocol/dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const examples = join(root, "packages/probe-sdk/examples/objectives");
const checkEnvironment = join(root, "packages/check-environment");
const requireFromProbeSdk = createRequire(join(root, "packages/probe-sdk/package.json"));
const { parse } = requireFromProbeSdk("yaml");
const caller = { scope: "probe-local", subject: "objective-runner" };
const authorization = "potential-guide-local-probe";
let gatewayPort = 0;
const scenarios = {
  monorepo: {
    name: "Monorepo standardization",
    kind: "monorepo-standard",
    directory: "monorepo-standard",
    buildFile: "monorepo-standard.probe.build.yaml",
    resolveBundleCids: (environment) => ({
      toolchain: requiredCid(environment, "tools"),
      workspace: requiredCid(environment, "directories"),
      policy: requiredCid(environment, "policy"),
    }),
  },
  device: {
    name: "Task Engine device readiness",
    kind: "task-engine-device",
    directory: "task-engine-device",
    buildFile: "task-engine-device.probe.build.yaml",
    resolveBundleCids: (environment) => ({
      runtime: requiredCid(environment, "tools"),
      storage: requiredCid(environment, "directories"),
      gateway: requiredCid(environment, "network"),
    }),
  },
};

function requiredCid(environment, name) {
  const cid = environment[name];
  if (!cid) throw new Error(`Missing local Check CID: ${name}`);
  return cid;
}

async function buildMonorepoCheck(client) {
  const directory = join(examples, "monorepo-standard/checks/policy");
  const prepared = await prepareCheck(join(directory, "monorepo-policy.check.build.yaml"));
  const built = await buildTask(prepared.buildFile);
  const artifact = await readTaskArtifact(built.car);
  verifyCheckResources(prepared, artifact.files);
  const cid = await client.import(artifact.files);
  assert.equal(cid, built.cid);
  const output = join(directory, "dist");
  await mkdir(output, { recursive: true });
  if (!artifact.archive) throw new Error("Monorepo policy Check build did not produce a CAR.");
  await writeFile(join(output, "monorepo-policy.car"), artifact.archive);
  await writeFile(join(output, "references.json"), `${JSON.stringify({ cid }, null, 2)}\n`);
  return cid;
}

async function loadEnvironmentChecks(client) {
  const manifest = JSON.parse(
    await readFile(join(checkEnvironment, "dist/bundles/references.json"), "utf8"),
  );
  const cids = {};
  for (const kind of ["tools", "directories", "network"]) {
    const reference = manifest[kind];
    if (!reference || reference.car !== `${kind}.car`)
      throw new Error(`Accepted Environment Check is missing ${kind}.`);
    const artifact = await readTaskArtifact(join(checkEnvironment, "dist/bundles", reference.car));
    if (artifact.cid !== reference.cid || (await client.import(artifact.files)) !== reference.cid)
      throw new Error(`Accepted Environment Check ${kind} CID does not match its CAR.`);
    cids[kind] = reference.cid;
  }
  return cids;
}

async function buildProbe(client, scenario, environment) {
  const buildFile = join(examples, scenario.directory, scenario.buildFile);
  const prepared = await prepareProbe(buildFile, { client });
  const artifact = await buildTask(prepared.buildFile);
  const content = await readTaskArtifact(artifact.car);
  assert.doesNotMatch(
    content.files.get("worker.cjs").toString("utf8"),
    /127\.0\.0\.1:51231|potential-guide-local-probe|probe-local|task-engine-device"\s*}/,
  );
  await verifyProbeResources(prepared, content);
  const imported = await client.import(content.files);
  assert.equal(imported, artifact.cid);
  const tree = await readContentTree(client, artifact.cid, {
    signal: new AbortController().signal,
  });
  for (const binding of Object.entries(scenario.resolveBundleCids(environment))) {
    const [name, cid] = binding;
    assert.equal(tree.roots.get(`resources/checks/${name}`), cid);
  }
  if (!content.archive) throw new Error(`${scenario.name} build did not produce a CAR.`);
  const output = join(examples, scenario.directory, "dist");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, `${scenario.kind}.car`), content.archive);
  await writeFile(
    join(output, `${scenario.kind}.probe.lock.json`),
    `${JSON.stringify(prepared.lock, null, 2)}\n`,
  );
  return artifact.cid;
}

async function waitForTask(engine, taskId) {
  for (let attempt = 0; attempt < 1200; attempt++) {
    const task = engine.getTask(taskId, caller);
    if (["completed", "failed", "stopped"].includes(task.stage)) return task;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Task ${taskId} did not settle.`);
}

async function executeProbe(engine, cid, input) {
  const requestId = newId();
  await engine.submit({ requestId, bundle: cid, timeoutMs: 120_000, ...input }, caller);
  for (let attempt = 0; attempt < 30; attempt++) {
    const status = await engine.getRequestStatus(requestId, { waitMs: 1_000 }, caller);
    if (status.status === "accepted") return waitForTask(engine, status.taskId);
    if (status.status === "rejected") throw new Error(JSON.stringify(status));
  }
  throw new Error(`Probe admission did not finish for ${cid}.`);
}

async function startLocalEngine(client) {
  const engine = createTaskEngine({
    store: new MemoryStore(),
    ipfsClient: client,
    authorize: (requester) => requester.scope === caller.scope,
    authorizeChild: ({ caller: requester }) => requester.scope === caller.scope,
    limits: { maxConcurrent: 1, maxChildConcurrent: 1 },
  });
  await engine.start();
  const handler = createTaskHandler({
    service: engine,
    resolveCaller(request) {
      if (request.headers.get("authorization") !== authorization)
        throw new TaskError("forbidden", "Unauthorized local Probe request.");
      return caller;
    },
  });
  const server = createServer();
  server.on("request", async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${gatewayPort}`);
      if (url.pathname === "/health") {
        response.writeHead(200).end("ok");
        return;
      }
      if (url.pathname.startsWith("/ipfs/")) {
        const cid = url.pathname.slice("/ipfs/".length);
        response.writeHead(200, { "content-type": "application/vnd.ipld.raw" });
        response.end(await client.block.get(cid));
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const result = await handler(
        new Request(`http://local${request.url}`, {
          method: request.method ?? "GET",
          headers: Object.fromEntries(
            Object.entries(request.headers).map(([key, value]) => [key, String(value)]),
          ),
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        }),
      );
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(gatewayPort, "127.0.0.1", resolve);
  }).catch(async (error) => {
    await engine.close();
    throw error;
  });
  gatewayPort = server.address().port;
  return {
    engine,
    close: async () => {
      try {
        await engine.close();
      } finally {
        if (server.listening)
          await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
      }
    },
  };
}

async function readPinnedBundleCids(scenario) {
  const value = parse(
    await readFile(join(examples, scenario.directory, scenario.buildFile), "utf8"),
  );
  if (!value || typeof value !== "object" || !("bundles" in value) || !value.bundles)
    throw new Error(`${scenario.name}: invalid Probe build YAML.`);
  const bundles = value.bundles;
  if (typeof bundles !== "object" || Array.isArray(bundles))
    throw new Error(`${scenario.name}: invalid bundle bindings.`);
  const result = {};
  for (const [name, raw] of Object.entries(bundles)) {
    if (!raw || typeof raw !== "object" || !("source" in raw) || !raw.source)
      throw new Error(`${scenario.name}: invalid bundle ${name}.`);
    const source = raw.source;
    if (
      !source ||
      typeof source !== "object" ||
      !("cid" in source) ||
      typeof source.cid !== "string"
    )
      throw new Error(`${scenario.name}: bundle ${name} must pin an IPFS CID.`);
    result[name] = source.cid;
  }
  return result;
}

async function buildAll() {
  const client = new MemoryIpfsClient();
  const environment = await loadEnvironmentChecks(client);
  const monorepoPolicy = await buildMonorepoCheck(client);
  const expectedPolicy = (await readPinnedBundleCids(scenarios.monorepo)).policy;
  if (monorepoPolicy !== expectedPolicy)
    throw new Error(
      `Monorepo policy Check CID changed: ${monorepoPolicy}. Update the policy pin in monorepo-standard.probe.build.yaml.`,
    );
  const cids = { ...environment, policy: monorepoPolicy };
  for (const scenario of Object.values(scenarios)) {
    const pinned = await readPinnedBundleCids(scenario);
    for (const [name, cid] of Object.entries(scenario.resolveBundleCids(cids))) {
      if (pinned[name] !== cid)
        throw new Error(`${scenario.name}: ${name} CID changed. Update its Probe build YAML pin.`);
    }
    const probeCid = await buildProbe(client, scenario, cids);
    console.log(`${scenario.name}: ${probeCid}`);
  }
}

async function runAll() {
  const client = new MemoryIpfsClient();
  const cids = {};
  for (const scenario of Object.values(scenarios)) {
    const artifact = await readTaskArtifact(
      join(examples, scenario.directory, "dist", `${scenario.kind}.car`),
    );
    if (!artifact.archive) throw new Error(`${scenario.name}: missing local Probe CAR.`);
    const cid = await client.import(artifact.files);
    assert.equal(cid, artifact.cid);
    cids[scenario.kind] = cid;
  }
  const local = await startLocalEngine(client);
  console.log(
    JSON.stringify({
      gateway: `http://127.0.0.1:${gatewayPort}`,
      mode: "in-process",
      maxConcurrent: 1,
      maxChildConcurrent: 1,
    }),
  );
  let deviceStorage;
  try {
    const repositoryRoot = root;
    deviceStorage = join(root, ".cache", `probe-objective-data-${randomUUID()}`);
    await mkdir(deviceStorage, { recursive: true });
    const input = {
      "monorepo-standard": {
        toolchain: {
          tools: [{ command: process.execPath, args: ["--version"], minimumVersion: "22.13.0" }],
        },
        workspace: {
          directories: [{ path: repositoryRoot, requirements: ["exists", "read"] }],
        },
        standardization: { repositoryRoot },
      },
      "task-engine-device": {
        runtime: {
          tools: [{ command: process.execPath, args: ["--version"], minimumVersion: "22.13.0" }],
        },
        storage: {
          directories: [{ path: deviceStorage, requirements: ["exists", "read", "write"] }],
        },
        gateway: {
          dns: [],
          http: [
            {
              url: `http://127.0.0.1:${gatewayPort}/health`,
              expectedStatus: [200],
              followRedirects: false,
            },
          ],
        },
      },
    };
    for (const scenario of Object.values(scenarios)) {
      const bundleCid = cids[scenario.kind];
      const objectiveInput = input[scenario.kind];
      if (!bundleCid || !objectiveInput)
        throw new Error(`${scenario.name} is missing its local bundle or input.`);
      const task = await executeProbe(local.engine, bundleCid, objectiveInput);
      if (task.stage !== "completed")
        throw new Error(`${scenario.name} did not complete: ${JSON.stringify(task)}`);
      await local.engine.waitForTaskRelease(task.taskId, caller);
      const children = local.engine
        .listTasks({ scope: caller.scope }, { limit: 100 }, caller)
        .tasks.map((summary) => local.engine.getTask(summary.taskId, caller))
        .filter((child) => child.parent?.runId === task.run.runId)
        .map((child) => ({ task: child, run: local.engine.getRun(child.run.runId, caller) }));
      assert.equal(children.length, 3);
      assert.ok(
        children.every((child) => child.task.stage === "completed" && child.run.reclaimedAt),
      );
      console.log(
        JSON.stringify(
          {
            objective: scenario.kind,
            bundle: cids[scenario.kind],
            result: task.result,
            task,
            children,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    try {
      await local.close();
    } finally {
      if (deviceStorage) await rm(deviceStorage, { recursive: true, force: true });
    }
  }
}

const mode = process.argv[2] ?? "local";
if (mode === "build") await buildAll();
else if (mode === "run") await runAll();
else if (mode === "local") {
  await buildAll();
  await runAll();
} else throw new Error(`Unknown Objective command: ${mode}`);
