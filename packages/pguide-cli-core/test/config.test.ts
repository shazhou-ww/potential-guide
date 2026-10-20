import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { test } from "node:test";
import {
  AcpClient,
  atomicWrite,
  digest,
  loadConfig,
  parseConfig,
  pruneExpiredRegulations,
  readJsonSubject,
  redactSensitive,
  resolveObjective,
  validateAgentProfile,
} from "@potential-guide/cli-core";
import { pipeRedactedSecrets } from "../src/streaming-secret-redactor.js";

const scratch = resolve(import.meta.dirname, "..", "..", "..", ".cache");
await mkdir(scratch, { recursive: true });
const tmpdir = () => scratch;

test("interactive subject input fails explicitly instead of waiting for stdin", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  try {
    await assert.rejects(readJsonSubject(undefined, scratch), /Pipe a JSON subject/);
    await assert.rejects(readJsonSubject("-", scratch), /Pipe a JSON subject/);
  } finally {
    if (descriptor === undefined) Reflect.deleteProperty(process.stdin, "isTTY");
    else Object.defineProperty(process.stdin, "isTTY", descriptor);
  }
});

test("Registered Objectives validate names and targets without changing literal paths", () => {
  const config = parseConfig(
    JSON.stringify({
      schemaVersion: 2,
      objectives: { health: "git+https://example.invalid/repo#pilot.yaml" },
    }),
  );
  assert.equal(resolveObjective("health", config), config.objectives?.health);
  assert.equal(resolveObjective("@health", config), config.objectives?.health);
  assert.equal(resolveObjective("./health", config), "./health");
  const unregisteredUri = "git+https://example.invalid/unregistered.git#pilot.yaml";
  assert.equal(resolveObjective(unregisteredUri, config), unregisteredUri);
  assert.equal(resolveObjective("unregistered.yaml", config), "unregistered.yaml");
  assert.equal(resolveObjective("toString", config), "toString");
  assert.throws(() => resolveObjective("@missing", config), /Unknown registered Objective/);
  for (const objectives of [
    [],
    null,
    { "bad/name": "path" },
    { good: "" },
    { good: 3 },
    { good: "@other" },
  ])
    assert.throws(
      () => parseConfig(JSON.stringify({ schemaVersion: 2, objectives })),
      /objective/i,
    );
});

