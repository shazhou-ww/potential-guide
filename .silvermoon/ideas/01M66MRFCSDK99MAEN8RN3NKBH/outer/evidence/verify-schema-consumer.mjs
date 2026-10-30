// Run from the isolated installed consumer, never through workspace package links.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { compileInputSchema, json, TaskError } from "@potential-guide/task-protocol";
import { createTaskEngine, newId } from "@potential-guide/task-engine";
import { createExecutorPool } from "@potential-guide/task-engine/pool";
import { openSqliteStore } from "@potential-guide/task-engine-storage";
import { startTaskServer } from "@potential-guide/task-engine-server";
import { probeInputSchema, createProbeTaskType } from "@potential-guide/probe-task";
import { checkInputSchema } from "@potential-guide/check-task";

const root = await realpath(process.cwd());
const entries = {};
for (const name of ["task-protocol", "task-engine", "task-engine-http", "task-engine-server", "task-engine-storage", "probe-task", "check-task"]) {
  const entry = await realpath(fileURLToPath(import.meta.resolve(`@potential-guide/${name}`)));
  const path = relative(root, entry);
  assert.ok(path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path), entry);
  entries[name] = { path, sha256: createHash("sha256").update(await readFile(entry)).digest("hex") };
}
const proof = { commit: process.env.CANDIDATE_COMMIT, entries, assertions: [] };
const passed = (name) => proof.assertions.push(name);
const schema = {
  type: "object",
  properties: { foo: { type: "number", minimum: 0 }, subject: { type: "object" } },
  required: ["foo"],
};
const contract = compileInputSchema(schema);
assert.equal(contract.equals({ foo: -1, extra: 1 }, { foo: -1, extra: 2 }), true);
assert.throws(() => contract.validate({ foo: -1 }), { code: "invalid_input" });
assert.equal(contract.equals({ foo: 1, subject: { a: 1 } }, { foo: 1, subject: { a: 2 } }), false);
for (const field of ["toString", "constructor", "__proto__"]) {
  const own = compileInputSchema({ type: "object", properties: { [field]: {} }, required: [field] });
  assert.throws(() => own.validate({}), { code: "invalid_input" });
  own.validate(JSON.parse(`{"${field}":1}`));
}
passed("schema-derived equality is independent; free objects and JSON own properties are respected");

const tuple = compileInputSchema({
  type: "object",
  properties: { list: { type: "array", unevaluatedItems: { type: "object", properties: { x: {} } } } },
});
assert.equal(tuple.equals({ list: [{ x: 1, extra: 1 }] }, { list: [{ x: 1, extra: 2 }] }), true);
const union = compileInputSchema({
  type: "object",
  anyOf: [{ properties: { x: {} } }, { properties: { y: {} } }],
});
const operands = [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, {}, null, [], "bad"];
for (const a of operands) {
  assert.equal(union.equals(a, a), true);
  for (const b of operands) {
    assert.equal(union.equals(a, b), union.equals(b, a));
    for (const c of operands)
      if (union.equals(a, b) && union.equals(b, c)) assert.equal(union.equals(a, c), true);
  }
}
passed("union equality laws and schema-valued unevaluated array items hold");

