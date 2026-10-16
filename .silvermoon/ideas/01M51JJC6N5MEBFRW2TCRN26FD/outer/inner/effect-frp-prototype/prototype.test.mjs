import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { Effect, Exit, Stream, SubscriptionRef } from "effect";
import {
  createLatestSlot,
  dependencyKeys,
  projectInputs,
  startEffect,
  watchSnapshot,
} from "./prototype.mjs";

function gate() {
  return Promise.withResolvers();
}

function waitForState(ref, predicate) {
  return Effect.runPromise(
    SubscriptionRef.changes(ref).pipe(Stream.filter(predicate), Stream.take(1), Stream.runCollect),
  ).then((values) => values[0]);
}

function snapshot(revision = 0) {
  return {
    revision,
    pilotSpec: { objectiveId: "git+https://example.test/repo.git#pilot.json", version: "v1" },
    subject: { root: "fixture" },
    regulationStrategy: { targetLevel: "ready", agentExecutionLimits: { timeoutMs: 1000 } },
    agentBinding: { id: "agent-a" },
  };
}

function pendingEffect(label, events, started = gate()) {
  return {
    started: started.promise,
    effect: Effect.callback((_resume, signal) => {
      events.push(`start:${label}`);
      signal.addEventListener("abort", () => events.push(`abort:${label}`), { once: true });
      started.resolve();
      return Effect.sync(() => events.push(`cleanup:${label}`));
    }),
  };
}

test("Effect is lazy; a running handle cancels and reports interruption, not a business outcome", async (t) => {
  const events = [];
  const pending = pendingEffect("agent", events);
  assert.deepEqual(events, []);
  const handle = startEffect(pending.effect);
  t.after(async () => {
    handle.cancel();
    await handle.exit();
  });
  await pending.started;
  handle.cancel();
  const exit = await handle.exit();
  assert.ok(Exit.hasInterrupts(exit));
  assert.deepEqual(events, ["start:agent", "abort:agent", "cleanup:agent"]);
});

test("replacement delivers Abort before the new effect starts without waiting for old cleanup", async (t) => {
  const events = [];
  const cleanupStarted = gate();
  const releaseCleanup = gate();
  const started = gate();
  const slot = await createLatestSlot();
  t.after(async () => {
    releaseCleanup.resolve();
    await slot.close();
  });
  const old = slot.replace(
    "old",
    Effect.callback((_resume, signal) => {
      events.push("start:old");
      signal.addEventListener("abort", () => events.push("abort:old"), { once: true });
      started.resolve();
      return Effect.promise(async () => {
        events.push("cleanup:start");
        cleanupStarted.resolve();
        await releaseCleanup.promise;
        events.push("cleanup:end");
      });
    }),
  );
  await started.promise;
  const next = slot.replace(
    "new",
    Effect.sync(() => {
      events.push("start:new");
      return "new observation";
    }),
  );
  assert.ok(Exit.isSuccess(await next.exit()));
  await cleanupStarted.promise;
  assert.ok(events.indexOf("abort:old") < events.indexOf("start:new"), events.join(", "));
  assert.ok(!events.includes("cleanup:end"));
  releaseCleanup.resolve();
  assert.ok(Exit.hasInterrupts(await old.exit()));
  assert.ok(events.indexOf("start:new") < events.indexOf("cleanup:end"));
});

test("a shared parent abort reaches Pilot and Agent; an already-aborted parent starts no work", async (t) => {
  const parent = new AbortController();
  const events = [];
  const pilot = pendingEffect("pilot", events);
  const agent = pendingEffect("agent", events);
  const handles = [
    startEffect(pilot.effect, parent.signal),
    startEffect(agent.effect, parent.signal),
  ];
  t.after(async () => {
    parent.abort();
    await Promise.all(handles.map((handle) => handle.exit()));
  });
  await Promise.all([pilot.started, agent.started]);
  parent.abort();
  for (const exit of await Promise.all(handles.map((handle) => handle.exit()))) {
    assert.ok(Exit.hasInterrupts(exit));
  }
  assert.ok(events.includes("abort:pilot"));
  assert.ok(events.includes("abort:agent"));
  let invoked = false;
  const late = startEffect(
    Effect.sync(() => {
      invoked = true;
    }),
    parent.signal,
  );
  assert.ok(Exit.hasInterrupts(await late.exit()));
  assert.equal(invoked, false);
});

