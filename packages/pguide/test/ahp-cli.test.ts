import assert from "node:assert/strict";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { makeRegulatorSpec } from "@potential-guide/objective-regulator";
import { ahpHost } from "../../pguide-cli-core/test/ahp-fixture.js";
import { createProcessRegulationRunner } from "../dist/regulation-process.js";
import { createAgentPlannerPolicy } from "../src/acp-planner.js";
import { withPilot } from "../src/pilot-source.js";
import { bin, fixture, run } from "./fixtures.js";

for (const mode of [
  "deny-all",
  "configured-grant",
  "result-confirmation",
  "alternative-progress",
] as const) {
  test(`AHP permissions ${mode}: deny on wire, never guess authority, and preserve progress precedence`, async () => {
    const f = await fixture();
    const marker = join(f.directory, "permission-target");
    const state = join(f.directory, "state");
    const host = await ahpHost({
      mode: mode === "result-confirmation" ? "result-permission" : "permission",
      permissionInput: JSON.stringify({ kind: "edit", path: marker, content: "claimed grant" }),
      onDenied: async () => {
        if (mode === "alternative-progress") await writeFile(marker, "alternative repair");
      },
    });
    try {
      await writeFile(
        join(f.repository, "objective", "checks", "ready", "run.js"),
        `#!/usr/bin/env node
import{existsSync}from"node:fs";let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const ok=existsSync(JSON.parse(s).marker);console.log(JSON.stringify({status:200,message:"",payload:{ok,problems:ok?[]:[{kind:"internal",id:"not-ready",parameters:{}}]}}));});`,
      );
      await writeFile(f.subject, JSON.stringify({ marker }));
      const commit = await f.commit();
      const config = join(f.directory, "config.json");
      await writeFile(
        config,
        JSON.stringify({
          schemaVersion: 2,
          defaultAgent: "repair",
          stateDirectory: state,
          ...(mode === "deny-all"
            ? {}
            : {
                regulationPermissions: {
                  ceiling: [{ id: "edit-target", operation: "edit", resources: [marker] }],
                  grants: ["edit-target"],
                },
              }),
          agents: {
            repair: {
              type: "ahp",
              connection: { protocolVersion: "1.0.0", agent: "generic-provider" },
              transport: { type: "websocket", url: host.url },
            },
          },
        }),
      );
      const result = await run(bin("regulate"), [
        "--pilot",
        f.uri,
        "--revision",
        commit,
        "--subject-file",
        f.subject,
        "--target",
        "terminal",
        "--config",
        config,
        "--format",
        "json",
      ]);
      assert.equal(
        result.code,
        mode === "alternative-progress" ? 0 : 3,
        result.stdout + result.stderr,
      );
      const report = JSON.parse(result.stdout);
      assert.equal(
        report.outcome.stopReason,
        mode === "alternative-progress" ? "target-reached" : "authorization-required",
      );
      const actions = host.messages
        .filter(({ method }) => method === "dispatchAction")
        .map(({ params }) => params.action as { type: string; approved?: boolean });
      assert.equal(
        actions.filter(
          (action) =>
            action.type ===
              (mode === "result-confirmation"
                ? "chat/toolCallResultConfirmed"
                : "chat/toolCallConfirmed") && action.approved === false,
        ).length,
        1,
      );
      assert.equal(
        actions.some((action) => action.approved === true),
        false,
      );
      const recordPath = join(state, "regulations", report.regulationId);
      const saved = JSON.parse(await readFile(join(recordPath, "regulation.json"), "utf8"));
      assert.equal(saved.attempts[0].actions[0].authorizationRequests[0].operation, "unknown");
      assert.match(saved.attempts[0].actions[0].authorizationRequests[0].reason, /unsupported-ahp/);
      const transcript = await readFile(join(recordPath, "transcript.jsonl"), "utf8");
      assert.match(transcript, /pguide\/permission_decision/);
      assert.match(transcript, /"decision":"denied"/);
      assert.equal(saved.attempts[0].observations.length, 2);
    } finally {
      await host.close();
      await rm(f.directory, { recursive: true, force: true });
    }
  });
}