test("Registered Objectives merge by name with per-entry provenance", async () => {
  const cwd = await mkdtemp(join(scratch, "pguide-objective-config-"));
  try {
    await mkdir(join(cwd, ".pguide"));
    const project = join(cwd, ".pguide", "config.yaml");
    const explicit = join(cwd, "explicit.json");
    await writeFile(
      project,
      JSON.stringify({
        schemaVersion: 2,
        objectives: { shared: "project", kept: "kept" },
      }),
    );
    await writeFile(
      explicit,
      JSON.stringify({
        schemaVersion: 2,
        objectives: { shared: "explicit", extra: "extra" },
      }),
    );
    const loaded = await loadConfig(cwd, explicit);
    assert.equal(loaded.value.objectives?.shared, "explicit");
    assert.equal(loaded.value.objectives?.kept, "kept");
    assert.equal(loaded.value.objectives?.extra, "extra");
    assert.equal(loaded.sources["objectives.shared"], explicit);
    assert.equal(loaded.sources["objectives.kept"], project);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("configuration limits apply only to individual Agent executions", () => {
  assert.deepEqual(parseConfig("schemaVersion: 2\nagentExecutionLimits:\n  timeoutMs: 1234\n"), {
    schemaVersion: 2,
    agentExecutionLimits: { timeoutMs: 1234 },
  });
});

test("permission config requires explicit exact rules and grants within the administrative ceiling", () => {
  const permissions = {
    ceiling: [
      { id: "read", operation: "read", resources: [join(scratch, "read")] },
      { id: "edit", operation: "edit", resources: [join(scratch, "edit")] },
      { id: "verify", operation: "execute", command: "node verify.mjs" },
    ],
    grants: ["edit", "verify"],
  };
  assert.deepEqual(
    parseConfig(JSON.stringify({ schemaVersion: 2, regulationPermissions: permissions }))
      .regulationPermissions,
    permissions,
  );
  for (const value of [
    { grants: ["all"] },
    { ceiling: [], grants: ["all"] },
    { ...permissions, grants: ["edit", "edit"] },
    { ...permissions, ceiling: [...permissions.ceiling, permissions.ceiling[0]] },
    { ceiling: [{ id: "bad", operation: "write", resources: [scratch] }], grants: [] },
    { ceiling: [{ id: "bad", operation: "read", resources: ["relative"] }], grants: [] },
    { ceiling: [{ id: "bad", operation: "read", resources: [`${scratch}/*`] }], grants: [] },
    {
      ceiling: [{ id: "bad", operation: "execute", command: "node", resources: [scratch] }],
      grants: [],
    },
    { ceiling: [{ id: "bad", operation: "execute", command: "" }], grants: [] },
    { ceiling: [], grants: [], allowAll: true },
  ])
    assert.throws(
      () => parseConfig(JSON.stringify({ schemaVersion: 2, regulationPermissions: value })),
      /regulationPermissions/,
    );
});

test("invalid and legacy configuration limits are rejected", () => {
  assert.throws(() => parseConfig("schemaVersion: 1\n"), /Legacy configuration/);
  assert.throws(
    () => parseConfig("schemaVersion: 2\nlimits:\n  maxIterations: 8\n"),
    /cross-round/,
  );
  for (const value of ["0", "-1", "1.5", "2147483648", "invalid"]) {
    assert.throws(() =>
      parseConfig(`schemaVersion: 2\nagentExecutionLimits:\n  timeoutMs: ${value}\n`),
    );
  }
  assert.throws(() => parseConfig("schemaVersion: 2\nagentExecutionLimits:\n  maxIterations: 8\n"));
});

test("regulation strategy validates single-run quota and rejects scheduling fields", () => {
  const strategy = {
    quota: { timeoutMs: 20000, maxAgentRuns: 5, maxStallRuns: 2 },
    probe: { timeoutMs: 5000, retry: { maxRetries: 2, delayMs: 10 } },
  };
  assert.deepEqual(
    parseConfig(JSON.stringify({ schemaVersion: 2, regulationStrategy: strategy }))
      .regulationStrategy,
    strategy,
  );
  assert.deepEqual(
    parseConfig("schemaVersion: 2\nregulationStrategy: {}\n").regulationStrategy,
    {},
  );
  for (const invalid of [
    { mode: { type: "periodic", intervalMs: 1000 } },
    { mode: { type: "periodic", intervalMs: 0 } },
    { mode: { type: "adhoc", intervalMs: 1 } },
    { mode: { type: "unknown" } },
    { mode: { type: "adhoc" } },
    { quota: { timeoutMs: 0, maxAgentRuns: 1, maxStallRuns: 1 } },
    { quota: { timeoutMs: 1000, maxAgentRuns: 0, maxStallRuns: 1 } },
    { quota: { timeoutMs: 1000, maxAgentRuns: 1, maxStallRuns: -1 } },
    { quota: { timeoutMs: 1000 } },
    { probe: { timeoutMs: 0, retry: { maxRetries: 0, delayMs: 0 } } },
    { probe: { timeoutMs: 1, retry: { maxRetries: -1, delayMs: 0 } } },
    { probe: { timeoutMs: 1, retry: { maxRetries: 0, delayMs: -1 } } },
    { probe: { timeoutMs: 1 } },
    { effectTtlMs: 0 },
    { effectTtlMs: 1000 },
    { maxIterations: 1 },
  ])
    assert.throws(() =>
      parseConfig(JSON.stringify({ schemaVersion: 2, regulationStrategy: invalid })),
    );
});

test("ACP stderr redaction applies backpressure with bounded cross-chunk state", async () => {
  const secret = 'quote" slash\\\\ newline\nUnicode雪';
  const prefix = Buffer.from("diagnostic:");
  const suffix = Buffer.from(":safe\n");
  const payload = Buffer.concat([prefix, Buffer.from(secret), suffix]);
  const repetitions = 20_000;
  const sourceChunks: Buffer[] = [];
  for (let index = 0; index < repetitions; index += 1) {
    const split = (index % (payload.length - 1)) + 1;
    sourceChunks.push(payload.subarray(0, split), payload.subarray(split));
  }
  let sent = 0;
  let sourceBackpressured = false;
  let sourcePaused = false;
  const source = new Readable({
    highWaterMark: 256,
    read() {
      while (sent < sourceChunks.length) {
        const chunk = sourceChunks[sent] as Buffer;
        sent += 1;
        if (!this.push(chunk)) {
          sourceBackpressured = true;
          return;
        }
      }
      this.push(null);
    },
  });
  source.on("pause", () => {
    sourcePaused = true;
  });
  const chunks: Buffer[] = [];
  const destination = new Writable({
    highWaterMark: 32,
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      setImmediate(callback);
    },
  });

  const { redactor, completion } = pipeRedactedSecrets(source, destination, [secret]);
  await completion;

  const output = Buffer.concat(chunks).toString("utf8");
  assert.equal(sourceBackpressured, true);
  assert.equal(sourcePaused, true);
  assert.equal(sent, sourceChunks.length);
  assert.equal(output.includes(secret), false);
  assert.equal((output.match(/\[REDACTED\]/g) ?? []).length, repetitions);
  assert.equal(output, `diagnostic:[REDACTED]:safe\n`.repeat(repetitions));
  assert.ok(redactor.maxBufferedTailBytes <= Buffer.byteLength(secret) - 1);
});

test("ACP stderr redaction propagates destination errors without hanging", async () => {
  const source = Readable.from([Buffer.from("safe output")]);
  const destination = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error("destination failed"));
    },
  });
  const { completion } = pipeRedactedSecrets(source, destination, ["secret"]);
  await assert.rejects(completion, /destination failed/);
  assert.equal(source.destroyed, true);
});

