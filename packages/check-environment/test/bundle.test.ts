import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readTaskArtifact } from "@potential-guide/pguide-task-bundle/artifact";
import { createTaskEngine, newId } from "@potential-guide/task-engine";
import { MemoryIpfsClient, MemoryStore, VirtualClock } from "@potential-guide/task-engine/testing";
import {
  compileInputSchema,
  compileJsonSchema,
  type JsonObject,
} from "@potential-guide/task-protocol";
import { inputSchemas, resultSchema } from "../src/contracts.js";

const caller = { scope: "environment-tests", subject: "consumer" };
const bundles = fileURLToPath(new URL("../dist/bundles/", import.meta.url));

test("all three CAR bundles preserve results, faults and cancellation through the Engine", {
  timeout: 60000,
}, async () => {
  await mkdir(resolve(".cache"), { recursive: true });
  const directory = await realpath(await mkdtemp(join(resolve(".cache"), "environment-bundles-")));
  const refs: Record<string, { directory: string; car: string; cid: string }> = JSON.parse(
    await readFile(join(bundles, "references.json"), "utf8"),
  );
  let markHanging: (() => void) | undefined;
  const server = createServer((request, response) => {
    if (request.url === "/hang") {
      markHanging?.();
      return;
    }
    response.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const store = new MemoryStore();
  const clock = new VirtualClock();
  const ipfsClient = new MemoryIpfsClient();
  for (const ref of Object.values(refs)) {
    const artifact = await readTaskArtifact(join(bundles, ref.car));
    assert.deepEqual(artifact.files, (await readTaskArtifact(join(bundles, ref.directory))).files);
    assert.equal(await ipfsClient.import(artifact.files), ref.cid);
  }
  const engine = createTaskEngine({
    store,
    clock,
    ipfsClient,
    authorize: () => true,
  });
  try {
    await engine.start();
    async function submit(kind: string, input: JsonObject) {
      const ref = refs[kind];
      assert.ok(ref);
      const request = {
        ...input,
        requestId: newId(clock.now()),
        bundle: ref.cid,
        timeoutMs: 10000,
      };
      await engine.submit(request, caller);
      const accepted = await engine.getRequestStatus(request.requestId, { waitMs: 10000 }, caller);
      assert.equal(accepted.status, "accepted", JSON.stringify(accepted));
      if (accepted.status !== "accepted") throw new Error(JSON.stringify(accepted));
      engine.tick();
      return accepted.taskId;
    }
    async function finished(taskId: string) {
      const deadline = Date.now() + 10000;
      let task = engine.getTask(taskId, caller);
      while (!["completed", "failed", "stopped"].includes(task.stage)) {
        if (Date.now() > deadline) throw new Error(`Task ${taskId} timed out.`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        task = engine.getTask(taskId, caller);
      }
      await engine.waitForTaskRelease(task.taskId, caller);
      return task;
    }
    const inputs: Record<string, JsonObject> = {
      tools: {
        tools: [{ command: process.execPath, args: ["--version"], minimumVersion: "22.13.0" }],
        checkTimeoutMs: 1000,
      },
      directories: { directories: [{ path: directory, requirements: ["read", "write"] }] },
      network: {
        dns: ["localhost"],
        http: [
          {
            url: `http://127.0.0.1:${address.port}/`,
            expectedStatus: [200],
            followRedirects: false,
          },
        ],
        checkTimeoutMs: 1000,
      },
    };
    const failures: Record<string, { input: JsonObject; expected: JsonObject }> = {
      tools: {
        input: {
          tools: [
            {
              command: process.execPath,
              args: ["-e", "console.log('v20.0.0')"],
              minimumVersion: "22.13.0",
            },
          ],
        },
        expected: {
          pass: false,
          problems: [{ target: process.execPath, code: "tool-version", actual: "20.0.0" }],
        },
      },
      directories: {
        input: { directories: [{ path: join(directory, "missing"), requirements: ["exists"] }] },
        expected: {
          pass: false,
          problems: [
            { target: join(directory, "missing"), code: "directory-unusable", actual: "ENOENT" },
          ],
        },
      },
      network: {
        input: {
          dns: [],
          http: [
            {
              url: `http://127.0.0.1:${address.port}/`,
              expectedStatus: [201],
              followRedirects: false,
            },
          ],
        },
        expected: {
          pass: false,
          problems: [
            { target: `http://127.0.0.1:${address.port}/`, code: "http-status", actual: "200" },
          ],
        },
      },
    };
    for (const [kind, passingInput] of Object.entries(inputs)) {
      const failure = failures[kind];
      assert.ok(failure);
      for (const { input, expected } of [
        { input: passingInput, expected: { pass: true } },
        failure,
      ]) {
        const task = await finished(await submit(kind, input));
        assert.equal(task.stage, "completed", JSON.stringify(task.error));
        assert.deepEqual(task.result, expected);
        compileJsonSchema(resultSchema).validate(task.result);
        const files = await readdir(join(bundles, kind));
        assert.deepEqual(files.sort(), ["task.yaml", "worker.cjs"]);
      }
    }
    const faults: { kind: string; input: JsonObject; message: RegExp }[] = [
      {
        kind: "tools",
        input: {
          tools: [
            {
              command: process.execPath,
              args: ["-e", "setInterval(()=>{},1000)"],
              minimumVersion: "1.0",
            },
          ],
          checkTimeoutMs: 100,
        },
        message: /timed out|cleanup/,
      },
      {
        kind: "tools",
        input: {
          tools: [
            {
              command: process.execPath,
              args: ["-e", "process.stdout.write('x'.repeat(300000));setInterval(()=>{},1000)"],
              minimumVersion: "1.0",
            },
          ],
        },
        message: /output|cleanup/,
      },
      {
        kind: "directories",
        input: { directories: [{ path: ".", requirements: ["write"] }] },
        message: /absolute paths/,
      },
      {
        kind: "network",
        input: {
          dns: [],
          http: [
            {
              url: `http://127.0.0.1:${address.port}/hang`,
              expectedStatus: [200],
              followRedirects: false,
            },
          ],
          checkTimeoutMs: 100,
        },
        message: /timed out/,
      },
    ];
    for (const fault of faults) {
      const task = await finished(await submit(fault.kind, fault.input));
      assert.equal(task.stage, "failed");
      assert.match(task.error?.message ?? "", fault.message);
      assert.equal(task.result, undefined);
    }
    const hanging = new Promise<void>((resolve) => {
      markHanging = resolve;
    });
    const taskId = await submit("network", {
      dns: [],
      http: [
        {
          url: `http://127.0.0.1:${address.port}/hang`,
          expectedStatus: [200],
          followRedirects: false,
        },
      ],
    });
    await hanging;
    engine.cancelTask(taskId, caller);
    const canceled = await finished(taskId);
    assert.ok(canceled.canceledAt);
    assert.equal(canceled.stage, "stopped");
    assert.equal(canceled.result, undefined);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await engine.close();
    store.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

test("bundle input contracts reject missing fields, unknown fields and invalid budgets", () => {
  for (const [kind, schema] of Object.entries(inputSchemas)) {
    const contract = compileInputSchema(schema);
    assert.throws(() => contract.validate({}), kind);
    assert.throws(() => contract.validate({ unknown: true }), kind);
  }
  const tools = compileInputSchema(inputSchemas.tools);
  assert.throws(() => tools.validate({ tools: [] }));
  assert.throws(() =>
    tools.validate({ tools: [{ command: "node", args: [], minimumVersion: ">=22" }] }),
  );
  assert.throws(() =>
    tools.validate({
      tools: [{ command: "node", args: [], minimumVersion: "22" }],
      checkTimeoutMs: 99,
    }),
  );
  const network = compileInputSchema(inputSchemas.network);
  assert.throws(() => network.validate({ dns: [], http: [] }));
});

test("result contract accepts only the exact pass or nonempty-problems variants", () => {
  const contract = compileJsonSchema(resultSchema);
  contract.validate({ pass: true });
  contract.validate({
    pass: false,
    problems: [{ target: "node", code: "tool-version", actual: "20.0.0" }],
  });
  for (const invalid of [
    { pass: true, problems: [] },
    { pass: true, checks: [] },
    { pass: false },
    { pass: false, problems: [] },
    { pass: false, problems: [{ target: "node", code: "tool-version", actual: "20", ok: false }] },
    { ok: true, checks: [] },
  ])
    assert.throws(() => contract.validate(invalid));
});
