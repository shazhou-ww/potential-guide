import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { type SubmissionResult, taskSchemaUri } from "@potential-guide/task-protocol";
import { buildTaskBundle, packTaskBundle } from "@potential-guide/task-sdk/build";
import { createTaskEngine, newId } from "../src/index.js";
import { MemoryStore, VirtualClock } from "../src/testing.js";

const caller = { scope: "scope", subject: "actor" };
async function until(check: () => boolean) {
  const end = performance.now() + 10_000;
  while (!check()) {
    if (performance.now() > end) throw new Error("Bundle observation timed out.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function fixture(
  run: (value: {
    directory: string;
    digest: string;
    url: string;
    archive: Buffer;
    marker: string;
  }) => Promise<void>,
) {
  const directory = resolve(".cache", `admission-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  try {
    const declaration = join(directory, "task.yaml");
    const entry = join(directory, "callback.ts");
    const marker = join(directory, "executions.txt");
    await writeFile(
      declaration,
      JSON.stringify({
        $schema: taskSchemaUri,
        name: "shared display name",
        runtime: { type: "node", minVersion: "22.13.0" },
        entry: "worker.cjs",
        inputSchema: {
          type: "object",
          properties: { value: { type: "number" } },
          required: ["value"],
          additionalProperties: true,
        },
        resultSchema: {
          type: "object",
          properties: { value: { type: "number" } },
          required: ["value"],
          additionalProperties: false,
        },
        messageSchema: false,
      }),
    );
    await writeFile(
      entry,
      `import {appendFileSync} from "node:fs";
appendFileSync(${JSON.stringify(marker)},"loaded\\n");
export default async (input, context) => {
appendFileSync(${JSON.stringify(marker)},JSON.stringify({generation:context.generation,startedAt:context.startedAt,scope:context.scope})+"\\n");
return {value: input.value};
};`,
    );
    const built = await buildTaskBundle({
      declaration,
      entry,
      outDirectory: join(directory, "bundle"),
    });
    const packed = await packTaskBundle(built.directory, join(directory, "bundle.tar.gz"));
    await run({
      directory,
      marker,
      digest: built.digest,
      url: pathToFileURL(packed.archive).href,
      archive: await readFile(packed.archive),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function accepted(result: SubmissionResult): string {
  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") throw new Error("Expected accepted admission.");
  return result.taskId;
}
test("V04: preparing-capacity rejection is durable and does not become a fresh admission after capacity is freed", async () => {
  await fixture(async ({ directory, digest, archive }) => {
    const store = new MemoryStore(),
      clock = new VirtualClock();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fetched = 0;
    const engine = createTaskEngine({
      store,
      clock,
      bundleDirectory: join(directory, "cache"),
      authorize: () => true,
      limits: { maxPreparing: 1 },
      fetchBundle: async () => {
        fetched++;
        await pending;
        return new Response(archive);
      },
    });
    await engine.start();
    try {
      const request = {
        requestId: newId(clock.now()),
        bundle: { url: "https://example.test/task", digest },
        value: 1,
        timeoutMs: 1000,
      };
      await engine.submit(request, caller);
      const second = { ...request, requestId: newId(clock.now()) };
      const rejected = await engine.submit(second, caller);
      assert.equal(rejected.status, "rejected");
      if (rejected.status === "rejected") assert.equal(rejected.error.code, "capacity_exceeded");
      release();
      accepted(await engine.getRequestStatus(request.requestId, { waitMs: 1000 }, caller));
      assert.deepEqual(await engine.submit(second, caller), rejected);
      assert.equal(fetched, 1);
      assert.equal(Object.keys(store.read().facts.tasks).length, 1);
    } finally {
      release();
      await engine.close();
      store.close();
    }
  });
});
test("V03/V06/V10: public Engine directly executes one verified SDK Worker per Run; history needs no content or replay", async () => {
  await fixture(async ({ directory, marker, digest, url }) => {
    const store = new MemoryStore();
    const clock = new VirtualClock();
    const options = {
      store,
      clock,
      bundleDirectory: join(directory, "cache"),
      authorize: () => true,
    };
    const engine = createTaskEngine(options);
    await engine.start();
    const request = {
      requestId: newId(clock.now()),
      bundle: { url, digest },
      value: 7,
      timeoutMs: 1000,
      generation: "untrusted",
      startedAt: "untrusted",
      scope: "untrusted",
      type: "business-only",
      version: 42,
    };
    try {
      const submitted = await engine.submit(request, caller);
      assert.equal(submitted.status, "preparing");
      const id = accepted(
        await engine.getRequestStatus(request.requestId, { waitMs: 10_000 }, caller),
      );
      assert.deepEqual(engine.getRequest(request.requestId, caller), request);
      await assert.rejects(readFile(marker), { code: "ENOENT" });
      assert.equal(engine.getTask(id, caller).stage, "initial");
      engine.tick();
      await until(() => engine.getTask(id, caller).stage === "completed");
      const run = engine.getTask(id, caller).run!.runId;
      await until(() => !!engine.getRun(run, caller).reclaimedAt);
      assert.deepEqual(engine.getTask(id, caller).result, { value: 7 });
      const evaluated = await readFile(marker, "utf8");
      const identity = JSON.parse(evaluated.trim().split("\n")[1]!);
      assert.deepEqual(identity, {
        generation: store.read().facts.runs[run]!.generation,
        startedAt: engine.getRun(run, caller).startedAt,
        scope: caller.scope,
      });
      assert.deepEqual(await engine.submit(request, caller), {
        status: "accepted",
        requestId: request.requestId,
        taskId: id,
      });
      assert.equal(await engine.evictBundle(digest), true);
      await engine.close();
      const restored = createTaskEngine({
        ...options,
        fetchBundle: async () => {
          throw new Error("History must not fetch.");
        },
      });
      await restored.start();
      try {
        assert.equal(restored.getTask(id, caller).stage, "completed");
        assert.deepEqual(await restored.getRequestStatus(request.requestId, {}, caller), {
          status: "accepted",
          requestId: request.requestId,
          taskId: id,
        });
        assert.equal(await readFile(marker, "utf8"), evaluated);
      } finally {
        await restored.close();
      }
    } finally {
      await engine.close();
      store.close();
    }
  });
});
test("V03–V06: preparing survives shutdown and window advancement; shared content has independent results and final creation anchors", async () => {
  await fixture(async ({ directory, digest, archive }) => {
    const store = new MemoryStore();
    const clock = new VirtualClock();
    let fetched = 0;
    const options = {
      store,
      clock,
      bundleDirectory: join(directory, "cache"),
      authorize: () => true,
      limits: { windowMs: 100, futureSkewMs: 0, requestResultRetentionMs: 20 },
    };
    const engine = createTaskEngine({
      ...options,
      fetchBundle: async (_url, init) => {
        fetched++;
        init!.signal!.throwIfAborted();
        return new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), {
            once: true,
          });
        });
      },
    });
    await engine.start();
    const first = {
      requestId: newId(clock.now()),
      bundle: { url: "https://example.test/first", digest },
      value: 1,
      timeoutMs: 5,
      eligibleAt: new Date(clock.now() + 10).toISOString(),
    };
    const second = {
      ...first,
      requestId: newId(clock.now()),
      bundle: { url: "https://example.test/second", digest },
      value: "invalid",
    };
    try {
      assert.equal((await engine.submit(first, caller)).status, "preparing");
      assert.equal((await engine.submit(second, caller)).status, "preparing");
      await until(() => fetched === 1);
      assert.equal(
        (await engine.getRequestStatus(first.requestId, { waitMs: 5 }, caller)).status,
        "preparing",
      );
      assert.equal(Object.keys(store.read().facts.tasks).length, 0);
      await assert.rejects(engine.submit({ ...first, value: 2 }, caller), {
        code: "idempotency_conflict",
      });
      await assert.rejects(
        engine.getRequestStatus(first.requestId, {}, { scope: "other", subject: "actor" }),
        { code: "forbidden" },
      );
      clock.advance(1000);
      await assert.rejects(engine.submit(first, caller), { code: "request_expired" });
      assert.equal(engine.collectRequestResults(), 0);
      assert.equal(
        (await engine.getRequestStatus(first.requestId, {}, caller)).status,
        "preparing",
      );
      await engine.close();
      const restored = createTaskEngine({
        ...options,
        fetchBundle: async () => {
          fetched++;
          return new Response(archive);
        },
      });
      await restored.start();
      try {
        const id = accepted(
          await restored.getRequestStatus(first.requestId, { waitMs: 10_000 }, caller),
        );
        const rejected = await restored.getRequestStatus(
          second.requestId,
          { waitMs: 10_000 },
          caller,
        );
        assert.equal(rejected.status, "rejected");
        if (rejected.status === "rejected") assert.equal(rejected.error.code, "invalid_input");
        assert.equal(fetched, 2);
        assert.equal(Object.keys(store.read().facts.tasks).length, 1);
        assert.equal(restored.getTask(id, caller).receivedAt, new Date(clock.now()).toISOString());
        assert.equal(Date.parse(restored.getTask(id, caller).deadlineAt) - clock.now(), 5);
        const terminal = store.read().facts.submissions[first.requestId]!.terminalAt;
        clock.advance(19);
        assert.equal(restored.collectRequestResults(), 0);
        assert.equal(store.read().facts.submissions[first.requestId]!.terminalAt, terminal);
        clock.advance(1);
        assert.equal(restored.collectRequestResults(), 2);
        await assert.rejects(restored.getRequestStatus(first.requestId, {}, caller), {
          code: "record_unavailable",
        });
        assert.deepEqual(restored.getRequest(first.requestId, caller), first);
        assert.equal(restored.getTask(id, caller).stage, "initial");
        await assert.rejects(restored.submit(first, caller), { code: "request_expired" });
      } finally {
        await restored.close();
      }
    } finally {
      await engine.close();
      store.close();
    }
  });
});
test("V04: a definitive acquisition failure is persisted and idempotent, not retried by status or resubmission", async () => {
  await fixture(async ({ directory, digest }) => {
    const store = new MemoryStore();
    const clock = new VirtualClock();
    let fetched = 0;
    const engine = createTaskEngine({
      store,
      clock,
      bundleDirectory: join(directory, "cache"),
      authorize: () => true,
      fetchBundle: async () => {
        fetched++;
        throw new Error("Remote secret diagnostics must not leak.");
      },
    });
    await engine.start();
    try {
      const request = {
        requestId: newId(clock.now()),
        bundle: { url: "https://example.test/unavailable", digest },
        value: 1,
        timeoutMs: 10,
      };
      await engine.submit(request, caller);
      const rejected = await engine.getRequestStatus(request.requestId, { waitMs: 1000 }, caller);
      assert.equal(rejected.status, "rejected");
      assert.equal(JSON.stringify(rejected).includes("secret"), false);
      assert.deepEqual(await engine.submit(request, caller), rejected);
      assert.deepEqual(
        await engine.getRequestStatus(request.requestId, { waitMs: 1000 }, caller),
        rejected,
      );
      assert.equal(fetched, 1);
      assert.equal(Object.keys(store.read().facts.tasks).length, 0);
      await assert.rejects(engine.getRequestStatus(newId(clock.now()), {}, caller), {
        code: "not_found",
      });
      await assert.rejects(engine.getRequestStatus(request.requestId, { waitMs: -1 }, caller), {
        code: "invalid_request",
      });
    } finally {
      await engine.close();
      store.close();
    }
  });
});
