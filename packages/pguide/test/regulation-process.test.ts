import assert from "node:assert/strict";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { makeRegulatorSpec } from "@potential-guide/objective-regulator";
import { withPilot } from "../../cli-runtime/src/pilot-source.js";
import { createProcessRegulationRunner } from "../../pguide-regulate/dist/regulation-process.js";
import { fixture } from "./fixtures.js";

test("process runner returns verified results only after worker cleanup", async () => {
  const f = await fixture();
  try {
    const commit = await f.commit();
    await withPilot(f.uri, f.directory, commit, async (objective) => {
      const runner = createProcessRegulationRunner(
        {
          unused: {
            type: "acp",
            connection: { protocolVersion: "1" },
            transport: {
              type: "stdio",
              command: process.execPath,
              args: ["-e", "process.exit(99)"],
            },
          },
        },
        f.directory,
      );
      const handle = runner.start(
        {
          spec: makeRegulatorSpec(
            objective,
            {
              targetLevel: "terminal",
              quota: { timeoutMs: 10000, maxAgentRuns: 2, maxStallRuns: 2 },
              agentExecutionLimits: { timeoutMs: 5000 },
            },
            { id: "unused" },
          ),
          subject: {},
        },
        { binding: { id: "unused" } },
      );
      const result = await handle.result;
      assert.equal(result.stopReason, "target-reached");
      assert.equal(result.iterations, 0);
      assert.deepEqual(await readdir(join(f.directory, ".cache", "pguide-runs")), []);
    });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("force termination stops a live process tree and cleans the owned run directory", async () => {
  const f = await fixture();
  const pidFile = join(f.directory, "probe.pid");
  try {
    await writeFile(
      join(f.repository, "objective", "checks", "ready", "worker.cjs"),
      "const fs = require(\"node:fs\");\nexports.execute = async (inputSubject, context) => { const text = JSON.stringify(inputSubject); fs.writeFileSync(JSON.parse(text).pidFile, String(process.pid)); setInterval(() => { }, 1000); };\n",
    );
    const commit = await f.commit();
    await withPilot(f.uri, f.directory, commit, async (objective) => {
      const runner = createProcessRegulationRunner(
        {
          unused: {
            type: "acp",
            connection: { protocolVersion: "1" },
            transport: { type: "stdio", command: process.execPath },
          },
        },
        f.directory,
      );
      const handle = runner.start(
        {
          spec: makeRegulatorSpec(
            objective,
            {
              targetLevel: "terminal",
              quota: { timeoutMs: 30000, maxAgentRuns: 2, maxStallRuns: 2 },
              agentExecutionLimits: { timeoutMs: 5000 },
            },
            { id: "unused" },
          ),
          subject: { pidFile },
        },
        { binding: { id: "unused" } },
      );
      try {
        const deadline = Date.now() + 15000;
        let pid: number | undefined;
        while (pid === undefined) {
          try {
            pid = Number(await readFile(pidFile, "utf8"));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            assert.ok(Date.now() < deadline, "Worker probe did not start.");
            await delay(20);
          }
        }
        await handle.kill();
        await assert.rejects(handle.result, /cancelled|exited/);
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
        assert.deepEqual(await readdir(join(f.directory, ".cache", "pguide-runs")), []);
      } finally {
        await handle.kill();
        await handle.result.catch(() => undefined);
      }
    });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("worker forwards capability requests as events without treating them as new executions", async () => {
  const f = await fixture();
  try {
    await writeFile(
      join(f.repository, "objective", "checks", "ready", "worker.cjs"),
      "const { existsSync } = require(\"node:fs\");\nexports.execute = async (inputSubject, context) => {\n    const text = JSON.stringify(inputSubject);\n    const ok = existsSync(JSON.parse(text).marker);\n    return { status: 200, message: \"\", payload: ok ? { ok: true, problems: [] } : { ok: false, problems: [{ kind: \"internal\", id: \"not-ready\", parameters: {} }] } };\n};\n",
    );
    const commit = await f.commit();
    const marker = join(f.directory, "ready");
    const agent = join(f.directory, "agent.mjs");
    await writeFile(
      agent,
      `
    import {createInterface} from "node:readline";
    import {writeFileSync} from "node:fs";
    for await (const line of createInterface({input:process.stdin})) {
    const m=JSON.parse(line);if(!m.id)continue;let result={};
    if(m.method==="initialize"){
      if(m.params.protocolVersion!==1)throw Error("Expected numeric ACP version");
      result={protocolVersion:1};
    }
    if(m.method==="session/new")result={sessionId:"worker"};
    if(m.method==="session/prompt"){
    console.log(JSON.stringify({jsonrpc:"2.0",method:"pguide/capability-request",params:{capability:"design",reason:"Need illustration support"}}));
    const text=m.params.prompt[0].text;
    const subject=JSON.parse(text.split("Subject: ")[1].split("\\n")[0]);
    writeFileSync(subject.marker,"ready");result={stopReason:"end_turn",summary:"Done"};
    }
    console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result}));}
    `,
    );
    const events: unknown[] = [];
    await withPilot(f.uri, f.directory, commit, async (objective) => {
      const runner = createProcessRegulationRunner(
        {
          fixture: {
            type: "acp",
            connection: { protocolVersion: "1" },
            transport: { type: "stdio", command: process.execPath, args: [agent] },
          },
        },
        f.directory,
        (_input, event) => events.push(event),
      );
      const result = await runner.start(
        {
          spec: makeRegulatorSpec(
            objective,
            {
              targetLevel: "terminal",
              quota: { timeoutMs: 10000, maxAgentRuns: 2, maxStallRuns: 2 },
              agentExecutionLimits: { timeoutMs: 5000 },
            },
            { id: "fixture" },
          ),
          subject: { marker },
        },
        { binding: { id: "fixture" } },
      ).result;
      assert.equal(result.stopReason, "target-reached");
      assert.equal(result.iterations, 1);
    });
    assert.deepEqual(events, [
      {
        type: "capability-request",
        capability: "design",
        reason: "Need illustration support",
      },
    ]);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
