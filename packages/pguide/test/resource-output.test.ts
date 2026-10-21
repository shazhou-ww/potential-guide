import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { bin, root, scratch } from "./fixtures.js";

const top = join(root, "packages", "pguide", "dist", "bin.js");
const agents = join(root, "packages", "pguide-agents", "dist", "bin.js");
const config = join(root, "packages", "pguide-config", "dist", "bin.js");
const declarationSchema = "https://shazhou-ww.github.io/potential-guide/schemas/objectives/v1.json";
const agentSchema = "https://shazhou-ww.github.io/potential-guide/schemas/agents/v1.json";

async function context() {
  const directory = await mkdtemp(join(scratch, "resource-output-"));
  const user = join(directory, "user");
  const cwd = join(directory, "项目 `resource`");
  await mkdir(join(cwd, ".pguide"), { recursive: true });
  const configuration = join(cwd, ".pguide", "config.yaml");
  await writeFile(configuration, JSON.stringify({ schemaVersion: 2 }));
  const env = {
    ...process.env,
    APPDATA: user,
    XDG_CONFIG_HOME: user,
    HOME: user,
    PATH: dirname(process.execPath),
  };
  return {
    directory,
    cwd,
    configuration,
    env,
    async run(script: string, args: string[], extra: NodeJS.ProcessEnv = {}) {
      return new Promise<{ code: number; stdout: string; stderr: string }>((done, fail) => {
        const child = spawn(process.execPath, [script, ...args, "--cwd", cwd], {
          cwd,
          env: { ...env, ...extra },
          windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("error", fail);
        child.on("close", (code) => done({ code: code ?? 70, stdout, stderr }));
      });
    },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("resource empty states retain JSON envelopes through direct and root entrypoints", async () => {
  const f = await context();
  try {
    for (const [script, prefix, empty, field] of [
      [bin("objectives"), [], /No Objective declarations found/, "objectives"],
      [top, ["objectives"], /No Objective declarations found/, "objectives"],
      [agents, [], /No Agent profiles found/, "agents"],
      [top, ["agents"], /No Agent profiles found/, "agents"],
      [config, ["list-objectives"], /No registered Objectives/, "objectives"],
      [top, ["config", "list-objectives"], /No registered Objectives/, "objectives"],
    ] as const) {
      const args =
        prefix.length === 0 || prefix[0] === "objectives" || prefix[0] === "agents"
          ? [...prefix, "list"]
          : [...prefix];
      for (const format of [[], ["--format", "markdown"], ["--format", "json"]]) {
        const result = await f.run(script, [...args, ...format]);
        assert.equal(result.code, 0, result.stderr + result.stdout);
        if (format.includes("json")) {
          const value = JSON.parse(result.stdout);
          assert.equal(value.schemaVersion, 1);
          assert.deepEqual(value[field], field === "agents" ? {} : []);
        } else {
          assert.match(result.stdout, empty);
          assert.match(result.stdout, /Scope|scope/);
          assert.match(result.stdout, /pguide (objectives|agents) set/);
        }
      }
    }
  } finally {
    await f.cleanup();
  }
});

test("Objective summaries, detail, write receipts and distinct lookup errors", async () => {
  const f = await context();
  try {
    const from = join(f.directory, "declaration.json");
    await writeFile(
      from,
      JSON.stringify({
        $schema: declarationSchema,
        objectives: {
          sample: {
            description: "Audit **label** | 中文\nsecond line\u001b[31m",
            objective: "git+https://example.invalid/rules.git#rules/",
            inputSchema: { type: "object", additionalProperties: false },
            subject: '{"text": "```"}',
          },
        },
      }),
    );
    const saved = await f.run(bin("objectives"), [
      "set",
      "sample",
      "--scope",
      "directory",
      "--from",
      from,
    ]);
    assert.equal(saved.code, 0, saved.stdout + saved.stderr);
    assert.match(saved.stdout, /# Objective saved/);
    assert.match(saved.stdout, /Name: `sample`/);
    assert.match(saved.stdout, /Scope: directory/);
    const list = await f.run(top, ["objectives", "list"]);
    assert.equal(list.code, 0, list.stdout + list.stderr);
    assert.match(list.stdout, /Audit \\\*\\\*label\\\*\\\*/);
    assert.match(list.stdout, /中文 second line/);
    assert.equal(list.stdout.includes("\u001b"), false);
    assert.doesNotMatch(list.stdout, /additionalProperties/);
    const detail = await f.run(bin("objectives"), ["show", "sample", "--format", "markdown"]);
    assert.equal(detail.code, 0, detail.stdout + detail.stderr);
    assert.match(detail.stdout, /# Objective `sample`/);
    assert.match(detail.stdout, /## Input schema/);
    assert.match(detail.stdout, /## Subject/);
    assert.match(detail.stdout, /````text/);
    const json = await f.run(bin("objectives"), ["show", "sample", "--format", "json"]);
    assert.equal(JSON.parse(json.stdout).objectives[0].subject, '{"text": "```"}');
    const missing = await f.run(bin("objectives"), ["show", "unknown", "--format", "json"]);
    assert.equal(missing.code, 2);
    assert.match(JSON.parse(missing.stdout).error, /not found.*pguide objectives list/);
    const noName = await f.run(bin("objectives"), ["show", "--format", "json"]);
    assert.equal(noName.code, 2);
    assert.match(JSON.parse(noName.stdout).error, /requires an Objective name/);
    const userSave = await f.run(bin("objectives"), [
      "set",
      "sample",
      "--scope",
      "user",
      "--from",
      from,
      "--format",
      "json",
    ]);
    assert.equal(userSave.code, 0, userSave.stdout + userSave.stderr);
    const ambiguous = await f.run(bin("objectives"), ["show", "sample", "--format", "json"]);
    assert.equal(ambiguous.code, 2);
    assert.match(JSON.parse(ambiguous.stdout).error, /ambiguous: user.*directory.*--scope/);
    const selected = await f.run(bin("objectives"), ["show", "sample", "--scope", "directory"]);
    assert.equal(selected.code, 0);
  } finally {
    await f.cleanup();
  }
});

test("Agent summaries, redacted details and operation receipts retain JSON contracts", async () => {
  const f = await context();
  try {
    const profile = join(f.directory, "profile.json");
    await writeFile(
      profile,
      JSON.stringify({
        type: "acp",
        connection: { protocolVersion: "1" },
        transport: {
          type: "stdio",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          env: ["RESOURCE_TEST_TOKEN"],
        },
      }),
    );
    const saved = await f.run(agents, ["set", "fixture", "--from", profile, "--scope", "project"]);
    assert.equal(saved.code, 0, saved.stdout + saved.stderr);
    assert.match(saved.stdout, /Action: set/);
    assert.match(saved.stdout, /Name: `fixture`/);
    const listed = await f.run(top, ["agents", "list"]);
    assert.equal(listed.code, 0, listed.stdout + listed.stderr);
    assert.match(listed.stdout, /Type: acp/);
    assert.match(listed.stdout, /Scope: project/);
    assert.doesNotMatch(listed.stdout, /process.exit/);
    const shown = await f.run(agents, ["show", "fixture"]);
    assert.match(shown.stdout, /# Agent `fixture`/);
    assert.match(shown.stdout, /## Profile \(redacted\)/);
    assert.match(shown.stdout, /```yaml/);
    const json = await f.run(agents, ["show", "fixture", "--format", "json"]);
    const value = JSON.parse(json.stdout);
    assert.deepEqual(Object.keys(value).sort(), ["name", "profile", "schemaVersion", "source"]);
    assert.equal(value.source.scope, "project");
    const removed = await f.run(agents, ["remove", "fixture", "--scope", "project"]);
    assert.equal(removed.code, 0);
    assert.match(removed.stdout, /# Agent removed/);
    assert.match(removed.stdout, /Action: remove/);
  } finally {
    await f.cleanup();
  }
});

test("config show adds provenance while get and completion scripts remain unadorned", async () => {
  const f = await context();
  try {
    await writeFile(f.configuration, JSON.stringify({ schemaVersion: 2, defaultAgent: "fixture" }));
    const shown = await f.run(config, ["show"]);
    assert.equal(shown.code, 0, shown.stdout + shown.stderr);
    assert.match(shown.stdout, /## Sources/);
    assert.match(shown.stdout, /`defaultAgent`:/);
    assert.match(shown.stdout, /user → nearest project → explicit/);
    const raw = await f.run(config, ["get", "defaultAgent"]);
    assert.equal(raw.stdout, "fixture\n");
    const script = await f.run(top, ["complete", "--shell", "powershell"]);
    const json = await f.run(top, ["complete", "--shell", "powershell", "--format", "json"]);
    assert.equal(script.code, 0);
    assert.equal(script.stdout, `${JSON.parse(json.stdout).script}\n`);
    const help = await f.run(config, ["edit", "--help", "--format", "json"]);
    const metadata = JSON.parse(help.stdout);
    assert.equal(metadata.command, "config");
    assert.equal(metadata.configurationSchemaVersion, 2);
    assert.match(metadata.usage, /config edit/);
    assert.ok(metadata.sections.length > 0);
  } finally {
    await f.cleanup();
  }
});

test("Agent migration receipt identifies names, scope, endpoints and exact backup", async () => {
  const f = await context();
  try {
    const original = JSON.stringify({
      schemaVersion: 2,
      agents: {
        fixture: {
          type: "acp",
          connection: { protocolVersion: "1" },
          transport: { type: "stdio", command: process.execPath },
        },
      },
    });
    await writeFile(f.configuration, original);
    const migrated = await f.run(agents, ["migrate", "--scope", "project"]);
    assert.equal(migrated.code, 0, migrated.stdout + migrated.stderr);
    assert.match(migrated.stdout, /# Agent profiles migrated/);
    assert.match(migrated.stdout, /Names: `fixture`/);
    assert.match(migrated.stdout, /Scope: project/);
    assert.match(migrated.stdout, /Source:/);
    assert.match(migrated.stdout, /Destination:/);
    assert.match(migrated.stdout, /Backup:.*agents-migration/);
    assert.doesNotMatch(await readFile(f.configuration, "utf8"), /"agents"/);
  } finally {
    await f.cleanup();
  }
});

test("config and Agent editors keep chatter off JSON stdout and only report successful saves", async () => {
  const f = await context();
  try {
    const editor = join(f.directory, "editor.cjs");
    await writeFile(editor, 'console.log("editor stdout"); console.error("editor stderr");');
    const editorEnv = { VISUAL: `"${process.execPath}" "${editor}"` };
    for (const [script, scope] of [
      [config, "project"],
      [agents, "project"],
    ] as const) {
      const edited = await f.run(script, ["edit", "--scope", scope, "--format", "json"], editorEnv);
      assert.equal(edited.code, 0, edited.stdout + edited.stderr);
      assert.equal(JSON.parse(edited.stdout).status, script === config ? "updated" : "written");
      assert.match(edited.stderr, /editor stdout/);
      assert.match(edited.stderr, /editor stderr/);
      const human = await f.run(script, ["edit", "--scope", scope], editorEnv);
      assert.equal(human.code, 0);
      assert.match(human.stdout, /# (Configuration|Agent) saved/);
    }
    const before = await readFile(f.configuration, "utf8");
    await writeFile(editor, "process.exit(3);");
    const failed = await f.run(
      config,
      ["edit", "--scope", "project", "--format", "json"],
      editorEnv,
    );
    assert.equal(failed.code, 2);
    assert.match(JSON.parse(failed.stdout).error, /Editor exited 3/);
    assert.equal(await readFile(f.configuration, "utf8"), before);
    assert.doesNotMatch(failed.stdout, /"updated"/);
  } finally {
    await f.cleanup();
  }
});

test("diagnosis exposes command/config paths, conflicts and actual Agent initialization", async () => {
  const f = await context();
  try {
    const normal = await f.run(top, ["diagnose"]);
    assert.equal(normal.code, 0, normal.stdout + normal.stderr);
    assert.match(normal.stdout, /## Configuration/);
    assert.match(normal.stdout, /## Commands/);
    assert.match(normal.stdout, /Source: bundled/);
    assert.match(normal.stdout, /Executable:/);
    assert.match(normal.stdout, /No Agent process was started/);
    const agent = join(f.directory, "agent.cjs");
    await writeFile(
      agent,
      'require("node:readline").createInterface({input:process.stdin}).on("line", line => {const m=JSON.parse(line); if(m.id !== undefined) console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{protocolVersion:1,agentInfo:{name:"resource-fixture",version:"1.0"},token:"synthetic-key-secret",details:{echo:"prefix:"+process.env.RESOURCE_TEST_TOKEN+":suffix"}}}));});',
    );
    await writeFile(
      join(f.cwd, ".pguide", "agents.yaml"),
      JSON.stringify({
        $schema: agentSchema,
        agents: {
          fixture: {
            type: "acp",
            connection: { protocolVersion: "1" },
            transport: {
              type: "stdio",
              command: process.execPath,
              args: [agent],
              env: ["RESOURCE_TEST_TOKEN"],
            },
          },
        },
      }),
    );
    const secretEnv = { RESOURCE_TEST_TOKEN: "synthetic-env-secret" };
    const initialized = await f.run(top, ["diagnose", "agent", "fixture"], secretEnv);
    assert.equal(initialized.code, 0, initialized.stdout + initialized.stderr);
    assert.match(initialized.stdout, /## Agent initialization/);
    assert.match(initialized.stdout, /resource-fixture/);
    assert.match(
      initialized.stdout,
      /Authentication, permissions and actual repair capability were not verified/,
    );
    for (const format of [[], ["--format", "markdown"]]) {
      const human = await f.run(top, ["diagnose", "agent", "fixture", ...format], secretEnv);
      assert.equal(human.code, 0, human.stderr);
      assert.doesNotMatch(human.stdout + human.stderr, /synthetic-(env|key)-secret/);
      assert.match(human.stdout, /"token": "\[REDACTED\]"/);
      assert.match(human.stdout, /prefix:\[REDACTED\]:suffix/);
    }
    const machine = await f.run(
      top,
      ["diagnose", "agent", "fixture", "--format", "json"],
      secretEnv,
    );
    assert.equal(machine.code, 0, machine.stderr);
    const initialize = JSON.parse(machine.stdout).agent.initialize;
    assert.equal(initialize.token, "synthetic-key-secret");
    assert.equal(initialize.details.echo, "prefix:synthetic-env-secret:suffix");
    const directories = [join(f.directory, "first"), join(f.directory, "second")];
    for (const directory of directories) {
      await mkdir(directory);
      await writeFile(
        join(directory, process.platform === "win32" ? "pguide-probe.cmd" : "pguide-probe"),
        "",
        { mode: 0o755 },
      );
    }
    await writeFile(
      f.configuration,
      JSON.stringify({ schemaVersion: 2, commandDirectories: directories }),
    );
    const conflicted = await f.run(top, ["diagnose"]);
    assert.equal(conflicted.code, 2);
    assert.match(conflicted.stdout, /Status: command conflicts found/);
    assert.match(conflicted.stdout, /## Command conflicts/);
    assert.match(conflicted.stdout, /Command: `probe`/);
    assert.match(conflicted.stdout, /first/);
    assert.match(conflicted.stdout, /second/);
    const json = await f.run(top, ["diagnose", "--format", "json"]);
    assert.equal(json.code, 2);
    assert.equal(JSON.parse(json.stdout).conflicts.probe.length, 2);
  } finally {
    await f.cleanup();
  }
});
