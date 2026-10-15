import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { digest } from "@potential-guide/cli-core";
import { InvocationCancelledError, InvocationTimeoutError, withinInvocation } from "../src/cli.js";

const root = resolve(import.meta.dirname, "..", "..", "..");
const regulate = join(root, "packages", "objective-regulator", "dist", "bin", "regulate.js");
const continueCommand = join(root, "packages", "objective-regulator", "dist", "bin", "continue.js");

test("invocation finalization has one owner at timeout and simulated cancellation", async () => {
  let lateSideEffects = 0;
  await assert.rejects(
    withinInvocation(10, async (signal) => {
      await new Promise<void>((resolveWait) =>
        signal.addEventListener(
          "abort",
          () =>
            setTimeout(() => {
              lateSideEffects += 1;
              resolveWait();
            }, 10),
          { once: true },
        ),
      );
      return "late-success";
    }),
    InvocationTimeoutError,
  );
  assert.equal(lateSideEffects, 1);

  let cancel: (() => void) | undefined;
  await assert.rejects(
    withinInvocation(
      1_000,
      async (signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        ),
      (handler) => {
        cancel = handler;
        queueMicrotask(handler);
        return () => {
          cancel = undefined;
        };
      },
    ),
    InvocationCancelledError,
  );
  assert.equal(cancel, undefined);
});

function run(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolveRun({ code: code ?? 70, stdout, stderr }));
  });
}

async function runAndSignal(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  marker: string,
  signal: "SIGINT" | "SIGTERM",
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [script, ...args], { cwd: root, env, windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const result = new Promise<{ code: number; stdout: string; stderr: string }>(
    (resolveRun, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolveRun({ code: code ?? 70, stdout, stderr }));
    },
  );
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      await readFile(marker);
      break;
    } catch {
      if (Date.now() >= deadline) {
        child.kill();
        throw new Error("ACP resume fixture did not start.");
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }
  process.kill(child.pid as number, signal);
  return result;
}

async function page(rootPath: string, id: string, title: string, outcome?: string) {
  const path = join(rootPath, "references", ...id.split("/"), "en-US.md");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `---\ntitle: ${title}\ndescription: fixture${outcome ? `\noutcome: ${outcome}` : ""}\n---\n`,
  );
}