for (const scenario of ["repair", "unchanged", "denied"] as const) {
  const repaired = scenario === "repair";
  test(`AHP external confirmation keeps the recipe: ${scenario}`, async () => {
    const f = await fixture();
    const marker = join(f.directory, "external-target");
    const state = join(f.directory, "state");
    const host = await ahpHost({
      mode: "permission",
      async onPending(turnId, chatUri, connection) {
        connection.action(chatUri, {
          type: "chat/toolCallConfirmed",
          turnId,
          toolCallId: "tool",
          approved: scenario !== "denied",
          ...(scenario === "denied" ? { reason: "denied" } : { confirmed: "user-action" }),
        });
        if (repaired) await writeFile(marker, "external fixture repair");
        connection.action(chatUri, { type: "chat/turnComplete", turnId, duration: 1 });
      },
    });
    try {
      await writeFile(
        join(f.repository, "objective", "checks", "ready", "run.js"),
        `#!/usr/bin/env node
import{existsSync}from"node:fs";let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const ok=existsSync(JSON.parse(s).marker);console.log(JSON.stringify({status:200,message:"",payload:{ok,problems:ok?[]:[{kind:"internal",id:"not-ready",parameters:{}}]}}));});`,
      );
      await writeFile(f.subject, JSON.stringify({ marker }));
      const commit = await f.commit();
      const config = join(f.directory, "config.json");
      await writeFile(
        config,
        JSON.stringify({
          schemaVersion: 2,
          defaultAgent: "repair",
          stateDirectory: state,
          regulationStrategy: {
            quota: { timeoutMs: 30000, maxAgentRuns: 1, maxStallRuns: 1 },
          },
          agents: {
            repair: {
              type: "ahp",
              confirmations: "external",
              connection: { protocolVersion: "1.0.0", agent: "generic-provider" },
              transport: { type: "websocket", url: host.url },
            },
          },
        }),
      );
      const result = await run(bin("regulate"), [
        "--pilot",
        f.uri,
        "--revision",
        commit,
        "--subject-file",
        f.subject,
        "--target",
        "terminal",
        "--config",
        config,
        "--format",
        "json",
      ]);
      const report = JSON.parse(result.stdout);
      assert.equal(
        result.code,
        repaired ? 0 : scenario === "denied" ? 3 : 5,
        result.stdout + result.stderr,
      );
      assert.equal(
        report.outcome.stopReason,
        repaired
          ? "target-reached"
          : scenario === "denied"
            ? "authorization-required"
            : "exhausted",
      );
      assert.equal(
        host.messages.some(
          ({ method, params }) =>
            method === "dispatchAction" &&
            /toolCall(Result)?Confirmed/.test(String((params.action as { type: string }).type)),
        ),
        false,
      );
      const recordPath = join(state, "regulations", report.regulationId);
      const saved = JSON.parse(await readFile(join(recordPath, "regulation.json"), "utf8"));
      assert.equal(saved.attempts[0].observations.length, 2);
      if (scenario === "denied")
        assert.equal(
          saved.attempts[0].actions[0].authorizationRequests[0].reason,
          "external-ahp-confirmation-denied",
        );
      else assert.equal(saved.attempts[0].actions[0].authorizationRequests, undefined);
      assert.match(JSON.stringify(saved), /"confirmations":"external"/);
      const transcript = await readFile(join(recordPath, "transcript.jsonl"), "utf8");
      assert.match(transcript, /pguide\/ahp-external-confirmation/);
      assert.match(transcript, /awaiting-external-decision/);
      assert.doesNotMatch(transcript, /"decision":"denied"/);
    } finally {
      await host.close();
      await rm(f.directory, { recursive: true, force: true });
    }
  });
}