test("atomic snapshot projections keep all 101 observed revisions coherent", async (t) => {
  const source = await Effect.runPromise(SubscriptionRef.make(snapshot()));
  const seen = [];
  let observed = gate();
  const watcher = watchSnapshot(source, (value) => {
    const inputs = projectInputs(value);
    seen.push({
      root: value.revision,
      pilot: value.pilotSpec.generation ?? 0,
      agent: value.agentBinding.generation ?? 0,
    });
    assert.strictEqual(inputs.regulationInput[0].pilotSpec, inputs.pilotInput[0]);
    assert.strictEqual(inputs.regulationInput[1], inputs.pilotInput[1]);
    assert.equal(Object.hasOwn(inputs.regulationInput[0], "subject"), false);
    assert.equal(Object.hasOwn(inputs.regulationInput[0], "targetLevel"), false);
    observed.resolve();
  });
  t.after(async () => {
    watcher.cancel();
    await watcher.exit();
  });
  await observed.promise;
  for (let revision = 1; revision <= 100; revision++) {
    observed = gate();
    const next = snapshot(revision);
    next.pilotSpec.generation = revision;
    next.agentBinding.generation = revision;
    await Effect.runPromise(SubscriptionRef.set(source, next));
    await observed.promise;
  }
  assert.equal(seen.length, 101);
  assert.ok(seen.every(({ root, pilot, agent }) => root === pilot && pilot === agent));
});

test("control: zipLatest of independently updated refs exposes a mixed revision", async (t) => {
  const left = await Effect.runPromise(SubscriptionRef.make(0));
  const right = await Effect.runPromise(SubscriptionRef.make(0));
  const initial = gate();
  const mixed = gate();
  const final = gate();
  const seen = [];
  const watcher = startEffect(
    SubscriptionRef.changes(left).pipe(
      Stream.zipLatestWith(SubscriptionRef.changes(right), (a, b) => [a, b]),
      Stream.runForEach((pair) =>
        Effect.sync(() => {
          seen.push(pair);
          if (pair[0] === 0 && pair[1] === 0) initial.resolve();
          if (pair[0] === 1 && pair[1] === 0) mixed.resolve();
          if (pair[0] === 1 && pair[1] === 1) final.resolve();
        }),
      ),
    ),
  );
  t.after(async () => {
    watcher.cancel();
    await watcher.exit();
  });
  await initial.promise;
  await Effect.runPromise(SubscriptionRef.set(left, 1));
  await mixed.promise;
  await Effect.runPromise(SubscriptionRef.set(right, 1));
  await final.promise;
  assert.ok(seen.some(([a, b]) => a !== b));
  assert.deepEqual(seen.at(-1), [1, 1]);
});

test("dependency-scoped replacement keeps Pilot for Agent, target and execution-limit changes", async (t) => {
  const source = await Effect.runPromise(SubscriptionRef.make(snapshot()));
  const pilotSlot = await createLatestSlot();
  const repairSlot = await createLatestSlot();
  const events = [];
  let pilots = 0;
  let repairs = 0;
  let observed = gate();
  const watcher = watchSnapshot(source, (value) => {
    const keys = dependencyKeys(value);
    pilotSlot.replace(
      keys.pilot,
      Effect.suspend(() => {
        pilots++;
        return pendingEffect(`pilot:${pilots}`, events).effect;
      }),
    );
    repairSlot.replace(
      keys.repair,
      Effect.suspend(() => {
        repairs++;
        return pendingEffect(`repair:${repairs}`, events).effect;
      }),
    );
    observed.resolve();
  });
  t.after(async () => {
    watcher.cancel();
    await watcher.exit();
    await Promise.all([pilotSlot.close(), repairSlot.close()]);
  });
  await observed.promise;
  assert.deepEqual([pilots, repairs], [1, 1]);
  let current = snapshot();
  const publish = async (next) => {
    current = next;
    observed = gate();
    await Effect.runPromise(SubscriptionRef.set(source, next));
    await observed.promise;
  };
  await publish({ ...current, agentBinding: { id: "agent-b" } });
  assert.deepEqual([pilots, repairs], [1, 2]);
  await publish({
    ...current,
    regulationStrategy: { ...current.regulationStrategy, targetLevel: "complete" },
  });
  assert.deepEqual([pilots, repairs], [1, 3]);
  await publish({
    ...current,
    regulationStrategy: {
      ...current.regulationStrategy,
      agentExecutionLimits: { timeoutMs: 2000 },
    },
  });
  assert.deepEqual([pilots, repairs], [1, 4]);
  await publish(structuredClone(current));
  assert.deepEqual([pilots, repairs], [1, 4]);
  await publish({ ...current, pilotSpec: { ...current.pilotSpec, version: "v2" } });
  assert.deepEqual([pilots, repairs], [2, 5]);
  await publish({ ...current, subject: { root: "another-subject" } });
  assert.deepEqual([pilots, repairs], [3, 6]);
  for (const kind of ["pilot", "repair"]) {
    const count = kind === "pilot" ? pilots : repairs;
    for (let index = 1; index < count; index++) {
      assert.ok(
        events.indexOf(`abort:${kind}:${index}`) < events.indexOf(`start:${kind}:${index + 1}`),
        events.join(", "),
      );
    }
  }
});

