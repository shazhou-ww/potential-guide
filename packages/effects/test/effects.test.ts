import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  activate,
  createLatestSlot,
  Effect,
  Exit,
  Stream,
  SubscriptionRef,
  startEffect,
  watchSnapshot,
} from "../src/index.js";

function gate<A = void>() {
  let resolve!: (value: A | PromiseLike<A>) => void;
  const promise = new Promise<A>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function pending(label: string, events: string[]) {
  const started = gate();
  return {
    started: started.promise,
    effect: Effect.callback<void>((_resume, signal) => {
      events.push(`start:${label}`);
      signal.addEventListener("abort", () => events.push(`abort:${label}`), { once: true });
      started.resolve();
      return Effect.sync(() => {
        events.push(`cleanup:${label}`);
      });
    }),
  };
}

test("lazy computation; await and exit distinguish business failure, invocation failure and cancellation", async () => {
  const events: string[] = [];
  const work = pending("one", events);
  assert.deepEqual(events, []);
  const handle = startEffect(work.effect);
  await work.started;
  handle.cancel();
  assert.ok(Exit.hasInterrupts(await handle.exit()));
  await assert.rejects(handle.await());
  assert.deepEqual(events, ["start:one", "abort:one", "cleanup:one"]);
  assert.deepEqual(await startEffect(Effect.succeed({ ok: false })).await(), { ok: false });
  const failed = startEffect(Effect.fail(new Error("unavailable")));
  assert.ok(Exit.isFailure(await failed.exit()));
  await assert.rejects(failed.await());
});

test("replacement aborts before starting new work without waiting for old cleanup", async (t) => {
  const slot = await createLatestSlot<string, string>();
  const events: string[] = [];
  const started = gate();
  const cleanup = gate();
  const release = gate();
  t.after(async () => {
    release.resolve();
    await slot.close();
  });
  const old = slot.replace(
    "old",
    Effect.callback<string>((_resume, signal) => {
      events.push("old:start");
      signal.addEventListener("abort", () => events.push("old:abort"), { once: true });
      started.resolve();
      return Effect.promise(async () => {
        events.push("cleanup:start");
        cleanup.resolve();
        await release.promise;
        events.push("cleanup:end");
      });
    }),
  );
  await started.promise;
  const next = slot.replace(
    "new",
    Effect.sync(() => {
      events.push("new:start");
      return "new";
    }),
  );
  await next.await();
  await cleanup.promise;
  assert.ok(events.indexOf("old:abort") < events.indexOf("new:start"));
  assert.ok(!events.includes("cleanup:end"));
  release.resolve();
  assert.ok(Exit.hasInterrupts(await old.exit()));
  assert.ok(events.indexOf("new:start") < events.indexOf("cleanup:end"));
});

test("parent abort reaches all children; a preaborted signal runs no synchronous work", async () => {
  const parent = new AbortController();
  const events: string[] = [];
  const left = pending("left", events);
  const right = pending("right", events);
  const handles = [
    startEffect(left.effect, parent.signal),
    startEffect(right.effect, parent.signal),
  ];
  await Promise.all([left.started, right.started]);
  parent.abort();
  for (const exit of await Promise.all(handles.map((handle) => handle.exit()))) {
    assert.ok(Exit.hasInterrupts(exit));
  }
  let invoked = false;
  const late = startEffect(
    Effect.sync(() => {
      invoked = true;
    }),
    parent.signal,
  );
  assert.ok(Exit.hasInterrupts(await late.exit()));
  assert.equal(invoked, false);
  assert.ok(events.includes("abort:left") && events.includes("abort:right"));
});

test("one root ref commits 101 coherent snapshots", async (t) => {
  const source = await Effect.runPromise(SubscriptionRef.make({ revision: 0, left: 0, right: 0 }));
  const seen: { revision: number; left: number; right: number }[] = [];
  let observed = gate();
  const watcher = watchSnapshot(source, (value) => {
    seen.push(value);
    observed.resolve();
  });
  t.after(async () => {
    watcher.cancel();
    await watcher.exit();
  });
  await observed.promise;
  for (let revision = 1; revision <= 100; revision++) {
    observed = gate();
    await Effect.runPromise(
      SubscriptionRef.set(source, { revision, left: revision, right: revision }),
    );
    await observed.promise;
  }
  assert.equal(seen.length, 101);
  assert.ok(seen.every((value) => value.revision === value.left && value.left === value.right));
});

test("independent refs combined with zipLatest are not a transaction", async (t) => {
  const left = await Effect.runPromise(SubscriptionRef.make(0));
  const right = await Effect.runPromise(SubscriptionRef.make(0));
  const initial = gate();
  const mixed = gate();
  const final = gate();
  const watcher = startEffect(
    Stream.zipLatestWith(SubscriptionRef.changes(left), SubscriptionRef.changes(right), (a, b) => [
      a,
      b,
    ]).pipe(
      Stream.runForEach(([a, b]) =>
        Effect.sync(() => {
          if (a === 0 && b === 0) initial.resolve();
          if (a === 1 && b === 0) mixed.resolve();
          if (a === 1 && b === 1) final.resolve();
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
});

test("dependency keys retain unchanged work while independent dependencies replace", async (t) => {
  const left = await createLatestSlot<string, void>();
  const right = await createLatestSlot<string, void>();
  t.after(() => Promise.all([left.close(), right.close()]));
  let leftStarts = 0;
  let rightStarts = 0;
  const input = (a: string, b: string) => {
    left.replace(
      a,
      Effect.sync(() => {
        leftStarts++;
      }),
    );
    right.replace(
      b,
      Effect.sync(() => {
        rightStarts++;
      }),
    );
  };
  input("pilot-1", "agent-1");
  input("pilot-1", "agent-2");
  input("pilot-1", "strategy-2");
  input("pilot-1", "limits-2");
  input("pilot-1", "limits-2");
  assert.deepEqual([leftStarts, rightStarts], [1, 4]);
  input("pilot-2", "pilot-2+limits-2");
  assert.deepEqual([leftStarts, rightStarts], [2, 5]);
});

test("noncooperating callback completion cannot publish a stale result", async (t) => {
  const slot = await createLatestSlot<string, string>();
  t.after(() => slot.close());
  let completeOld!: () => void;
  let oldSignal!: AbortSignal;
  let externalFinished = false;
  const started = gate();
  const old = slot.replace(
    "old",
    Effect.callback<string>((resume, signal) => {
      oldSignal = signal;
      completeOld = () => {
        externalFinished = true;
        resume(Effect.succeed("stale"));
      };
      started.resolve();
    }),
  );
  await started.promise;
  await slot.replace("new", Effect.succeed("current")).await();
  assert.ok(oldSignal.aborted);
  completeOld();
  assert.ok(Exit.hasInterrupts(await old.exit()));
  assert.ok(externalFinished);
  assert.deepEqual(await Effect.runPromise(SubscriptionRef.get(slot.state)), {
    state: "ready",
    key: "new",
    value: "current",
  });
});

test("invocation failure publishes a cause, not an empty success", async (t) => {
  const slot = await createLatestSlot<string, string, Error>();
  t.after(() => slot.close());
  assert.ok(
    Exit.isFailure(await slot.replace("broken", Effect.fail(new Error("unavailable"))).exit()),
  );
  const sample = await Effect.runPromise(SubscriptionRef.get(slot.state));
  assert.equal(sample.state, "failed");
  assert.equal(Object.hasOwn(sample, "value"), false);
});

test("uninterruptible old computations cannot overwrite a new generation", async (t) => {
  const slot = await createLatestSlot<string, string>();
  const started = gate();
  const release = gate<string>();
  t.after(async () => {
    release.resolve("old");
    await slot.close();
  });
  const old = slot.replace(
    "old",
    Effect.uninterruptible(
      Effect.promise(() => {
        started.resolve();
        return release.promise;
      }),
    ),
  );
  await started.promise;
  await slot.replace("new", Effect.succeed("current")).await();
  release.resolve("old");
  await old.exit();
  assert.deepEqual(await Effect.runPromise(SubscriptionRef.get(slot.state)), {
    state: "ready",
    key: "new",
    value: "current",
  });
});

test("HTTP abort cancels local fetch, not the server's independent work", async (t) => {
  const received = gate();
  const disconnected = gate();
  const release = gate();
  const finished = gate();
  const server = createServer(async (_request, response) => {
    response.on("close", () => disconnected.resolve());
    received.resolve();
    await release.promise;
    finished.resolve();
    if (!response.destroyed) response.end("finished");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  let handle: ReturnType<typeof startEffect> | undefined;
  t.after(async () => {
    handle?.cancel();
    release.resolve();
    if (handle) await handle.exit();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  let signal!: AbortSignal;
  handle = startEffect(
    Effect.tryPromise(async (abortSignal) => {
      signal = abortSignal;
      return (await fetch(`http://127.0.0.1:${address.port}`, { signal: abortSignal })).text();
    }),
  );
  await received.promise;
  handle.cancel();
  assert.ok(Exit.hasInterrupts(await handle.exit()));
  assert.ok(signal.aborted);
  await disconnected.promise;
  release.resolve();
  await finished.promise;
});

test("activate exposes initial/current state and scope closes active computations", async () => {
  const input = await Effect.runPromise(SubscriptionRef.make(0));
  const events: string[] = [];
  const work = pending("active", events);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* activate(
          input,
          (value) => value,
          () => work.effect,
        );
        assert.deepEqual(yield* SubscriptionRef.get(state), { state: "initial" });
        yield* Effect.promise(() => work.started);
      }),
    ),
  );
  assert.deepEqual(events, ["start:active", "abort:active", "cleanup:active"]);
});

test("preaborted slots publish cancellation without invoking the computation", async (t) => {
  const parent = new AbortController();
  parent.abort();
  const slot = await createLatestSlot<string, string>(parent.signal);
  t.after(() => slot.close());
  let invoked = false;
  const handle = slot.replace(
    "cancelled",
    Effect.sync(() => {
      invoked = true;
      return "invalid";
    }),
  );
  assert.ok(Exit.hasInterrupts(await handle.exit()));
  assert.ok(handle.signal.aborted);
  assert.equal(invoked, false);
  assert.deepEqual(await Effect.runPromise(SubscriptionRef.get(slot.state)), {
    state: "cancelled",
    key: "cancelled",
  });
});