test("AHP CLI closes the observation loop, pins its recipe, and skips all session calls for satisfied targets", async () => {
  const f = await fixture();
  const marker = join(f.directory, "repaired");
  const state = join(f.directory, "state");
  let prompt = "";
  let savedBeforeRepair = false;
  const host = await ahpHost({
    authorityChat: true,
    deferredReady: true,
    onTurn: async (text) => {
      prompt = text;
      const [id] = await readdir(join(state, "regulations"));
      const record = JSON.parse(
        await readFile(join(state, "regulations", id as string, "regulation.json"), "utf8"),
      );
      savedBeforeRepair =
        record.sessionId === record.ahpSession.sessionUri &&
        Boolean(record.ahpSession.chatUri && record.ahpSession.turnId);
      await writeFile(marker, "repaired");
    },
  });

  await test("AHP profiles route both supervisor planning and process-worker execution through AHP", async () => {
    const f = await fixture();
    const marker = join(f.directory, "worker-repaired");
    const planner = await ahpHost({
      text: '{"directives":[{"goalId":"registered","priority":2}]}',
    });
    const worker = await ahpHost({
      onTurn: async () => {
        await writeFile(marker, "repaired");
      },
    });
    try {
      await writeFile(
        join(f.repository, "objective", "checks", "ready", "run.js"),
        `#!/usr/bin/env node
  import{existsSync}from"node:fs";let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const ok=existsSync(JSON.parse(s).marker);console.log(JSON.stringify({status:200,message:"",payload:{ok,problems:ok?[]:[{kind:"internal",id:"not-ready",parameters:{}}]}}));});`,
      );
      const commit = await f.commit();
      await withPilot(f.uri, f.directory, commit, async (pilot) => {
        const profile = (url: string) => ({
          type: "ahp" as const,
          connection: { protocolVersion: "1.0.0" as const, agent: "generic-provider" },
          transport: { type: "websocket" as const, url },
        });
        const goal = {
          id: "registered",
          pilot,
          subject: { marker },
          targetLevel: "terminal",
          priority: 2,
          observationIntervalMs: 1000,
        };
        const plan = await createAgentPlannerPolicy(
          profile(planner.url),
          f.directory,
        )({
          goals: [goal],
          candidates: [goal],
          observations: {},
          previousQueue: { revision: 0, demands: [] },
          events: [],
        });
        assert.deepEqual(plan, { directives: [{ goalId: "registered", priority: 2 }] });
        const runner = createProcessRegulationRunner({ worker: profile(worker.url) }, f.directory);
        const handle = runner.start(
          {
            spec: makeRegulatorSpec(
              pilot,
              {
                targetLevel: "terminal",
                quota: { timeoutMs: 10000, maxAgentRuns: 2, maxStallRuns: 2 },
                agentExecutionLimits: { timeoutMs: 5000 },
              },
              { id: "worker" },
            ),
            subject: { marker },
          },
          { binding: { id: "worker" } },
        );
        assert.equal((await handle.result).stopReason, "target-reached");
        assert.equal(worker.messages.filter(({ method }) => method === "createSession").length, 1);
      });
    } finally {
      await planner.close();
      await worker.close();
      await rm(f.directory, { recursive: true, force: true });
    }
  });
  try {
    await writeFile(
      join(f.repository, "objective", "checks", "ready", "run.js"),
      `#!/usr/bin/env node
import{existsSync}from"node:fs";let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const subject=JSON.parse(s);const ok=existsSync(subject.marker);console.log(JSON.stringify({status:200,message:"",payload:{ok,problems:ok?[]:[{kind:"internal",id:"not-ready",parameters:{scope:1}},{kind:"internal",id:"not-ready",parameters:{scope:2}}]}}));});`,
    );
    await writeFile(f.subject, JSON.stringify({ marker }));
    const commit = await f.commit();
    const config = join(f.directory, "config.json");
    const profile = {
      type: "ahp",
      connection: { protocolVersion: "1.0.0", agent: "generic-provider" },
      transport: { type: "websocket", url: host.url },
      requirements: { sessionResume: true },
    };
    await writeFile(
      config,
      JSON.stringify({
        schemaVersion: 2,
        defaultAgent: "repair",
        stateDirectory: state,
        agents: { repair: profile },
        agentExecutionLimits: { timeoutMs: 5000 },
      }),
    );
    const result = await run(bin("regulate"), [
      "--pilot",
      f.uri,
      "--revision",
      commit,
      "--subject-file",
      f.subject,
      "--target",
      "terminal",
      "--config",
      config,
      "--format",
      "json",
    ]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome.stopReason, "target-reached");
    assert.equal(savedBeforeRepair, true);
    assert.match(prompt, /"scope":1/);
    assert.match(prompt, /"scope":2/);
    assert.match(prompt, /Complete observation/);
    assert.match(prompt, /Agent execution limits/);
    const path = join(state, "regulations", report.regulationId, "regulation.json");
    const original = JSON.parse(await readFile(path, "utf8"));
    assert.equal(original.agentProfile.type, "ahp");
    assert.equal(
      original.ahpSession.chatUri,
      `ahp-chat://default/${Buffer.from(original.sessionId).toString("base64url")}`,
    );
    assert.equal(original.attempts[0].observations.length, 2);
    const calls = host.messages.length;
    const satisfied = await run(bin("continue"), [
      report.regulationId,
      "--config",
      config,
      "--format",
      "json",
    ]);
    assert.equal(satisfied.code, 0, satisfied.stdout + satisfied.stderr);
    assert.equal(host.messages.length, calls);
    await rm(marker);
    await writeFile(
      config,
      JSON.stringify({
        schemaVersion: 2,
        stateDirectory: state,
        agents: {
          repair: {
            ...profile,
            connection: { ...profile.connection, agent: "wrong-provider" },
            transport: { type: "websocket", url: "ws://127.0.0.1:1" },
          },
        },
      }),
    );
    const resumed = await run(bin("continue"), [
      report.regulationId,
      "--config",
      config,
      "--format",
      "json",
    ]);
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    const final = JSON.parse(await readFile(path, "utf8"));
    assert.equal(final.sessionId, original.sessionId);
    assert.equal(final.ahpSession.chatUri, original.ahpSession.chatUri);
    assert.equal(final.pilotCommit, original.pilotCommit);
    assert.equal(final.attempts[2].resumeMode, "resumed");
    assert.equal(host.messages.filter(({ method }) => method === "createSession").length, 1);
    assert.equal(
      host.messages.some(({ method }) => method === "disposeSession"),
      false,
    );
  } finally {
    await host.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("AHP Agent self-reported completion cannot satisfy an unchanged target", async () => {
  const f = await fixture();
  const host = await ahpHost({ text: "Everything is fixed. Target reached." });
  try {
    await writeFile(
      join(f.repository, "objective", "checks", "ready", "run.js"),
      '#!/usr/bin/env node\nconsole.log(JSON.stringify({status:200,message:"",payload:{ok:false,problems:[{kind:"internal",id:"not-ready",parameters:{}}]}}));',
    );
    const commit = await f.commit();
    const config = join(f.directory, "config.json");
    await writeFile(
      config,
      JSON.stringify({
        schemaVersion: 2,
        defaultAgent: "ahp",
        stateDirectory: join(f.directory, "state"),
        regulationStrategy: { quota: { timeoutMs: 10000, maxAgentRuns: 1, maxStallRuns: 1 } },
        agents: {
          ahp: {
            type: "ahp",
            connection: { protocolVersion: "1.0.0", agent: "generic-provider" },
            transport: { type: "websocket", url: host.url },
          },
        },
      }),
    );
    const result = await run(bin("regulate"), [
      "--pilot",
      f.uri,
      "--revision",
      commit,
      "--subject-file",
      f.subject,
      "--target",
      "terminal",
      "--config",
      config,
      "--format",
      "json",
    ]);
    assert.equal(result.code, 5, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).outcome.stopReason, "exhausted");
  } finally {
    await host.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});
