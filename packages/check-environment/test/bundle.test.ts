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

test("all three directory bundles run through the Engine using verified root CIDs", async () => {
  await mkdir(resolve(".cache"), { recursive: true });
  const directory = await realpath(await mkdtemp(join(resolve(".cache"), "environment-bundles-")));
  const refs: Record<string, { directory: string; cid: string }> = JSON.parse(
    await readFile(join(bundles, "references.json"), "utf8"),
  );
  const server = createServer((_request, response) => response.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const store = new MemoryStore();
  const clock = new VirtualClock();
  const ipfsClient = new MemoryIpfsClient();
  for (const ref of Object.values(refs)) {
    assert.equal(
      await ipfsClient.import((await readTaskArtifact(join(bundles, ref.directory))).files),
      ref.cid,
    );
  }
  const engine = createTaskEngine({
    store,
    clock,
    ipfsClient,
    authorize: () => true,
  });
  try {
    await engine.start();
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
        const ref = refs[kind];
        assert.ok(ref);
        const request = {
          ...input,
          requestId: newId(clock.now()),
          bundle: ref.cid,
          timeoutMs: 10000,
        };
        await engine.submit(request, caller);
        const accepted = await engine.getRequestStatus(
          request.requestId,
          { waitMs: 10000 },
          caller,
        );
        assert.equal(accepted.status, "accepted", JSON.stringify(accepted));
        if (accepted.status !== "accepted") throw new Error(JSON.stringify(accepted));
        engine.tick();
        const deadline = Date.now() + 10000;
        let task = engine.getTask(accepted.taskId, caller);
        while (!["completed", "failed", "stopped"].includes(task.stage)) {
          if (Date.now() > deadline) throw new Error(`Bundle ${kind} timed out.`);
          await new Promise((resolve) => setTimeout(resolve, 10));
          task = engine.getTask(accepted.taskId, caller);
        }
        assert.equal(task.stage, "completed", JSON.stringify(task.error));
        assert.deepEqual(task.result, expected);
        compileJsonSchema(resultSchema).validate(task.result);
        await engine.waitForTaskRelease(task.taskId, caller);
        const files = await readdir(join(bundles, kind));
        assert.deepEqual(files.sort(), ["task.yaml", "worker.cjs"]);
      }
    }
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
