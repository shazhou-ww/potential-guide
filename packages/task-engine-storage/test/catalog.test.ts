import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createTaskEngine as createProductionEngine, newId } from "@potential-guide/task-engine";
import { at, type FactEvent, type Facts, type NewEvent } from "@potential-guide/task-protocol";
import { createFixtureEngine as createTaskEngine } from "../../task-engine/test/driver.js";
import { caller, harness } from "../../task-engine/test/fixtures.js";
import { openSqliteStore } from "../src/index.js";

function stripHistoricalMetadata(filename: string): void {
  const db = new DatabaseSync(filename);
  try {
    const row = db.prepare("SELECT payload FROM checkpoint").get();
    const facts = JSON.parse(String(row?.payload)) as Facts;
    for (const task of Object.values(facts.tasks)) delete task.updatedAt;
    const payload = JSON.stringify(facts);
    db.prepare("UPDATE checkpoint SET payload=?,checksum=?").run(
      payload,
      createHash("sha256").update(payload).digest("hex"),
    );
    for (const row of db.prepare("SELECT sequence,payload FROM events").all()) {
      const event = JSON.parse(String(row.payload)) as FactEvent;
      if (event.type === "task.created") {
        delete event.data.task.updatedAt;
        db.prepare("UPDATE events SET payload=? WHERE sequence=?").run(
          JSON.stringify(event),
          Number(row.sequence),
        );
      }
    }
  } finally {
    db.close();
  }
}

test("SQLite v2 exact progress backfill, original validators, restart and protected compact", async () => {
  const root = resolve(".cache", `catalog-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const filename = join(root, "history.sqlite");
  const h = harness();
  try {
    const canceled = h.submit();
    const live = h.submit();
    await h.turn();
    h.clock.setTime(h.clock.now() + 10);
    h.engine.cancelTask(canceled.taskId, caller);
    const canceledAt = at(h.clock.now());
    h.clock.setTime(h.clock.now() + 10);
    h.work[0]?.permit.progress({ stage: "execution", percent: 50, message: "" });
    const progressAt = at(h.clock.now());
    const history = h.store.read();
    const seed = openSqliteStore(filename);
    seed.claim("seed");
    seed.append(
      "seed",
      0,
      history.events.map(({ sequence: _sequence, ...event }) => event as NewEvent),
    );
    assert.throws(() => seed.compact("seed", history.facts.watermark), {
      code: "protected_history",
    });
    seed.release("seed");
    seed.close();
    stripHistoricalMetadata(filename);
    const store = openSqliteStore(filename);
    try {
      const recovered = store.read();
      assert.equal(recovered.facts.tasks[live.taskId]?.updatedAt, progressAt);
      assert.equal(recovered.facts.tasks[canceled.taskId]?.updatedAt, canceledAt);
      const unsupported = createTaskEngine({
        store,
        clock: h.clock,
        types: [{ ...h.type, version: "2" }],
        currentVersions: { echo: "2" },
        authorize: () => true,
      });
      await assert.rejects(unsupported.start(), { code: "unsupported_version" });
      const changedSchema = createTaskEngine({
        store,
        clock: h.clock,
        types: [{ ...h.type, inputSchema: { type: "object" } }],
        currentVersions: { echo: "1" },
        authorize: () => true,
      });
      await assert.rejects(changedSchema.start(), { code: "unsupported_contract" });
      assert.throws(
        () =>
          createProductionEngine({
            store,
            clock: h.clock,
            types: [h.type as unknown as import("@potential-guide/task-protocol").RegisteredType],
            currentVersions: { echo: "1" },
            authorize: () => true,
          }),
        { code: "invalid_type" },
      );
      assert.deepEqual(store.read().facts, recovered.facts);
      h.clock.setTime(h.clock.now() + 100);
      const engine = createTaskEngine({
        store,
        clock: h.clock,
        types: [h.type],
        currentVersions: { echo: "1" },
        authorize: () => true,
      });
      await engine.start();
      const page = engine.listTasks({}, {}, caller);
      assert.equal(
        page.tasks.find((item) => item.taskId === canceled.taskId)?.updatedAt,
        canceledAt,
      );
      assert.equal(
        page.tasks.find((item) => item.taskId === live.taskId)?.updatedAt,
        at(h.clock.now()),
        "interrupted run is a genuine new failure fact, not a read-time refresh",
      );
      assert.equal(engine.getRequest(live.requestId, caller).text, "hello");
      assert.equal(engine.getRequest(live.requestId, caller).version, undefined);
      await engine.close();
      const persistent = store.read();
      store.close();
      const reopened = openSqliteStore(filename);
      try {
        assert.deepEqual(reopened.read().facts, persistent.facts);
        const second = createTaskEngine({
          store: reopened,
          clock: h.clock,
          types: [h.type],
          currentVersions: { echo: "1" },
          authorize: () => true,
        });
        await second.start();
        assert.deepEqual(second.listTasks({}, {}, caller).tasks, page.tasks);
        await second.close();
        reopened.claim("compact");
        const view = reopened.read();
        reopened.append("compact", view.facts.watermark, [
          {
            type: "records.forgotten",
            scope: caller.scope,
            occurredAt: at(h.clock.now()),
            data: {
              taskIds: Object.keys(view.facts.tasks),
              runIds: Object.keys(view.facts.runs),
            },
          },
        ]);
        const boundary = reopened.read().facts.watermark;
        reopened.compact("compact", boundary);
        reopened.release("compact");
        const afterCompact = createTaskEngine({
          store: reopened,
          clock: h.clock,
          types: [h.type],
          currentVersions: { echo: "1" },
          authorize: () => true,
        });
        await afterCompact.start();
        assert.equal(afterCompact.listTasks({}, {}, caller).tasks.length, 0);
        const fresh = afterCompact.submit(
          {
            requestId: newId(),
            type: "echo",
            text: "retained",
            timeoutMs: 1_000,
            eligibleAt: at(h.clock.now() + 100_000),
          },
          caller,
        );
        await afterCompact.close();
        reopened.close();
        stripHistoricalMetadata(filename);
        const final = openSqliteStore(filename);
        try {
          assert.equal(final.read().floor, boundary);
          assert.equal(final.read().facts.tasks[fresh.taskId]?.updatedAt, fresh.receivedAt);
        } finally {
          final.close();
        }
      } finally {
        reopened.close();
      }
    } finally {
      store.close();
    }
  } finally {
    await h.close();
    await rm(root, { recursive: true, force: true });
  }
});