test("a cancelled uncooperative callback may finish externally but cannot overwrite the current observation", async (t) => {
  const slot = await createLatestSlot();
  t.after(() => slot.close());
  const initial = await Effect.runPromise(SubscriptionRef.get(slot.state));
  assert.deepEqual(initial, { state: "initial" });
  const started = gate();
  let completeOld;
  let oldSignal;
  let externalFinished = false;
  const old = slot.replace(
    "old",
    Effect.callback((resume, signal) => {
      oldSignal = signal;
      completeOld = () => {
        externalFinished = true;
        resume(Effect.succeed("stale observation"));
      };
      started.resolve();
    }),
  );
  await started.promise;
  const next = slot.replace("new", Effect.succeed("current observation"));
  assert.ok(Exit.isSuccess(await next.exit()));
  assert.equal(oldSignal.aborted, true);
  completeOld();
  assert.ok(Exit.hasInterrupts(await old.exit()));
  assert.equal(externalFinished, true);
  assert.deepEqual(await Effect.runPromise(SubscriptionRef.get(slot.state)), {
    state: "ready",
    key: "new",
    value: "current observation",
  });
});

test("call failure remains explicit; it is not a successful or empty observation", async (t) => {
  const slot = await createLatestSlot();
  t.after(() => slot.close());
  const error = new Error("probe unavailable");
  const handle = slot.replace("broken", Effect.fail(error));
  assert.ok(Exit.isFailure(await handle.exit()));
  const sample = await waitForState(slot.state, (value) => value.state === "failed");
  assert.equal(sample.key, "broken");
  assert.equal(Object.hasOwn(sample, "value"), false);
});

test("an uninterruptible old completion cannot publish over a newer generation", async (t) => {
  const slot = await createLatestSlot();
  const started = gate();
  const finish = gate();
  t.after(async () => {
    finish.resolve("old");
    await slot.close();
  });
  const old = slot.replace(
    "old",
    Effect.uninterruptible(
      Effect.promise(() => {
        started.resolve();
        return finish.promise;
      }),
    ),
  );
  await started.promise;
  const next = slot.replace("new", Effect.succeed("new"));
  await next.exit();
  finish.resolve("old");
  await old.exit();
  assert.deepEqual(await Effect.runPromise(SubscriptionRef.get(slot.state)), {
    state: "ready",
    key: "new",
    value: "new",
  });
});

test("tryPromise aborts a real HTTP fetch but does not promise to stop remote work", async (t) => {
  const received = gate();
  const disconnected = gate();
  const allowRemoteCompletion = gate();
  const remoteFinished = gate();
  const server = createServer(async (_request, response) => {
    response.on("close", () => disconnected.resolve());
    received.resolve();
    await allowRemoteCompletion.promise;
    remoteFinished.resolve();
    if (!response.destroyed) response.end("remote finished");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  let handle;
  t.after(async () => {
    handle?.cancel();
    allowRemoteCompletion.resolve();
    if (handle) await handle.exit();
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  let signal;
  handle = startEffect(
    Effect.tryPromise(async (abortSignal) => {
      signal = abortSignal;
      const response = await fetch(`http://127.0.0.1:${address.port}`, { signal: abortSignal });
      return response.text();
    }),
  );
  await received.promise;
  handle.cancel();
  assert.ok(Exit.hasInterrupts(await handle.exit()));
  assert.equal(signal.aborted, true);
  await disconnected.promise;
  allowRemoteCompletion.resolve();
  await remoteFinished.promise;
});