let release;
const gate = new Promise((resolve) => { release = resolve; });
let executionCount = 0;
const pool = createExecutorPool({
  resources: ["worker-a", "worker-b"],
  resourceKey: () => "isolated-schema-proof",
  run(input) {
    executionCount++;
    const result = gate.then(() => input);
    return { result, exited: result.then(() => undefined), cooperate() { release(); }, async force() { release(); }, async cleanup() {} };
  },
});
const echo = {
  type: "echo",
  version: "2",
  environment: "isolated-schema-proof",
  inputSchema: schema,
  async prepare(input) { return { foo: input.foo, ...(input.subject ? { subject: input.subject } : {}) }; },
  validatePrepared: json,
  validateResult: json,
  validateProgress: json,
  execute: (input, options) => pool.execute(input, options),
};
let sourceCalls = 0;
let authorizations = 0;
const probe = createProbeTaskType({
  source: {
    authorize() { authorizations++; },
    async resolve() { sourceCalls++; throw new Error("Unexpected source resolution"); },
  },
  checkEnvironment: "isolated-check-proof",
  children() { throw new Error("Conflicting Probe must not create children"); },
});
const caller = { scope: "proof", subject: "allowed" };
const database = resolve(root, "schema-proof.sqlite");
let store = openSqliteStore(database);
const server = await startTaskServer({
  host: "127.0.0.1",
  port: 0,
  store,
  types: [{ ...echo, version: "1" }, echo, probe],
  currentVersions: { echo: echo.version, probe: probe.version },
  authorize: (who, _operation, scope) => who.scope === scope && who.subject === "allowed",
  resolveCaller(request) {
    const subject = request.headers.get("x-proof-subject");
    if (!subject) throw new TaskError("unauthenticated", "Fixture caller required");
    return { scope: "proof", subject };
  },
  async closeResources() { release(); await pool.close(); await probe.close(); },
});
const request = async (path, body, extraHeaders = {}, subject = "allowed") => {
  const response = await fetch(`${server.url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(subject ? { "x-proof-subject": subject } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.json() };
};
const until = async (read, predicate) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Independent consumer observation timed out");
};
try {
  assert.equal((await request("/task-types", undefined, {}, "")).status, 401);
  assert.equal((await request("/task-types", undefined, {}, "denied")).status, 403);
  const found = await request("/task-types");
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.map(({ type, version }) => ({ type, version })), [
    { type: "echo", version: "2" }, { type: "probe", version: "2" },
  ]);
  for (const type of found.body)
    assert.deepEqual(Object.keys(type).sort(), ["inputSchema", "revision", "type", "version"]);
  const description = found.body[0];
  assert.ok(!JSON.stringify(found.body).includes("isolated-schema-proof"));
  assert.equal(sourceCalls, 0);
  proof.discovery = found.body.map(({ type, version, revision }) => ({ type, version, revision }));
  passed("real HTTP discovery is authenticated, current-only and free of private runtime data or asset resolution");

  const payload = { type: "echo", foo: 1, subject: { ordinary: "object" }, timeoutMs: 60_000, executionMatch: "terminated-after-eligible" };
  const id = newId();
  const headers = { "Idempotency-Key": id, "If-Match": `"${description.revision}"` };
  const initialWatermark = store.read().facts.watermark;
  assert.equal((await request("/tasks", payload, { ...headers, "If-Match": `"${"0".repeat(64)}"` })).status, 412);
  assert.equal((await request("/tasks", { ...payload, foo: -1 }, headers)).status, 400);
  assert.equal(store.read().facts.watermark, initialWatermark);
  const created = await request("/tasks", { ...payload, extra: "first" }, headers);
  assert.equal(created.status, 202);
  const duplicate = await request("/tasks", { ...payload, extra: "first" }, { "Idempotency-Key": id });
  assert.equal(duplicate.body.taskId, created.body.taskId);
  assert.equal((await request("/tasks", { ...payload, extra: "second" }, headers)).status, 409);
  const shared = await request("/tasks", { ...payload, extra: "second" }, { ...headers, "Idempotency-Key": newId() });
  assert.equal(shared.status, 202);
  await until(async () => executionCount, (value) => value >= 1);
  for (const item of [created, shared])
    assert.equal((await request(`/tasks/${item.body.taskId}`)).body.execution, undefined);
  release();
  const [a, b] = await Promise.all([created, shared].map((item) =>
    until(() => request(`/tasks/${item.body.taskId}`), (value) => value.body.stage === "completed")));
  assert.equal(a.body.execution.executionId, b.body.execution.executionId);
  assert.equal(executionCount, 1);
  passed("revision guards and validation reject before persistence; idempotency remains raw-request based; structural input equality shares one eligible execution");

  const probeContract = found.body.find((entry) => entry.type === "probe");
  const probeHeaders = { "Idempotency-Key": newId(), "If-Match": `"${probeContract.revision}"` };
  const conflict = {
    type: "probe", timeoutMs: 60_000,
    objective: { kind: "objective", url: "https://proof.invalid/objective", digest: `sha256:${"a".repeat(64)}` },
    subject: {}, bindings: { "https://proof.invalid/objective": `sha256:${"b".repeat(64)}` },
  };
  const acceptedConflict = await request("/tasks", conflict, probeHeaders);
  assert.equal(acceptedConflict.status, 202);
  const failed = await until(() => request(`/tasks/${acceptedConflict.body.taskId}`), (value) => value.body.stage === "preparation_failed");
  assert.equal(failed.body.error.code, "invalid_probe");
  assert.equal(sourceCalls, 0);
  assert.ok(authorizations > 0);
  const beforeCredentials = store.read().facts.watermark;
  for (const key of ["token", "TOKEN", "%74oken", "api_key", "signature"])
    assert.equal((await request("/tasks", {
      ...conflict, bindings: {}, objective: { kind: "objective", url: `https://proof.invalid/objective?${key}=synthetic` },
    }, { ...probeHeaders, "Idempotency-Key": newId() })).status, 400);
  assert.equal(store.read().facts.watermark, beforeCredentials);
  const checkContract = compileInputSchema(checkInputSchema);
  checkContract.validate({ checker: { kind: "checker", url: "file:///C:/proof/checker.tgz" }, subject: {} });
  const { type: _type, timeoutMs: _timeout, ...probeInput } = conflict;
  compileInputSchema(probeInputSchema).validate(probeInput);
  passed("Probe cross-field failure is accepted then fails preparation without external calls; credential-shaped URL input never persists");
} finally {
  release();
  await server.close();
}
await assert.rejects(() => fetch(`${server.url}/task-types`, { signal: AbortSignal.timeout(1500) }));
passed("owned real HTTP server closed and port is no longer responsive");

store.close();
store = openSqliteStore(database);
const restored = createTaskEngine({
  store, types: [{ ...echo, version: "1" }, echo, probe],
  currentVersions: { echo: echo.version, probe: probe.version }, authorize: () => true,
});
restored.start();
assert.equal(restored.discoverTypes(caller).length, 2);
await restored.close();
const replaced = createTaskEngine({
  store, types: [{ ...echo, inputSchema: { type: "object" } }, probe],
  currentVersions: { echo: echo.version, probe: probe.version }, authorize: () => true,
});
assert.throws(() => replaced.start(), { code: "unsupported_contract" });
store.close();
passed("closed and reopened owned SQLite history restores; changed same-version Schema refuses reinterpretation");
proof.completedAt = new Date().toISOString();
await writeFile(resolve(root, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
console.log(JSON.stringify({ passed: proof.assertions.length, assertions: proof.assertions, commit: proof.commit }, null, 2));
