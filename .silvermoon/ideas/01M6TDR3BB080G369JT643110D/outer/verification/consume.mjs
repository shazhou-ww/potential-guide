import assert from "node:assert/strict";
import { readFile, mkdir, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createTaskEngine, newId } from "@potential-guide/task-engine";
import { MemoryStore } from "@potential-guide/task-engine/testing";

const api = new URL(process.argv[2] ?? "http://127.0.0.1:55713");
assert.ok(["http:", "https:"].includes(api.protocol));
assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(api.hostname), "Local Kubo only.");
assert.ok(!api.username && !api.password && !api.search && !api.hash);
assert.ok(["", "/", "/api/v0", "/api/v0/"].includes(api.pathname));
const apiBase = api.origin;
const cwd = await realpath(".");
const enginePath = await realpath(fileURLToPath(import.meta.resolve("@potential-guide/task-engine")));
const engineDistance = relative(cwd, enginePath);
assert.ok(!isAbsolute(engineDistance) && engineDistance !== ".." && !engineDistance.startsWith(`..${sep}`));
for (const forbidden of ["@potential-guide/check-sdk", "@potential-guide/pguide-task-bundle"]) {
  assert.throws(() => createRequire(import.meta.url).resolve(forbidden), { code: "MODULE_NOT_FOUND" });
}
const manifest = JSON.parse(await readFile(join("artifacts", "manifest.json"), "utf8"));
const proof = {
  startedAt: new Date().toISOString(), api: apiBase, enginePath,
  provenance: manifest.provenance, imports: [], cases: [], unavailable: [], oldVersionRereads: [],
};
async function bytes(response, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > limit) throw new Error("Kubo response exceeds the verification budget.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function rpc(base, method, parameters = {}, body, signal) {
  const url = new URL(`/api/v0/${method}`, base);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    method: "POST", redirect: "error", ...(body ? { body } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`Kubo ${method}: HTTP ${response.status}: ${(await bytes(response, 65536)).toString().slice(0, 512)}`);
  return bytes(response);
}
const client = {
  block: {
    get: (cid, options = {}) => rpc(apiBase, "block/get", { arg: cid }, undefined, options.signal),
  },
};
// Reading accepts only the detached node, chosen language and provider; no code/index lookup.
async function readDocumentation(node, language, provider = apiBase) {
  const reference = node.documentation[language];
  if (!reference) throw new Error(`Unsupported documentation language: ${language}`);
  const uri = new URL(reference);
  assert.equal(uri.protocol, "ipfs:");
  assert.ok(!uri.search && !uri.hash && !uri.username && !uri.password);
  return (await rpc(provider, "cat", { arg: `/ipfs/${uri.hostname}${uri.pathname}` })).toString("utf8");
}
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}
async function closeServer(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
const service = createServer((request, response) => {
  response.writeHead(request.url === "/bad" ? 503 : 200);
  response.end("independent local service");
});
const unavailable = createServer((_request, response) => {
  response.writeHead(503);
  response.end("Controlled documentation transport outage");
});
const store = new MemoryStore();
const engine = createTaskEngine({ store, ipfsClient: client, authorize: () => true });
const caller = { scope: "independent-documentation", subject: "delegated-parent" };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function deadline(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Physical release deadline exceeded.")), milliseconds);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
async function checkNodes(result, metadata, destination) {
  const nodes = [["result", result], ...(result.problems ?? []).map((problem, index) => [`problem:${index}`, problem])];
  for (const [name, node] of nodes) {
    const detached = structuredClone(node);
    assert.deepEqual(Object.keys(detached.documentation).sort(), [...metadata.languages].sort());
    for (const language of metadata.languages) {
      assert.equal(new URL(detached.documentation[language]).hostname, metadata.cid);
      const text = await readDocumentation(detached, language);
      if (metadata.marker) {
        const page = name === "result" ? "check" : detached.code;
        assert.ok(text.includes(`deployment:${metadata.marker}:${language}:${page}`));
      }
      destination.push({ node: name, language, uri: detached.documentation[language], body: text });
    }
  }
}
async function runCase(label, bundle, input, pass, codes = []) {
  const metadata = manifest.bundles[bundle];
  const requestId = newId();
  const request = { ...input, requestId, bundle: metadata.cid, timeoutMs: 30_000 };
  await engine.submit(request, caller);
  const end = Date.now() + 40_000;
  let decision;
  do {
    decision = await engine.getRequestStatus(requestId, { waitMs: 1000 }, caller);
    if (decision.status !== "preparing") break;
    assert.ok(Date.now() < end, "Admission timed out.");
  } while (true);
  assert.equal(decision.status, "accepted", JSON.stringify(decision));
  let task;
  do {
    engine.tick();
    task = engine.getTask(decision.taskId, caller);
    if (["completed", "failed", "stopped"].includes(task.stage)) break;
    assert.ok(Date.now() < end, "Execution timed out.");
    await delay(20);
  } while (true);
  await deadline(engine.waitForTaskRelease(decision.taskId, caller), 15_000);
  assert.equal(task.stage, "completed", JSON.stringify(task.error));
  assert.equal(task.result.pass, pass);
  if (pass) assert.ok(!Object.hasOwn(task.result, "problems"));
  else assert.deepEqual(task.result.problems.map((problem) => problem.code), codes);
  const result = structuredClone(task.result);
  const before = JSON.stringify(result);
  const record = { label, bundle, request, taskId: decision.taskId, stage: task.stage, released: true, result, reads: [] };
  await checkNodes(result, metadata, record.reads);
  assert.equal(JSON.stringify(result), before);
  proof.cases.push(record);
}
let serviceListening = false;
let unavailableListening = false;
try {
  proof.kuboVersion = JSON.parse((await rpc(apiBase, "version")).toString());
  for (const [name, metadata] of Object.entries(manifest.bundles)) {
    const form = new FormData();
    form.append("file", new Blob([await readFile(join("artifacts", metadata.car))]), metadata.car);
    const rows = (await rpc(apiBase, "dag/import", { "pin-roots": true }, form))
      .toString("utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    const roots = rows.filter((row) => row.Root).map((row) => {
      assert.ok(!row.Root.PinErrorMsg, row.Root.PinErrorMsg);
      return typeof row.Root.Cid === "string" ? row.Root.Cid : row.Root.Cid["/"];
    });
    assert.ok(roots.includes(metadata.cid), JSON.stringify(rows));
    proof.imports.push({ name, expectedRoot: metadata.cid, response: rows });
  }
  assert.notEqual(manifest.bundles.textA.cid, manifest.bundles.textB.cid);
  const base = await listen(service);
  serviceListening = true;
  const outage = await listen(unavailable);
  unavailableListening = true;
  await mkdir("probe-directory");
  const directory = await realpath("probe-directory");
  await engine.start();
  await runCase("tools/pass", "tools", {
    tools: [{ command: process.execPath, args: ["--version"], minimumVersion: "22.13.0" }],
  }, true);
  await runCase("tools/fail", "tools", {
    tools: [{ command: process.execPath, args: ["-e", "console.log('v20.0.0')"], minimumVersion: "22.13.0" }],
  }, false, ["tool-version"]);
  await runCase("directories/pass", "directories", {
    directories: [{ path: directory, requirements: ["exists", "read", "write"] }],
  }, true);
  await runCase("directories/fail", "directories", {
    directories: [{ path: join(directory, "absent"), requirements: ["exists"] }],
  }, false, ["directory-unusable"]);
  const endpoint = (path) => ({ dns: ["localhost"], http: [
    { url: base + path, expectedStatus: [200], followRedirects: false },
  ] });
  await runCase("network/pass", "network", endpoint("/ok"), true);
  await runCase("network/fail", "network", endpoint("/bad"), false, ["http-status"]);
  for (const version of ["A", "B"]) {
    await runCase(`text${version}/pass`, `text${version}`, { text: "healthy" }, true);
    await runCase(`text${version}/fail`, `text${version}`, { text: " " }, false, ["text-empty", "text-short"]);
  }
  for (const record of proof.cases) {
    const before = JSON.stringify(record.result);
    if (record.bundle === "textA")
      await checkNodes(record.result, manifest.bundles.textA, proof.oldVersionRereads);
    for (const node of [record.result, ...(record.result.problems ?? [])]) {
      await assert.rejects(readDocumentation(structuredClone(node), "fr"), /Unsupported documentation language/);
      try {
        await readDocumentation(structuredClone(node), "en", outage);
        assert.fail("Unavailable provider unexpectedly returned a document.");
      } catch (error) {
        assert.match(error.message, /Kubo cat: HTTP 503/);
        proof.unavailable.push({ label: record.label, uri: node.documentation.en, error: error.message });
      }
    }
    assert.equal(JSON.stringify(record.result), before);
  }
  proof.success = true;
} catch (error) {
  proof.success = false;
  proof.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  proof.cleanupErrors = [];
  for (const [name, cleanup] of [
    ["engine", () => engine.close()],
    ["store", () => store.close()],
    ...(serviceListening ? [["service", () => closeServer(service)]] : []),
    ...(unavailableListening ? [["unavailable", () => closeServer(unavailable)]] : []),
  ]) {
    try { await cleanup(); } catch (error) {
      proof.cleanupErrors.push({ name, error: error.message });
      proof.success = false;
      process.exitCode = 1;
    }
  }
  proof.finishedAt = new Date().toISOString();
  await writeFile("deployment-proof.json", JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({
    success: proof.success, cases: proof.cases.length,
    proof: resolve("deployment-proof.json"), cleanupErrors: proof.cleanupErrors,
    error: proof.error,
  }, null, 2));
}
