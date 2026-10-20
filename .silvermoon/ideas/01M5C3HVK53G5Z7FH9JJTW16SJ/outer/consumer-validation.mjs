import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const idea = "01M5C3HVK53G5Z7FH9JJTW16SJ";
const acceptedInner = "61ecfc89b1208bca68ca7ec98e8caf2adf4f77ea";
const acceptedPrimary = "30e7b526921b627d186d68359f75e56351f1b5d2";
const outer = dirname(fileURLToPath(import.meta.url));
const options = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, index) =>
  [process.argv[2 + index * 2], process.argv[3 + index * 2]]));
assert.equal(Object.keys(options).filter((key) => !["--plan-revision", "--global-bin", "--package-root", "--cmd-shim"].includes(key)).length, 0);
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const tree = (path) => execFileSync("git", ["rev-parse", `HEAD:${path}`], { cwd: repoRoot, encoding: "utf8" }).trim();
assert.equal(tree(`.silvermoon/ideas/${idea}/outer/inner`), acceptedInner);
assert.equal(tree(`.silvermoon/ideas/${idea}/outer`), options["--plan-revision"], "Synchronize and reobserve the exact plan before executing.");
execFileSync("git", ["diff", "--quiet", acceptedPrimary, "HEAD", "--", "packages", "apps", "scripts", "config", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"], { cwd: repoRoot });
const globalBin = resolve(options["--global-bin"] ?? "C:\\Users\\Wei\\AppData\\Local\\pnpm\\bin");
const packageRoot = resolve(options["--package-root"] ?? join(globalBin, "node_modules", "pguide"));
const packageReal = await realpath(packageRoot);
assert.equal(packageReal.toLowerCase(), (await realpath(join(repoRoot, "packages", "pguide"))).toLowerCase(), "Global pguide must be the accepted worktree junction.");
const requireInstalled = createRequire(join(packageRoot, "package.json"));
const spawn = requireInstalled("cross-spawn");
const installedPilot = requireInstalled.resolve("@potential-guide/objective-pilot");
const shimModule = options["--cmd-shim"] ?? join(dirname(process.execPath), "node_modules", "npm", "node_modules", "cmd-shim", "lib", "index.js");
const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
const resultPath = join(outer, "Consumer-results.json");
const logPath = join(outer, "Consumer.log");
const scratchParent = join(repoRoot, ".cache");
await mkdir(scratchParent, { recursive: true });
const scratch = await mkdtemp(join(scratchParent, "dco-deploy-"));
const userRoot = join(scratch, "user");
const consumer = join(scratch, "consumer");
const secondCheckout = join(scratch, "checkout2");
const rules = join(scratch, "rules");
const external = join(scratch, "external");
const config = join(scratch, "config.json");
const stateDirectory = join(scratch, "state");
const captures = join(scratch, "captures.jsonl");
const agentLog = join(scratch, "agents.jsonl");
const sentinel = join(scratch, "PUBLISH-MUST-NOT-RUN");
const pguide = join(globalBin, "pguide.cmd");
const originalEnv = { ...process.env };
const environment = {
  ...process.env,
  APPDATA: userRoot,
  XDG_CONFIG_HOME: userRoot,
  LOCALAPPDATA: join(scratch, "local"),
  USERPROFILE: join(scratch, "home"),
  HOME: join(scratch, "home"),
  PGUIDE_EVIDENCE_DISABLED: "1",
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
};
const evidence = {
  schemaVersion: 1,
  planRevision: options["--plan-revision"],
  planCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
  acceptedInner,
  startedAt: new Date().toISOString(),
  environment: { node: process.version, pguide: manifest.version, globalBin, packageRoot, packageReal, installedPilot },
  scratch,
  scenarios: [],
  commands: [],
  gitEvidence: [],
  globalShimsAdded: [],
  success: false,
};
const save = async () => {
  await writeFile(resultPath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(logPath, `${evidence.scenarios.map((item) => `${item.passed ? "PASS" : "FAIL"} ${item.id}`).join("\n")}\n`);
};
const scenario = async (id, operation) => {
  const started = performance.now();
  const details = await operation();
  evidence.scenarios.push({ id, passed: true, milliseconds: Math.round(performance.now() - started), details });
  await save();
  process.stdout.write(`PASS ${id}\n`);
};
const file = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
};
const optionalBytes = async (path) => {
  try { return await readFile(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};
const lines = async (path) => {
  const data = await optionalBytes(path);
  return data === null ? [] : data.toString("utf8").split("\n").slice(0, -1).filter(Boolean).map(JSON.parse);
};
const git = (cwd, ...args) => execFileSync("git", ["--no-pager", "-C", cwd, ...args], {
  encoding: "utf8", windowsHide: true, timeout: 15_000,
  env: { ...environment, GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" },
}).trim();
const init = async (root) => {
  await mkdir(root, { recursive: true });
  git(root, "init", "-q");
  git(root, "config", "user.name", "Directory Objectives Fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "remote", "add", "origin", pathToFileURL(root).href);
};
const commit = (root, label) => { git(root, "add", "."); git(root, "commit", "-qm", label); return git(root, "rev-parse", "HEAD"); };
const active = new Set();
function start(executable, args, { env = environment, cwd = scratch, timeoutMs = 120_000 } = {}) {
  const started = performance.now();
  const child = spawn(executable, args, { cwd, env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  active.add(child);
  let stdout = "", stderr = "", timedOut = false, spawnError;
  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid !== undefined) {
      const command = `$all = @(Get-CimInstance Win32_Process); $ids = [System.Collections.Generic.List[int]]::new(); $ids.Add(${child.pid}); for ($i = 0; $i -lt $ids.Count; $i++) { foreach ($p in $all) { if ($p.ParentProcessId -eq $ids[$i]) { $ids.Add([int]$p.ProcessId) } } }; for ($i = $ids.Count - 1; $i -ge 0; $i--) { Stop-Process -Id $ids[$i] -Force -ErrorAction SilentlyContinue }`;
      spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 20_000 });
    }
  }, timeoutMs);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("error", (error) => { spawnError = error; });
  const finished = new Promise((done, failed) => child.once("close", (exitCode, signal) => {
    clearTimeout(timer);
    active.delete(child);
    if (spawnError) return failed(new Error(`Could not start installed command: ${spawnError.code}`));
    if (timedOut) return failed(new Error(`Owned command PID ${child.pid} exceeded its hard timeout.`));
    const response = { exitCode, signal, stdout, stderr, milliseconds: Math.round(performance.now() - started) };
    evidence.commands.push({ executable, args, cwd, ...response });
    done(response);
  }));
  return { finished };
}
async function invoke(executable, args, settings) {
  return start(executable, args, settings).finished;
}
function cliArgs(args, cwd = consumer, configPath = config) {
  return [...args, "--cwd", cwd, "--config", configPath, "--format", "json"];
}
async function cli(args, expected = 0, cwd = consumer) {
  const response = await invoke(pguide, cliArgs(args, cwd));
  assert.equal(response.exitCode, expected, `${args[0]}: ${response.stdout}\n${response.stderr}`);
  return JSON.parse(response.stdout);
}
function observeSource(observation, id, root, folder, revision) {
  const source = observation.sources[id];
  const expectedTree = git(root, "rev-parse", folder ? `${revision}:${folder}` : `${revision}^{tree}`);
  assert.equal(observation.versions[id], expectedTree);
  assert.equal(source.kind, "git-tree");
  assert.equal(source.tree, expectedTree);
  assert.equal(source.commit, revision);
  assert.equal(source.repositoryTree, git(root, "rev-parse", `${revision}^{tree}`));
  assert.equal(git(root, "cat-file", "-t", source.commit), "commit");
  assert.equal(git(root, "cat-file", "-t", source.tree), "tree");
  evidence.gitEvidence.push({ id, ...source });
  return source;
}
const unit = { type: "object", additionalProperties: false, maxProperties: 0 };
const declaration = (pilot, subject = "{}", inputSchema = unit) => ({ description: "安全消费者 fixture", pilot, inputSchema, subject });
const doc = (objectives) => ({ schemaVersion: 1, objectives });
const uri = (root, folder) => `git+${pathToFileURL(root).href}#${folder}/`;
const finish = (expression) => `process.stdout.write(JSON.stringify(${expression}), () => { if (process.connected) process.disconnect(); });`;
const pass = `{status:200,payload:{ok:true,problems:[]},message:""}`;
const blocked = `{status:200,payload:{ok:false,problems:[{kind:"internal",id:"not-ready",parameters:{}}]},message:""}`;
const check = (body) => `#!/usr/bin/env node\nvoid (async () => {\nlet text = ""; for await (const chunk of process.stdin) text += chunk; const subject = JSON.parse(text);\n${body}\n})().catch(error => { console.error(error.message); process.exitCode = 1; });\n`;
const requestBridge = `
const { randomUUID } = require("node:crypto");
const request = (objectiveId, input) => new Promise((done, failed) => {
  const requestId = randomUUID();
  const timer = setTimeout(() => { process.off("message", onMessage); failed(Error("dependency fixture timeout")); }, 8000);
  const onMessage = value => {
    if (value?.type !== "pguide.dependency.result" || value.requestId !== requestId) return;
    clearTimeout(timer); process.off("message", onMessage);
    done(value.error ? {status:502,payload:null,message:"dependency source failed"} : value.envelope);
  };
  process.on("message", onMessage);
  if (!process.send) { clearTimeout(timer); process.off("message", onMessage); failed(Error("missing dependency IPC")); return; }
  process.send({ type:"pguide.dependency.request", requestId, target:{objectiveId,expectedLevelId:"terminal"}, subject:input });
});
`;
async function pilot(root, folder, body, domainSchema = { type: "object" }) {
  await file(join(root, folder, "pilot.yaml"), {
    schemaVersion: 1, domainSchema,
    levels: [{ id: "initial", advancement: { checks: [{ id: "ready", problems: ["not-ready"] }] } }],
    defaultLanguage: "en-US", languages: ["en-US"],
  });
  for (const id of ["system/overview", "system/404", "levels/initial", "levels/terminal", "levels/initial/checks/ready", "levels/initial/checks/ready/problems/not-ready"])
    await file(join(root, folder, "references", ...id.split("/"), "en-US.md"), `---\ntitle: ${JSON.stringify(folder)}\ndescription: 安全本地 fixture\nreferences: []\n---\n只验证本地消费者，不执行真实发布。\n`);
  await file(join(root, folder, "checks", "ready", "run.cjs"), check(body));
}
const markerCheck = `const { existsSync } = require("node:fs"); ${finish(`existsSync(subject.marker) ? ${pass} : ${blocked}`)}`;
const agentScript = join(scratch, "agent.cjs");
const markerA = join(consumer, "a", "ready.marker");
const markerB = join(consumer, "b", "ready.marker");
const repairMarker = join(scratch, "one-repair.marker");
const privateFiles = [
  join(originalEnv.APPDATA ?? join(originalEnv.USERPROFILE, "AppData", "Roaming"), "pguide", "config.yaml"),
  join(originalEnv.APPDATA ?? join(originalEnv.USERPROFILE, "AppData", "Roaming"), "pguide", "objectives.yaml"),
];
const privateBefore = await Promise.all(privateFiles.map(optionalBytes));
const existingNames = await readdir(globalBin);
const existingPguide = new Map();
for (const name of existingNames.filter((name) => /^pguide(?:-|\.|$)/.test(name))) {
  const path = join(globalBin, name);
  if ((await stat(path)).isFile()) existingPguide.set(name, await readFile(path));
}
try {
  await scenario("global-objectives-wiring-and-user-discovery", async () => {
    const target = join(packageRoot, manifest.bin["pguide-objectives"]);
    await stat(target);
    const destinations = ["pguide-objectives", "pguide-objectives.cmd", "pguide-objectives.ps1"];
    const present = destinations.filter((name) => existingNames.includes(name));
    if (present.length === 0) {
      const shim = createRequire(import.meta.url)(shimModule);
      await shim(target, join(globalBin, "pguide-objectives"));
      evidence.globalShimsAdded.push(...destinations);
    } else {
      assert.equal(present.length, 3, "Partial pre-existing objectives wiring must be inspected, not overwritten.");
      for (const name of destinations) assert.match((await readFile(join(globalBin, name), "utf8")).replaceAll("\\", "/"), /pguide\/dist\/bin\/objectives\.js/);
    }
    const metadata = await invoke(join(globalBin, "pguide-objectives.cmd"), ["--pguide-command-metadata"]);
    assert.equal(metadata.exitCode, 0);
    assert.equal(JSON.parse(metadata.stdout).command, "objectives");
    const help = await invoke(pguide, ["--help", "--format", "json"], { cwd: repoRoot, env: originalEnv });
    assert.equal(help.exitCode, 0);
    const discovered = JSON.parse(help.stdout).commands.find((entry) => entry.command === "objectives");
    assert.equal(discovered?.compatible, true);
    assert.equal(discovered?.source, "configured");
    return { metadata: JSON.parse(metadata.stdout), discovered };
  });
  await init(consumer); await init(rules); await init(external);
  await file(join(consumer, "README.md"), "# Plain Git consumer\nNo package manager manifest.\n");
  const captureBody = `require("node:fs").appendFileSync(${JSON.stringify(captures)}, JSON.stringify(subject)+"\\n"); ${finish(pass)}`;
  const subjectDomain = { type: "object", additionalProperties: false, required: ["directory", "relative", "checkout", "tag"], properties: Object.fromEntries(["directory", "relative", "checkout", "tag"].map((key) => [key, { type: "string" }])) };
  await pilot(rules, "unit", captureBody, subjectDomain);
  await pilot(rules, "repair", markerCheck, { type: "object", required: ["marker"], properties: { marker: { type: "string" } }, additionalProperties: false });
  await pilot(rules, "recover", finish(pass));
  await pilot(rules, "publish", `require("node:fs").writeFileSync(${JSON.stringify(sentinel)},"NOT AUTHORIZED"); ${finish(pass)}`);
  await pilot(rules, "child-a", markerCheck);
  await pilot(external, "child-b", markerCheck);
  await pilot(external, "follow-child", finish(blocked));
  await pilot(rules, "follow-root", `require("node:fs").appendFileSync(${JSON.stringify(captures)},JSON.stringify({phase:"v1"})+"\\n"); ${finish(blocked)}`);
  await pilot(rules, "portfolio", `
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const { compileInputSchema, compileSubjectProjection } = await import(${JSON.stringify(pathToFileURL(installedPilot).href)});
${requestBridge}
const replies = [], discovered = [];
for (const name of ["a","b"]) {
  const directory = path.join(subject.root,name), sourceFile = path.join(directory,"objectives.yaml");
  if (!fs.existsSync(sourceFile)) { replies.push({status:200,payload:{ok:false,problems:[{kind:"internal",id:"not-ready",parameters:{missing:name}}]},message:""}); continue; }
  const source = fs.readFileSync(sourceFile,"utf8"), entry = JSON.parse(source).objectives.gate;
  const input = name === "a" ? {} : {marker:path.join(directory,"ready.marker")};
  if (!compileInputSchema(entry.inputSchema)(input)) throw Error("invalid fixture declaration input");
  const projected = compileSubjectProjection(entry.subject,{requireDefined:true})({context:{directory:{absolutePath:directory,relativePath:name}},input});
  discovered.push({file:sourceFile,revision:createHash("sha256").update(source).digest("hex"),pilot:entry.pilot,subject:projected,expectedLevelId:"terminal"});
  replies.push(await request(entry.pilot,projected));
}
fs.appendFileSync(${JSON.stringify(captures)}, JSON.stringify({discovered})+"\\n");
const fault = replies.find(reply => reply.payload === null);
const problems = replies.flatMap(reply => reply.payload?.problems ?? []);
${finish('fault ?? {status:200,payload:{ok:problems.length===0,problems},message:""}')}
`, { type: "object", required: ["root"], properties: { root: { type: "string" } }, additionalProperties: false });
  let rulesCommit = commit(rules, "Fixture definitions");
  const externalCommit = commit(external, "External fixture definitions");
  const unitUri = uri(rules, "unit"), repairUri = uri(rules, "repair"), recoverUri = uri(rules, "recover");
  const rootUri = uri(rules, "portfolio"), childAUri = uri(rules, "child-a"), childBUri = uri(external, "child-b");
  const followUri = uri(rules, "follow-root"), followChildUri = uri(external, "follow-child");
  const projection = (tag) => `{"directory":context.directory.absolutePath,"relative":context.directory.relativePath,"checkout":context.checkout.id,"tag":${tag}}`;
  const parameterSchema = { type: "object", additionalProperties: false, required: ["tag"], properties: { tag: { type: "string" } } };
  const objectives = {
    unit: declaration(unitUri, projection('"directory-unit"')),
    param: declaration(unitUri, projection("input.tag"), parameterSchema),
    repair: declaration(repairUri, `{"marker":${JSON.stringify(repairMarker)}}`),
    recover: declaration(recoverUri),
    portfolio: declaration(rootUri, '{"root":context.checkout.rootPath}'),
    publish: declaration(uri(rules, "publish")),
    "remote-unresolved": declaration("git+https://unreachable.invalid/rules.git#quality/", '{"unused":input.required}', { type: "object", required: ["required"], properties: { required: { type: "string" } } }),
    extensible: declaration(unitUri, projection('"extensible"'), { type: "object", additionalProperties: false, patternProperties: { "^x": { type: "string" } } }),
    "bad-projection": declaration(unitUri, '{"directory":context.missing.value}'),
    "bad-subject": declaration(unitUri, "4"),
    "missing-source": declaration(`git+${pathToFileURL(join(scratch, "no-such-repo")).href}#quality/`),
  };
  const rootFile = join(consumer, "objectives.yaml");
  await file(rootFile, doc(objectives));
  await file(join(consumer, "a", "objectives.yaml"), doc({ gate: declaration(childAUri, `{"marker":context.directory.absolutePath & ${JSON.stringify(`${sep}ready.marker`)}}`) }));
  await file(join(consumer, "b", "objectives.yaml"), doc({ gate: declaration(childBUri, '{"marker":input.marker}', { type: "object", required: ["marker"], properties: { marker: { type: "string" } }, additionalProperties: false }) }));
  const consumerCommit = commit(consumer, "Plain directory declarations");
  git(consumer, "worktree", "add", "--detach", secondCheckout, consumerCommit);
  const plain = join(consumer, "plain");
  await mkdir(plain);
  await file(join(userRoot, "pguide", "objectives.yaml"), doc({
    unit: declaration(unitUri, projection('"user-unit"')),
    param: declaration(unitUri, projection("input.tag"), parameterSchema),
  }));
  await file(agentScript, `
const {createInterface} = require("node:readline"), fs = require("node:fs");
const [mode,log] = process.argv.slice(2), allowed = ${JSON.stringify([repairMarker, markerA, markerB])};
fs.appendFileSync(log,JSON.stringify({type:"start",mode,pid:process.pid})+"\\n");
void (async () => { for await (const line of createInterface({input:process.stdin})) {
  const request=JSON.parse(line); if (!request.id) continue; let result={};
  if(request.method==="initialize") result={protocolVersion:1};
  if(request.method==="session/new") result={sessionId:"local-fixture"};
  if(request.method==="session/prompt") {
    const text=request.params.prompt[0].text;
    if(mode==="plan") {
      const context=JSON.parse(text.split("\\n").at(-1));
      fs.appendFileSync(log,JSON.stringify({type:"plan",pid:process.pid,observations:context.observations,queue:context.previousQueue.demands.map(d=>({id:d.id,revision:d.revision}))})+"\\n");
      const answer=JSON.stringify({directives:context.candidates.map(g=>({goalId:g.id,priority:g.priority}))});
      console.log(JSON.stringify({jsonrpc:"2.0",method:"session/update",params:{sessionId:"local-fixture",update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:answer}}}}));
    } else {
      const subject=JSON.parse(/^Subject: (.+)$/m.exec(text)[1]);
      if(!allowed.includes(subject.marker)) throw Error("Fake Agent refuses non-allowlisted marker");
      fs.writeFileSync(subject.marker,"repaired");
      fs.appendFileSync(log,JSON.stringify({type:"repair",pid:process.pid,subject})+"\\n");
    }
    result={stopReason:"end_turn",summary:"bounded local fixture"};
  }
  console.log(JSON.stringify({jsonrpc:"2.0",id:request.id,result}));
}})().catch(error=>{console.error(error.message);process.exitCode=1;});
`);
  const profile = (mode) => ({ connection: { type: "acp", protocolVersion: "1" }, transport: { type: "stdio", command: process.execPath, args: [agentScript, mode, agentLog] } });
  await file(config, {
    schemaVersion: 2, commandDirectories: [globalBin], stateDirectory, defaultAgent: "repair",
    agentExecutionLimits: { timeoutMs: 10_000 },
    regulationStrategy: { quota: { timeoutMs: 45_000, maxAgentRuns: 2, maxStallRuns: 1 }, probe: { timeoutMs: 10_000, retry: { maxRetries: 0, delayMs: 0 } } },
    agents: { repair: profile("repair"), planner: profile("plan") },
  });
  await scenario("readonly-discovery-and-explicit-scope", async () => {
    const count = (await lines(captures)).length;
    const listed = await cli(["objectives", "list"]);
    assert.ok(listed.objectives.some((entry) => entry.name === "remote-unresolved"));
    assert.equal(listed.objectives.filter((entry) => entry.name === "unit").length, 2);
    await cli(["objectives", "show", "remote-unresolved", "--scope", "directory"]);
    await cli(["probe", "--objective", "unit"], 2);
    assert.equal((await lines(captures)).length, count);
    assert.equal((await lines(agentLog)).length, 0);
    assert.equal((await cli(["objectives", "list", "--scope", "directory"], 0, plain)).objectives.length, 0);
    await cli(["probe", "--objective", "unit", "--scope", "directory"], 2, plain);
    return { entries: listed.objectives.map(({ name, scope, file, revision }) => ({ name, scope, file, revision })), noChecksOrAgents: true, noParentInheritance: true };
  });
  await file(join(plain, "objectives.yaml"), doc({ unit: objectives.unit }));
  const input = join(scratch, "input.json");
  await scenario("root-subdirectory-and-two-checkouts", async () => {
    const before = (await lines(captures)).length;
    for (const directory of [consumer, plain, secondCheckout])
      await cli(["probe", "--objective", "unit", "--scope", "directory"], 0, directory);
    const values = (await lines(captures)).slice(before);
    assert.equal(values[0].relative, ".");
    assert.equal(values[1].relative, "plain");
    assert.equal(values[2].relative, ".");
    assert.deepEqual(values.map((value) => value.directory), [consumer, plain, secondCheckout]);
    assert.notEqual(values[0].checkout, values[2].checkout);
    assert.equal(await optionalBytes(join(consumer, "package.json")), null);
    assert.equal(await optionalBytes(join(consumer, "pnpm-workspace.yaml")), null);
    return values;
  });
  await scenario("input-types-are-orthogonal-to-scope", async () => {
    await file(input, { tag: "explicit-input" });
    for (const scope of ["user", "directory"]) {
      await cli(["probe", "--objective", "unit", "--scope", scope]);
      await cli(["probe", "--objective", "param", "--scope", scope, "--input-file", input]);
      await cli(["probe", "--objective", "param", "--scope", scope], 2);
    }
    await file(input, { x: "value" });
    await cli(["probe", "--objective", "unit", "--scope", "directory", "--input-file", input], 2);
    await cli(["probe", "--objective", "extensible", "--scope", "directory"], 2);
    await cli(["probe", "--objective", "extensible", "--scope", "directory", "--input-file", input]);
    await file(input, { tag: 4 });
    await cli(["probe", "--objective", "param", "--scope", "directory", "--input-file", input], 2);
    const last = (await lines(captures)).filter((value) => value.tag);
    assert.ok(last.some((value) => value.tag === "user-unit" && value.directory === consumer));
    assert.ok(last.some((value) => value.tag === "explicit-input"));
    return { unitAndParameterizedInBothScopes: true, extensibleObjectRequiresExplicitInput: true };
  });
  await scenario("explicit-errors-and-atomic-management", async () => {
    const before = await readFile(rootFile);
    const invalid = join(scratch, "invalid.yaml");
    await file(invalid, doc({ unit: { ...objectives.unit, target: "terminal" } }));
    await cli(["objectives", "set", "unit", "--scope", "directory", "--from", invalid], 2);
    assert.ok(before.equals(await readFile(rootFile)));
    await cli(["probe", "--objective", "missing", "--scope", "directory"], 2);
    await cli(["probe", "--objective", "bad-projection", "--scope", "directory"], 2);
    await cli(["probe", "--objective", "bad-subject", "--scope", "directory"], 2);
    await cli(["probe", "--objective", "missing-source", "--scope", "directory"], 2);
    await cli(["probe", "--pilot", `${unitUri}pilot.yaml`, "--subject-file", input], 2);
    const legacy = join(scratch, "legacy.json"), migration = join(scratch, "migration.yaml");
    await file(legacy, { schemaVersion: 2, objectives: { migrated: `${unitUri}pilot.yaml`, keep: unitUri } });
    await file(migration, doc({ migrated: declaration(recoverUri) }));
    await cli(["objectives", "migrate", "migrated", "--scope", "user", "--from", migration, "--legacy-config", legacy]);
    assert.deepEqual(JSON.parse(await readFile(legacy, "utf8")).objectives, { keep: unitUri });
    await cli(["objectives", "show", "migrated", "--scope", "user"]);
    return { invalidTargetPreservedFile: true, explicitMigrationPreservedOtherAliases: true };
  });
  await scenario("probe-does-not-repair-and-bounded-regulation", async () => {
    const first = await cli(["probe", "--objective", "repair", "--scope", "directory"]);
    assert.equal(first.payload.current.levelId, "initial");
    assert.equal(await optionalBytes(repairMarker), null);
    assert.equal((await lines(agentLog)).length, 0);
    const regulated = await cli(["regulate", "--objective", "repair", "--scope", "directory", "--target", "terminal", "--agent", "repair"]);
    assert.equal(regulated.outcome.stopReason, "target-reached");
    assert.equal(regulated.outcome.iterations, 1);
    assert.equal(await readFile(repairMarker, "utf8"), "repaired");
    return { stopReason: regulated.outcome.stopReason, iterations: regulated.outcome.iterations, regulationId: regulated.regulationId };
  });
  await scenario("directory-tree-and-retrieval-commit-are-distinct", async () => {
    const args = ["probe", "--objective", "unit", "--scope", "directory"];
    const initial = await cli(args);
    const first = observeSource(initial.payload, unitUri, rules, "unit", rulesCommit);
    await file(join(rules, "unrelated.txt"), "outside unit");
    const unrelated = commit(rules, "Unrelated repository change");
    const unchanged = observeSource((await cli(args)).payload, unitUri, rules, "unit", unrelated);
    assert.equal(unchanged.tree, first.tree);
    assert.notEqual(unchanged.commit, first.commit);
    await file(join(rules, "unit", "asset.txt"), "inside unit");
    const asset = commit(rules, "Unit asset change");
    const assetSource = observeSource((await cli(args)).payload, unitUri, rules, "unit", asset);
    assert.notEqual(assetSource.tree, first.tree);
    const reference = join(rules, "unit", "references", "system", "overview", "en-US.md");
    await file(reference, `${await readFile(reference, "utf8")}\n新的 References 内容。\n`);
    rulesCommit = commit(rules, "Unit References change");
    const referenceSource = observeSource((await cli(args)).payload, unitUri, rules, "unit", rulesCommit);
    assert.notEqual(referenceSource.tree, assetSource.tree);
    return { first, unrelated: unchanged, asset: assetSource, references: referenceSource };
  });
  await scenario("continue-uses-original-binding-and-rejects-old-evidence", async () => {
    const created = await cli(["regulate", "--objective", "recover", "--scope", "directory", "--target", "terminal", "--agent", "repair"]);
    const statePath = join(stateDirectory, "regulations", created.regulationId, "regulation.json");
    const saved = JSON.parse(await readFile(statePath, "utf8"));
    const savedTree = saved.pilotTree, savedCommit = saved.pilotCommit;
    await file(join(rules, "recover", "checks", "ready", "run.cjs"), check(finish(blocked)));
    rulesCommit = commit(rules, "Recover source now blocked");
    await file(rootFile, doc({ ...objectives, recover: declaration(uri(rules, "publish")) }));
    const resumed = await cli(["continue", created.regulationId]);
    assert.equal(resumed.outcome.stopReason, "target-reached");
    assert.equal(resumed.outcome.latestObservation.payload.versions[recoverUri], savedTree);
    assert.equal(resumed.outcome.latestObservation.payload.sources[recoverUri].commit, savedCommit);
    const directInput = join(scratch, "empty.json"); await file(directInput, {});
    const latest = await cli(["probe", "--pilot", recoverUri, "--subject-file", directInput]);
    assert.equal(latest.payload.current.levelId, "initial");
    assert.notEqual(latest.payload.versions[recoverUri], savedTree);
    const legacyId = randomUUID(); await file(join(stateDirectory, "regulations", legacyId, "regulation.json"), { ...saved, regulationId: legacyId, schemaVersion: 2 });
    await cli(["continue", legacyId], 2);
    const forgedId = randomUUID(); await file(join(stateDirectory, "regulations", forgedId, "regulation.json"), { ...saved, regulationId: forgedId, pilotTree: "0".repeat(40) });
    await cli(["continue", forgedId], 6);
    await file(rootFile, doc(objectives));
    return { savedCommit, savedTree, latest: latest.payload.sources[recoverUri], originalSubject: saved.subject, declarationRevision: saved.binding.entry.revision };
  });
  await scenario("consumer-discovers-and-supervisor-advances-two-directory-dependencies", async () => {
    const before = (await lines(agentLog)).filter((entry) => entry.type === "repair").length;
    const observation = (await cli(["probe", "--objective", "portfolio", "--scope", "directory"])).payload;
    assert.equal(observation.problems.filter((entry) => entry.kind === "dependency").length, 2);
    observeSource(observation, rootUri, rules, "portfolio", rulesCommit);
    observeSource(observation, childAUri, rules, "child-a", rulesCommit);
    observeSource(observation, childBUri, external, "child-b", externalCommit);
    const handoff = await cli(["regulate", "--objective", "portfolio", "--scope", "directory", "--target", "terminal", "--agent", "repair"], 3);
    assert.equal(handoff.outcome.iterations, 0);
    assert.equal((await lines(agentLog)).filter((entry) => entry.type === "repair").length, before);
    const portfolio = join(scratch, "dependencies.json");
    await file(portfolio, { schemaVersion: 3, goals: [{ id: "root", pilot: rootUri, subject: { root: consumer }, targetLevel: "terminal", priority: 2, observationIntervalMs: 1000 }], resources: [{ id: "one", agent: "repair", capacity: 1, capabilities: [] }] });
    const run = await cli(["supervise", "--portfolio-file", portfolio, "--planner", "planner", "--execute", "--duration-ms", "45000"]);
    assert.equal(run.observations.root.payload.current.levelId, "terminal");
    assert.equal(run.queue.demands.length, 0);
    assert.equal(await readFile(markerA, "utf8"), "repaired");
    assert.equal(await readFile(markerB, "utf8"), "repaired");
    const repairs = (await lines(agentLog)).filter((entry) => entry.type === "repair").slice(before);
    assert.deepEqual(new Set(repairs.map((entry) => entry.subject.marker)), new Set([markerA, markerB]));
    const discoveries = (await lines(captures)).filter((entry) => entry.discovered).at(-1).discovered;
    assert.equal(discoveries.length, 2);
    return { dependencies: observation.problems, handoff: handoff.outcome.stopReason, discoveries, final: run.observations.root, repairs, events: run.events.map((event) => event.type) };
  });
  await scenario("installed-continuous-supervise-follows-root-and-dependency-without-portfolio-edits", async () => {
    const portfolio = join(scratch, "follow.json");
    const contents = JSON.stringify({ schemaVersion: 3, goals: [{ id: "follow", pilot: followUri, subject: {}, targetLevel: "terminal", priority: 2, observationIntervalMs: 1000 }], resources: [] });
    await file(portfolio, contents);
    const repairs = (await lines(agentLog)).filter((entry) => entry.type === "repair").length;
    const firstCommit = git(rules, "rev-parse", "HEAD"), firstTree = git(rules, "rev-parse", `${firstCommit}:follow-root`);
    const firstDependency = git(external, "rev-parse", "HEAD");
    const firstDependencyTree = git(external, "rev-parse", `${firstDependency}:follow-child`);
    const live = start(pguide, cliArgs(["supervise", "--portfolio-file", portfolio, "--planner", "planner", "--execute", "--duration-ms", "45000"]));
    let completed;
    void live.finished.then((value) => { completed = value; });
    const deadline = Date.now() + 100_000;
    const snapshots = async () => (await lines(agentLog)).filter((entry) => entry.type === "plan").map((entry) => entry.observations.follow?.payload).filter(Boolean);
    const waitFor = async (predicate) => {
      while (!predicate(await snapshots())) {
        if (completed) throw new Error(`Supervise ended before source update: ${completed.stdout}\n${completed.stderr}`);
        assert.ok(Date.now() < deadline, "Source-follow readiness deadline exceeded.");
        await new Promise((done) => setTimeout(done, 100));
      }
    };
    await waitFor((values) => values.some((value) => value.sources[followUri]?.commit === firstCommit));
    await file(join(rules, "unrelated-follow.txt"), "outside follow-root");
    const unrelatedCommit = commit(rules, "Unrelated follow change");
    assert.equal(git(rules, "rev-parse", `${unrelatedCommit}:follow-root`), firstTree);
    await waitFor((values) => values.some((value) => value.sources[followUri]?.commit === unrelatedCommit && value.versions[followUri] === firstTree));
    await file(join(rules, "follow-root", "checks", "ready", "run.cjs"), check(`
${requestBridge}
require("node:fs").appendFileSync(${JSON.stringify(captures)},JSON.stringify({phase:"v2"})+"\\n");
${finish(`await request(${JSON.stringify(followChildUri)}, {})`)}
`));
    const changedCommit = commit(rules, "Root script now observes dependency");
    const changedTree = git(rules, "rev-parse", `${changedCommit}:follow-root`);
    assert.notEqual(changedTree, firstTree);
    await waitFor((values) => values.some((value) => value.versions[followUri] === changedTree && value.versions[followChildUri] === firstDependencyTree));
    await file(join(external, "follow-child", "checks", "ready", "run.cjs"), check(finish(pass)));
    const dependencyCommit = commit(external, "Dependency-only source update");
    const dependencyTree = git(external, "rev-parse", `${dependencyCommit}:follow-child`);
    assert.notEqual(dependencyTree, firstDependencyTree);
    await waitFor((values) => values.filter((value) => value.current.levelId === "terminal" && value.versions[followUri] === changedTree && value.versions[followChildUri] === dependencyTree).length >= 3);
    const response = await live.finished;
    assert.equal(response.exitCode, 0, response.stdout + response.stderr);
    const final = JSON.parse(response.stdout);
    assert.equal(final.observations.follow.payload.current.levelId, "terminal");
    observeSource(final.observations.follow.payload, followUri, rules, "follow-root", changedCommit);
    observeSource(final.observations.follow.payload, followChildUri, external, "follow-child", dependencyCommit);
    assert.equal(await readFile(portfolio, "utf8"), contents);
    assert.equal((await lines(agentLog)).filter((entry) => entry.type === "repair").length, repairs);
    return { firstCommit, firstTree, unrelatedCommit, changedCommit, changedTree, firstDependency, firstDependencyTree, dependencyCommit, dependencyTree, portfolioUnchanged: true, stableFinal: final.observations.follow, observedVersions: (await snapshots()).map((value) => ({ current: value.current.levelId, versions: value.versions, sources: value.sources })) };
  });
  await scenario("global-user-data-unselected-target-and-owned-resource-safety", async () => {
    assert.equal(await optionalBytes(sentinel), null);
    for (const [name, before] of existingPguide) assert.ok(before.equals(await readFile(join(globalBin, name))), `Existing global command changed: ${name}`);
    for (const [index, path] of privateFiles.entries()) {
      const after = await optionalBytes(path);
      assert.ok(privateBefore[index] === null ? after === null : after !== null && privateBefore[index].equals(after), "Real user configuration changed.");
    }
    const unexpected = (await readdir(globalBin)).filter((name) => !existingNames.includes(name) && !evidence.globalShimsAdded.includes(name));
    assert.deepEqual(unexpected, []);
    const pids = new Set((await lines(agentLog)).filter((entry) => entry.type === "start").map((entry) => entry.pid));
    const alive = [...pids].filter((pid) => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } });
    assert.deepEqual(alive, [], "Fake Agent processes must exit after bounded CLI cancellation.");
    assert.equal(active.size, 0);
    const sourceCache = join(scratch, ".cache", "pguide-sources");
    assert.deepEqual(await readdir(sourceCache), []);
    return { existingCommandCount: existingPguide.size, existingGlobalCommandsUnchanged: true, realUserFilesUnchanged: true, publishNotExecuted: true, fakeAgentProcessCount: pids.size, liveFakeAgents: alive, sourceCacheReleased: true };
  });
  evidence.success = true;
} catch (error) {
  evidence.error = { message: error.message, stack: error.stack };
  process.exitCode = 1;
  process.stderr.write(`${error.stack}\n`);
} finally {
  if (active.size === 0) {
    await rm(scratch, { recursive: true, force: true });
    evidence.cleanup = { completed: true, ownedDirectoryRemoved: scratch };
  } else {
    evidence.cleanup = { completed: false, ownedDirectoryRetained: scratch, runningCommands: active.size };
  }
  evidence.completedAt = new Date().toISOString();
  await save();
}