test("ACP requests reject after the Agent or client closes", async () => {
  const exited = new AcpClient({
    connection: { type: "acp", protocolVersion: "1" },
    transport: {
      type: "stdio",
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
    },
  });
  await assert.rejects(exited.initialize("1"), /exited|closed|writable/i);
  await assert.rejects(exited.request("after/close", {}), /exited|closed|writable/i);
  await exited.stop();

  const closed = new AcpClient({
    connection: { type: "acp", protocolVersion: "1" },
    transport: {
      type: "stdio",
      command: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"],
    },
  });
  await closed.stop();
  await assert.rejects(closed.request("after/stop", {}), /closed|writable/i);
});

test("configuration validates ACP profiles and rejects secret literals", () => {
  const profile = validateAgentProfile({
    connection: { type: "acp", protocolVersion: "1" },
    transport: { type: "stdio", command: "fixture", args: ["--acp"], env: ["TEST_TOKEN"] },
    requirements: { sessionResume: true },
  });
  assert.equal(profile.type, "acp");
  assert.deepEqual(profile.connection, { protocolVersion: "1" });
  assert.throws(() => parseConfig("schemaVersion: 2\npassword: literal\n"));
  assert.throws(() =>
    validateAgentProfile({
      connection: { type: "acp", protocolVersion: "1" },
      transport: { type: "stdio", command: "fixture", token: "literal" },
    }),
  );
  for (const name of [
    "api-key",
    "client-secret",
    "bearer-token",
    "authorization",
    "access-token",
    "refresh-token",
    "private-key",
    "credential",
    "token",
    "password",
  ]) {
    for (const args of [[`--${name}`, "literal"], [`--${name}=literal`]]) {
      assert.throws(() =>
        validateAgentProfile({
          connection: { type: "acp", protocolVersion: "1" },
          transport: { type: "stdio", command: "fixture", args },
        }),
      );
    }
  }
  for (const args of [["--api-key", "literal"], ["--token=literal"], ["--password", "literal"]]) {
    assert.throws(() =>
      validateAgentProfile({
        connection: { type: "acp", protocolVersion: "1" },
        transport: { type: "stdio", command: "fixture", args },
      }),
    );
  }
  assert.doesNotThrow(() =>
    validateAgentProfile({
      connection: { type: "acp", protocolVersion: "1" },
      transport: {
        type: "stdio",
        command: "fixture",
        args: ["--tokenizer", "fast", "--api-key-env", "SERVICE_API_KEY"],
        env: ["SERVICE_API_KEY"],
      },
    }),
  );
  assert.deepEqual(
    redactSensitive({
      nested: { credential: "hidden" },
      transport: {
        args: ["--client-secret=hidden", "--authorization", "hidden", "--tokenizer", "safe"],
      },
    }),
    {
      nested: { credential: "[REDACTED]" },
      transport: {
        args: [
          "--client-secret=[REDACTED]",
          "--authorization",
          "[REDACTED]",
          "--tokenizer",
          "safe",
        ],
      },
    },
  );
});

