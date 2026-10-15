import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..", "..", "..");
const regulate = join(root, "packages", "objective-regulator", "dist", "bin", "regulate.js");
const continueCommand = join(root, "packages", "objective-regulator", "dist", "bin", "continue.js");

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
      `#!/usr/bin/env node\nlet s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const r=JSON.parse(s);const ok=require("node:fs").existsSync(r.subject.marker);process.stdout.write(JSON.stringify(ok?{pass:true}:{pass:false,problems:[{id:"not-ready",parameters:{}}]}));});\n`,
    );
    if (process.platform !== "win32") await chmod(check, 0o755);
    const agent = join(temporary, "agent.mjs");
    await writeFile(
      agent,
      `import{createInterface}from"node:readline";import{writeFile}from"node:fs/promises";for await(const line of createInterface({input:process.stdin})){const m=JSON.parse(line);if(!m.id)continue;let result={};if(m.method==="initialize")result={protocolVersion:"1",agentCapabilities:{loadSession:true}};if(m.method==="session/new")result={sessionId:"fixture-session"};if(m.method==="session/resume")result={};if(m.method==="session/prompt"){await writeFile(process.env.ACTION_MARKER,"yes");console.log(JSON.stringify({jsonrpc:"2.0",method:"session/update",params:{sessionId:"fixture-session",update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"done"}}}}));result={stopReason:"end_turn",summary:"created marker"};}console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result}));}`,
    );
    const config = join(temporary, "config.yaml");
    await writeFile(
      config,
      `schemaVersion: 1\ndefaultAgent: fixture\nstateDirectory: ${JSON.stringify(state)}\nagents:\n  fixture:\n    connection: {type: acp, protocolVersion: "1"}\n    transport:\n      type: stdio\n      command: ${JSON.stringify(process.execPath)}\n      args: [${JSON.stringify(agent)}]\n      env: [ACTION_MARKER]\n    requirements: {sessionResume: true}\n`,
    );
    const subject = join(temporary, "subject.json");
    await writeFile(subject, JSON.stringify({ marker }));
    const env = { ...process.env, ACTION_MARKER: marker };
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
        "--format",
        "json",
      ],
      env,
    );
    assert.equal(first.code, 0, `${first.stderr}\n${first.stdout}`);
    const result = JSON.parse(first.stdout);
    assert.equal(result.status, "target-reached");
    const second = await run(
      continueCommand,
      ["--config", config, result.regulationId, "--format", "json"],
      { ...process.env },
    );
    assert.equal(second.code, 0, `${second.stderr}\n${second.stdout}`);
    assert.equal(JSON.parse(second.stdout).status, "still-satisfied");
    const ledger = JSON.parse(
      await readFile(join(state, "regulations", result.regulationId, "regulation.json"), "utf8"),
    );
    assert.equal(ledger.attempts.length, 2);
    assert.equal(ledger.attempts[1].resumeMode, "not-needed");
    assert.match(
      await readFile(join(state, "regulations", result.regulationId, "transcript.jsonl"), "utf8"),
      /session\/update/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
