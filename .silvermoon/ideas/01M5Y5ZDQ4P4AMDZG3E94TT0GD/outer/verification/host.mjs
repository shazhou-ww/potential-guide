import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, SubscriptionRef } from "@potential-guide/effects";
import {
  coordinator, CoordinatorModel as M, openCoordinatorStore, RequestModel as R,
} from "@potential-guide/regulation-coordinator";
import { alive, limits, readJson, workerPath, writeJson } from "./fixture.mjs";

const [profile] = process.argv.slice(2);
const workers = join(profile, "workers");
mkdirSync(workers, { recursive: true });
const recoveries = [];
const diagnostics = [];
const polls = new Set();
let completeScope;
const done = new Promise((resolve) => { completeScope = resolve; });
const watchdog = setTimeout(completeScope, 40000);

function handle(context) {
  const path = workerPath(workers, context.run.id);
  const result = new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      try {
        const state = readJson(path);
        if (state === null || state.status !== "ended" || alive(state.pid)) return;
        clearInterval(timer);
        polls.delete(timer);
        resolve({
          outcome: state.outcome,
          ...(state.outcome.kind === "target-reached" ? {
            observation: {
              status: 200,
              message: "",
              payload: {
                current: { objectiveId: context.details.objectiveRevision.spec.objectiveId, levelId: "ready" },
                observedAt: new Date().toISOString(),
                problems: [],
                gapSummary: "",
                versions: { [context.details.objectiveRevision.spec.objectiveId]: context.details.objectiveRevision.spec.version },
                sources: { [context.details.objectiveRevision.spec.objectiveId]: context.details.objectiveRevision.spec.source },
              },
            },
          } : {}),
        });
      } catch (error) {
        clearInterval(timer);
        polls.delete(timer);
        reject(error);
      }
    }, 25);
    polls.add(timer);
  });
  const stop = () => writeJson(`${path}.command`, {
    outcome: { kind: "cancelled", message: "验证请求已停止。" },
  });
  return {
    result,
    abort: async () => { stop(); },
    kill: async () => {
      stop();
      await result;
    },
  };
}

try {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const resources = yield* SubscriptionRef.make({
      kind: "configured",
      bindings: [{ binding: { id: "external-worker", configuration: { fixture: true } }, capacity: 1 }],
    });
    const requests = yield* SubscriptionRef.make(R.restoreRegulationRequests(readJson(join(profile, "input.json"))));
    const store = yield* Effect.promise(() => openCoordinatorStore(profile));
    const service = yield* coordinator(resources, requests, {
      hostId: "external-recurrence-host",
      store,
      limits,
      maxAttemptsPerRequest: 3,
      maxDependencyRequests: 8,
      abortGraceMs: 1000,
      onError: (error) => { diagnostics.push(String(error)); },
      runner: {
        start: (context) => {
          const worker = spawn(process.execPath, [
            fileURLToPath(new URL("./worker.mjs", import.meta.url)),
            workers, context.run.id, context.run.requestRef,
          ], { stdio: "ignore", detached: true, windowsHide: true });
          worker.on("error", (error) => { diagnostics.push(String(error)); });
          worker.unref();
          return handle(context);
        },
        recover: async (context) => {
          const state = readJson(workerPath(workers, context.run.id));
          if (state === null || state.runId !== context.run.id) return { kind: "unknown" };
          if (state.status !== "ended" && !alive(state.pid)) return { kind: "unknown" };
          recoveries.push({ runId: context.run.id, workerPid: state.pid, limits: context.run.limits });
          return { kind: "attached", handle: handle(context) };
        },
      },
    });
    const inspect = () => ({
      hostPid: process.pid,
      state: service.snapshot(),
      exhaustion: M.exhaustionEvents(service.snapshot()),
      recoveries,
      diagnostics,
    });
    const listener = async (message) => {
      try {
        let value;
        switch (message.type) {
          case "snapshot":
            await service.flush();
            value = inspect();
            break;
          case "events":
            value = service.eventsSince(message.afterRevision);
            break;
          case "update":
            await Effect.runPromise(SubscriptionRef.set(requests, R.restoreRegulationRequests(message.requests)));
            for (let index = 0; index < 5; index++) {
              await new Promise((resolve) => setImmediate(resolve));
              await service.flush();
            }
            value = inspect();
            break;
          case "finish":
            writeJson(`${workerPath(workers, message.runId)}.command`, { outcome: message.outcome });
            value = { accepted: true };
            break;
          case "cancel":
            await service.cancel(message.requestRef);
            value = inspect();
            break;
          case "shutdown":
            completeScope();
            value = { accepted: true };
            break;
          default:
            throw new Error(`未知验证消息：${message.type}`);
        }
        process.send({ id: message.id, value });
      } catch (error) {
        process.send({ id: message.id, error: String(error) });
      }
    };
    process.on("message", listener);
    process.send({ type: "ready", ...inspect() });
    yield* Effect.promise(() => done);
    process.off("message", listener);
  })));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  for (const timer of polls) clearInterval(timer);
  if (process.connected) process.disconnect();
}
