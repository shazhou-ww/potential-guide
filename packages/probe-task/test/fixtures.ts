import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type ContractArtifact,
  checkerSchemaUri,
  inspectContractFiles,
  objectiveSchemaUri,
} from "@potential-guide/check-artifacts/contracts";
import type { ArtifactSource } from "@potential-guide/check-task";
import { newId } from "@potential-guide/task-engine";
import { MemoryStore } from "@potential-guide/task-engine/testing";
import { type Clock, isTimedOut, type TaskSnapshot } from "@potential-guide/task-protocol";
import { createCheckFixture as createCheckTaskType } from "../../check-task/test/type-fixture.js";
import { createFixtureEngine as createTaskEngine } from "../../task-engine/test/driver.js";
import type { ProbeTaskOptions } from "../src/index.js";
import { createProbeFixture as createProbeTaskType } from "./type-fixture.js";
export const caller = { scope: "a", subject: "tester" };
export const rootUrl = "https://example.test/root.tgz";
export const checkUrl = "https://example.test/check.tgz";
export const pass = "exports.execute=()=>({status:200,message:'',payload:{ok:true,problems:[]}})";
const page = Buffer.from("---\ntitle: Test\ndescription: Test\n---\nBody\n");
export function checker(code = pass) {
  return inspectContractFiles(
    new Map([
      [
        "checker.yaml",
        Buffer.from(
          JSON.stringify({
            $schema: checkerSchemaUri,
            runtime: { type: "node", minVersion: "22.13.0" },
            entry: "checker.cjs",
            subjectSchema: { type: "object" },
            languages: ["en"],
            problems: ["bad"],
          }),
        ),
      ],
      ["checker.cjs", Buffer.from(code)],
      ["references/en/checker.md", page],
      ["references/en/problems/bad.md", page],
    ]),
  );
}
export function objective(
  checks: Record<string, { url: string; digest: string; subjectMapping: string }>,
  levels = [{ id: "ready", checks: Object.keys(checks) }],
) {
  return inspectContractFiles(
    new Map([
      [
        "objective.yaml",
        Buffer.from(
          JSON.stringify({
            $schema: objectiveSchemaUri,
            subjectSchema: { type: "object" },
            languages: ["en"],
            levels,
            checkers: checks,
          }),
        ),
      ],
      ["references/en/objective.md", page],
      ...levels.map((level) => [`references/en/levels/${level.id}.md`, page] as [string, Buffer]),
    ]),
  );
}
export function entries(code = pass) {
  const check = checker(code);
  const root = objective({ check: { url: checkUrl, digest: check.digest, subjectMapping: "$" } });
  return new Map([
    [rootUrl, root],
    [checkUrl, check],
  ]);
}
export async function wait(
  read: () => TaskSnapshot,
  predicate = (value: TaskSnapshot) =>
    !!value.termination || !!value.canceledAt || isTimedOut(value),
  timeout = 60_000,
) {
  const until = Date.now() + timeout;
  for (;;) {
    const value = read();
    if (predicate(value)) return value;
    if (Date.now() > until) throw new Error(`Stalled task: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
export async function harness(
  artifacts = entries(),
  options: Partial<ProbeTaskOptions> = {},
  limits: { executionWallMs?: number } = {},
  clock?: Clock,
) {
  const directory = resolve(".cache", `probe-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const source: ArtifactSource = {
    authorize(_reference, scope) {
      assert.equal(scope, caller.scope);
    },
    async resolve(reference, _scope, signal) {
      signal.throwIfAborted();
      const artifact = artifacts.get(reference.url);
      if (!artifact) throw new Error("Missing artifact.");
      return artifact;
    },
  };
  const check = createCheckTaskType({ source, directory, workers: 1, wallMs: 30_000, graceMs: 10 });
  const store = new MemoryStore();
  let engine: ReturnType<typeof createTaskEngine>;
  const probe = createProbeTaskType({
    source,
    checkEnvironment: check.environment,
    parents: 2,
    wallMs: 30_000,
    children: (scope) => ({
      service: engine,
      caller: { scope, subject: "trusted-probe" },
      waitForTaskRelease: (id, caller) => engine.waitForTaskRelease(id, caller),
    }),
    ...options,
  });
  engine = createTaskEngine({
    store,
    types: [check, probe],
    currentVersions: { check: "2", probe: "2" },
    authorize: (who, _operation, scope) => who.scope === scope,
    limits: { maxConcurrent: 1, maxPayloadBytes: 8 * 1024 * 1024, ...limits },
    ...(clock ? { clock } : {}),
  });
  engine.start();
  return {
    engine,
    store,
    check,
    probe,
    source,
    directory,
    submit(fields = {}) {
      return engine.submit(
        {
          requestId: newId(),
          type: "probe",
          objective: { kind: "objective", url: rootUrl },
          subject: {},
          timeoutMs: 60_000,
          ...fields,
        },
        caller,
      );
    },
    read(task: TaskSnapshot) {
      return engine.getTask(task.taskId, caller);
    },
    async close() {
      await engine.close();
      await probe.close();
      await check.close();
      assert.deepEqual(await readdir(directory), []);
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
export function binding(artifact: ContractArtifact, url = checkUrl) {
  return { url, digest: artifact.digest, subjectMapping: "$" };
}