test("regulate and continue integrate with a fixture ACP Agent and persisted Attempts", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "pguide-regulate-"));
  try {
    const guide = join(temporary, "guide");
    const marker = join(temporary, "satisfied");
    const state = join(temporary, "state");
    await mkdir(join(guide, "checks", "ready"), { recursive: true });
    await writeFile(
      join(guide, "objective-guide.yaml"),
      "schemaVersion: 1\ndomainSchema:\n  type: object\n  required: [marker]\n  properties:\n    marker: {type: string}\nlevels:\n  - id: initial\n    advancement:\n      checks: [ready]\ndefaultLanguage: en-US\nlanguages: [en-US]\n",
    );
    await page(guide, "system/overview", "Fixture");
    await page(guide, "system/404", "Missing");
    await page(guide, "levels/initial", "Initial", "Satisfy fixture");
    await page(guide, "levels/terminal", "Terminal");
    await page(guide, "checks/ready", "Ready");
    await page(guide, "problems/not-ready", "Not ready");
    const check = join(guide, "checks", "ready", "run.js");
    await writeFile(
      check,
      `#!/usr/bin/env node\nlet s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const r=JSON.parse(s);if(r.subject.marker==="hang"){setInterval(()=>{},1000);return;}const ok=require("node:fs").existsSync(r.subject.marker);process.stdout.write(JSON.stringify(ok?{pass:true}:{pass:false,problems:[{id:"not-ready",parameters:{}}]}));});\n`,
    );
    if (process.platform !== "win32") await chmod(check, 0o755);
    const agent = join(temporary, "agent.mjs");
    await writeFile(
      agent,
      `import{createInterface}from"node:readline";import{writeFile}from"node:fs/promises";for await(const line of createInterface({input:process.stdin})){const m=JSON.parse(line);if(!m.id)continue;let result={};if(m.method==="initialize")result={protocolVersion:"1",agentCapabilities:{loadSession:true}};if(m.method==="session/new")result={sessionId:"fixture-session"};if(m.method==="session/resume"){if(process.env.HANG_RESUME){await writeFile(process.env.RESUME_MARKER,"yes");await new Promise(()=>{});}result={};}if(m.method==="session/prompt"){if(process.env.CANCEL_RESPONSE)result={stopReason:"cancelled"};else{await writeFile(process.env.ACTION_MARKER,"yes");process.stderr.write("fixture diagnostic: ");for(const part of [process.env.SECRET_ENV.slice(0,3),process.env.SECRET_ENV.slice(3,11),process.env.SECRET_ENV.slice(11)]){process.stderr.write(part);await new Promise(resolve=>setTimeout(resolve,5));}process.stderr.write(" :complete\\n");console.log(JSON.stringify({jsonrpc:"2.0",method:"session/update",params:{sessionId:"fixture-session",update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"agent echoed "+process.env.SECRET_ENV}}}}));result={stopReason:"end_turn",summary:"created marker "+process.env.SECRET_ENV};}}console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result}));}`,
    );
    const config = join(temporary, "config.yaml");
    await writeFile(
      config,
      JSON.stringify({
        schemaVersion: 1,
        defaultAgent: "fixture",
        stateDirectory: state,
        agents: {
          fixture: {
            connection: { type: "acp", protocolVersion: "1" },
            transport: {
              type: "stdio",
              command: process.execPath,
              args: [agent],
              env: [
                "ACTION_MARKER",
                "SECRET_ENV",
                "CANCEL_RESPONSE",
                "HANG_RESUME",
                "RESUME_MARKER",
              ],
            },
            requirements: { sessionResume: true },
          },
        },
      }),
    );
    const subject = join(temporary, "subject.json");
    const report = join(temporary, "report.json");
    const canonicalSubject = {
      marker,
      token: "business-token-not-a-credential",
      nested: { authorization: "ordinary-domain-value" },
    };
    await writeFile(subject, JSON.stringify(canonicalSubject));
    const echoedSecret = 'quote" slash\\\\ newline\nUnicode雪';
    const encodedSecret = JSON.stringify(echoedSecret).slice(1, -1);
    const env = { ...process.env, ACTION_MARKER: marker, SECRET_ENV: echoedSecret };
    const first = await run(
      regulate,
      [
        "--config",
        config,
        "--guide",
        join(guide, "objective-guide.yaml"),
        "--subject-file",
        subject,
        "--target",
        "terminal",
        "--report",
        report,
        "--format",
        "json",
      ],
      env,
    );
    assert.equal(first.code, 0, `${first.stderr}\n${first.stdout}`);
    const result = JSON.parse(first.stdout);
    assert.equal(result.status, "target-reached");
    assert.equal(first.stdout.includes(echoedSecret), false);
    assert.equal(first.stdout.includes(encodedSecret), false);
    assert.equal(first.stderr.includes(echoedSecret), false);
    assert.match(first.stderr, /fixture diagnostic: \[REDACTED\] :complete/);
    const reportSource = await readFile(report, "utf8");
    const reportValue = JSON.parse(reportSource);
    assert.equal(reportValue.regulationId, result.regulationId);
    assert.ok(reportValue.attempts[0].rounds.length >= 2);
    assert.ok(reportValue.attempts[0].actions.length >= 1);
    assert.match(reportValue.attempts[0].actions[0].summary, /\[REDACTED\]/);
    assert.match(reportValue.recovery.command, /pguide continue/);
    assert.equal(JSON.stringify(reportValue).includes(echoedSecret), false);
    assert.equal(reportSource.includes(encodedSecret), false);
    const second = await run(
      continueCommand,
      ["--config", config, result.regulationId, "--format", "json"],
      { ...process.env },
    );
    assert.equal(second.code, 0, `${second.stderr}\n${second.stdout}`);
    assert.equal(JSON.parse(second.stdout).status, "still-satisfied");
    const regulationPath = join(state, "regulations", result.regulationId, "regulation.json");
    const ledgerSource = await readFile(regulationPath, "utf8");
    const ledger = JSON.parse(ledgerSource);
    assert.equal(ledger.attempts.length, 2);
    assert.equal(ledger.attempts[1].resumeMode, "not-needed");
    assert.deepEqual(ledger.subject, canonicalSubject);
    assert.equal(ledger.subjectDigest, digest(canonicalSubject));
    assert.equal(ledgerSource.includes(encodedSecret), false);
    if (process.platform !== "win32") {
      assert.equal((await stat(regulationPath)).mode & 0o777, 0o600);
    }
    const transcript = await readFile(
      join(state, "regulations", result.regulationId, "transcript.jsonl"),
      "utf8",
    );
    assert.match(transcript, /session\/update/);
    assert.equal(transcript.includes(echoedSecret), false);
    assert.equal(transcript.includes(encodedSecret), false);
    assert.match(transcript, /\[REDACTED\]/);
    await unlink(marker);
    const resumeBaseline = JSON.parse(await readFile(regulationPath, "utf8"));
    resumeBaseline.attempts.at(-1).limits.timeoutMs = 150;
    const resumeMarker = join(temporary, "resume-started");
    const continueArgs = ["--config", config, result.regulationId, "--format", "json"];
    const resumeEnvironment = {
      ...process.env,
      HANG_RESUME: "yes",
      RESUME_MARKER: resumeMarker,
    };

    await writeFile(regulationPath, `${JSON.stringify(resumeBaseline, null, 2)}\n`);
    const resumeTimeout = await run(continueCommand, continueArgs, resumeEnvironment);
    assert.equal(resumeTimeout.code, 5, resumeTimeout.stdout);
    assert.equal(JSON.parse(resumeTimeout.stdout).status, "timed-out");
    let resumedLedger = JSON.parse(await readFile(regulationPath, "utf8"));
    assert.equal(resumedLedger.attempts.at(-1).status, "timed-out");
    assert.ok(resumedLedger.attempts.at(-1).completedAt);

    if (process.platform !== "win32") {
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        await rm(resumeMarker, { force: true });
        await writeFile(regulationPath, `${JSON.stringify(resumeBaseline, null, 2)}\n`);
        const signalled = await runAndSignal(
          continueCommand,
          continueArgs,
          resumeEnvironment,
          resumeMarker,
          signal,
        );
        assert.equal(signalled.code, 5, `${signal}: ${signalled.stderr}\n${signalled.stdout}`);
        assert.equal(JSON.parse(signalled.stdout).status, "cancelled");
        resumedLedger = JSON.parse(await readFile(regulationPath, "utf8"));
        assert.equal(resumedLedger.attempts.at(-1).status, "cancelled");
        assert.ok(resumedLedger.attempts.at(-1).completedAt);
      }
    }

    await writeFile(regulationPath, `${JSON.stringify(resumeBaseline, null, 2)}\n`);
    await writeFile(marker, "yes");

    const hangingSubject = join(temporary, "hanging-subject.json");
    await writeFile(hangingSubject, JSON.stringify({ marker: "hang" }));
    const probeStarted = Date.now();
    const probeTimeout = await run(
      regulate,
      [
        "--config",
        config,
        "--guide",
        join(guide, "objective-guide.yaml"),
        "--subject-file",
        hangingSubject,
        "--target",
        "terminal",
        "--timeout",
        "100ms",
        "--format",
        "json",
      ],
      env,
    );
    assert.equal(probeTimeout.code, 5, probeTimeout.stdout);
    assert.ok(Date.now() - probeStarted < 5_000);

    await writeFile(check, `${await readFile(check, "utf8")}\n`);
    const changedGuide = await run(
      continueCommand,
      ["--config", config, result.regulationId, "--format", "json"],
      { ...process.env },
    );
    assert.equal(changedGuide.code, 2, changedGuide.stdout);
    const changedLedger = JSON.parse(
      await readFile(join(state, "regulations", result.regulationId, "regulation.json"), "utf8"),
    );
    assert.equal(changedLedger.attempts.at(-1).status, "failed");
    assert.equal(changedLedger.attempts.at(-1).errorCategory, "guide");
    assert.equal(changedLedger.attempts.at(-1).errorSummary, "guide failure");

    await writeFile(check, (await readFile(check, "utf8")).trimEnd());
    await unlink(marker);
    const hanging = join(temporary, "hanging-agent.mjs");
    await writeFile(
      hanging,
      `import{createInterface}from"node:readline";for await(const line of createInterface({input:process.stdin})){JSON.parse(line);await new Promise(()=>{});}`,
    );
    const hangingConfig = join(temporary, "hanging-config.yaml");
    await writeFile(
      hangingConfig,
      `schemaVersion: 1\ndefaultAgent: fixture\nstateDirectory: ${JSON.stringify(state)}\nagents:\n  fixture:\n    connection: {type: acp, protocolVersion: "1"}\n    transport: {type: stdio, command: ${JSON.stringify(process.execPath)}, args: [${JSON.stringify(hanging)}]}\n`,
    );
    const started = Date.now();
    const timedOut = await run(
      regulate,
      [
        "--config",
        hangingConfig,
        "--guide",
        join(guide, "objective-guide.yaml"),
        "--subject-file",
        subject,
        "--target",
        "terminal",
        "--timeout",
        "100ms",
        "--format",
        "json",
      ],
      { ...process.env },
    );
    assert.equal(timedOut.code, 5, timedOut.stdout);
    assert.equal(JSON.parse(timedOut.stdout).status, "timed-out");
    assert.ok(Date.now() - started < 5_000);
    const timeoutId = JSON.parse(timedOut.stdout).regulationId;
    const timeoutLedger = JSON.parse(
      await readFile(join(state, "regulations", timeoutId, "regulation.json"), "utf8"),
    );
    assert.equal(timeoutLedger.attempts[0].status, "timed-out");
    assert.ok(timeoutLedger.attempts[0].completedAt);

    const cancelled = await run(
      regulate,
      [
        "--config",
        config,
        "--guide",
        join(guide, "objective-guide.yaml"),
        "--subject-file",
        subject,
        "--target",
        "terminal",
        "--format",
        "json",
      ],
      { ...env, CANCEL_RESPONSE: "yes" },
    );
    assert.equal(cancelled.code, 5, cancelled.stdout);
    assert.equal(JSON.parse(cancelled.stdout).status, "cancelled");
    const cancelledId = JSON.parse(cancelled.stdout).regulationId;
    const cancelledLedger = JSON.parse(
      await readFile(join(state, "regulations", cancelledId, "regulation.json"), "utf8"),
    );
    assert.equal(cancelledLedger.attempts[0].status, "cancelled");
    assert.ok(cancelledLedger.attempts[0].completedAt);

    const before = new Set(await readdir(join(state, "regulations")));
    const badAgentConfig = join(temporary, "bad-agent-config.yaml");
    await writeFile(
      badAgentConfig,
      `schemaVersion: 1\ndefaultAgent: fixture\nstateDirectory: ${JSON.stringify(state)}\nagents:\n  fixture:\n    connection: {type: acp, protocolVersion: "1"}\n    transport: {type: stdio, command: ${JSON.stringify(join(temporary, "missing-agent"))}}\n`,
    );
    const failed = await run(
      regulate,
      [
        "--config",
        badAgentConfig,
        "--guide",
        join(guide, "objective-guide.yaml"),
        "--subject-file",
        subject,
        "--target",
        "terminal",
        "--format",
        "json",
      ],
      { ...process.env },
    );
    assert.equal(failed.code, 6, failed.stdout);
    const failedId = (await readdir(join(state, "regulations"))).find((id) => !before.has(id));
    assert.ok(failedId);
    const failedLedger = JSON.parse(
      await readFile(join(state, "regulations", failedId, "regulation.json"), "utf8"),
    );
    assert.equal(failedLedger.attempts[0].status, "failed");
    assert.ok(failedLedger.attempts[0].completedAt);
    assert.doesNotMatch(JSON.stringify(failedLedger.attempts[0]), /missing-agent/);

    const unknown = await run(regulate, ["--unknown", "value", "--format", "json"], {
      ...process.env,
    });
    assert.equal(unknown.code, 2, unknown.stdout);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