test("explicit configuration merges profiles by whole profile and atomic writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pguide-config-"));
  try {
    const path = join(root, "config.yaml");
    await mkdir(join(root, ".pguide"));
    await writeFile(
      join(root, ".pguide", "config.yaml"),
      "schemaVersion: 2\nregulationStrategy:\n  quota: {timeoutMs: 20000, maxAgentRuns: 5, maxStallRuns: 2}\n",
    );
    await atomicWrite(
      path,
      "schemaVersion: 2\ndefaultAgent: fixture\nregulationStrategy:\n  probe: {timeoutMs: 5000, retry: {maxRetries: 2, delayMs: 10}}\nagents:\n  fixture:\n    connection: {type: acp, protocolVersion: '1'}\n    transport: {type: stdio, command: fixture}\n",
    );
    const loaded = await loadConfig(root, path);
    assert.equal(loaded.value.defaultAgent, "fixture");
    assert.equal(loaded.sources["agents.fixture"], path);
    assert.deepEqual(loaded.value.regulationStrategy, {
      quota: { timeoutMs: 20000, maxAgentRuns: 5, maxStallRuns: 2 },
      probe: { timeoutMs: 5000, retry: { maxRetries: 2, delayMs: 10 } },
    });
    await writeFile(join(root, "bad.yaml"), "schemaVersion: 1\n");
    await assert.rejects(loadConfig(root, join(root, "bad.yaml")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generic digest is stable and detects JSON subject changes", () => {
  const subject = { name: "fixture", entries: [1, 2] };
  assert.equal(digest(subject), digest(structuredClone(subject)));
  assert.notEqual(digest(subject), digest({ ...subject, entries: [1, 3] }));
});

test("retention pruning removes only expired in-root Regulation directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "pguide-retention-"));
  const outside = await mkdtemp(join(tmpdir(), "pguide-retention-outside-"));
  try {
    const regulations = join(root, "regulations");
    const expired = join(regulations, "11111111-1111-4111-8111-111111111111");
    const current = join(regulations, "22222222-2222-4222-8222-222222222222");
    await mkdir(expired, { recursive: true });
    await mkdir(current, { recursive: true });
    await writeFile(
      join(expired, "regulation.json"),
      JSON.stringify({ expiresAt: "2020-01-01T00:00:00.000Z" }),
    );
    await writeFile(
      join(current, "regulation.json"),
      JSON.stringify({ expiresAt: "2099-01-01T00:00:00.000Z" }),
    );
    await writeFile(join(outside, "marker"), "safe");
    if (process.platform !== "win32") {
      await symlink(outside, join(regulations, "33333333-3333-4333-8333-333333333333"));
    }
    assert.equal(await pruneExpiredRegulations(root, new Date("2025-01-01T00:00:00Z")), 1);
    await assert.rejects(readFile(join(expired, "regulation.json")));
    assert.ok(await readFile(join(current, "regulation.json")));
    assert.equal(await readFile(join(outside, "marker"), "utf8"), "safe");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
