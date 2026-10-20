import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  AGENTS_SCHEMA,
  agentsPaths,
  loadAgents,
  loadConfig,
  migrateAgents,
  parseAgents,
  parseConfig,
  withResourceLocks,
  writeAgents,
} from "@potential-guide/cli-core";
import { Ajv2020 } from "ajv/dist/2020.js";
import { stringify } from "yaml";

const root = resolve(import.meta.dirname, "..", "..", "..");
const scratch = join(root, ".cache");
await mkdir(scratch, { recursive: true });
const acp = {
  type: "acp",
  connection: { protocolVersion: "1" },
  transport: { type: "stdio", command: "agent", env: ["AGENT_TOKEN"] },
};
const ahp = {
  type: "ahp",
  connection: { protocolVersion: "1.0.0", agent: "provider" },
  transport: { type: "websocket", url: "wss://example.invalid/agent" },
  authentication: { type: "query-token", parameter: "tkn", tokenEnv: "AHP_TOKEN" },
};
const file = (agents: unknown) => stringify({ $schema: AGENTS_SCHEMA, agents });
async function fixture() {
  const cwd = await mkdtemp(join(scratch, "agents-test-"));
  const home = join(cwd, "home");
  await mkdir(join(cwd, ".pguide"));
  await mkdir(join(home, "pguide"), { recursive: true });
  return { cwd, home };
}
function invoke(cwd: string, home: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(root, "packages", "pguide-agents", "dist", "bin.js"),
        ...args,
        "--cwd",
        cwd,
        "--format",
        "json",
      ],
      {
        cwd,
        env: { ...process.env, APPDATA: home, XDG_CONFIG_HOME: home, ...env },
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => done({ code: code ?? 70, stdout, stderr }));
  });
}
test("Draft2020-12 public schema and offline parser agree on canonical profile structure", async () => {
  const schema = JSON.parse(await readFile(join(root, "schemas", "agents", "v1.json"), "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.ok(schema.$defs);
  assert.equal(schema.definitions, undefined);
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  for (const [profiles, expected] of [
    [{ local: acp, remote: ahp }, true],
    [{}, true],
    [
      { old: { connection: { type: "acp", protocolVersion: "1" }, transport: acp.transport } },
      false,
    ],
    [{ local: { ...acp, connection: { type: "acp", protocolVersion: "1" } } }, false],
    [{ local: { ...acp, extra: true } }, false],
    [{ "bad/name": acp }, false],
    [
      { remote: { ...ahp, transport: { type: "websocket", url: "wss://host/?token=secret" } } },
      false,
    ],
  ] as const) {
    const value = { $schema: AGENTS_SCHEMA, agents: profiles };
    assert.equal(validate(value), expected, JSON.stringify(validate.errors));
    if (expected) assert.doesNotThrow(() => parseAgents(stringify(value)));
    else assert.throws(() => parseAgents(stringify(value)));
  }
});
test("offline resource validation requires canonical profiles and rejects unknown formats and secrets", () => {
  const legacy = { connection: { type: "acp", protocolVersion: "1" }, transport: acp.transport };
  assert.deepEqual(parseAgents(file({ local: acp, remote: ahp })).agents, {
    local: acp,
    remote: ahp,
  });
  for (const source of [
    file({ local: legacy }),
    file([]),
    file({ "bad/name": acp }),
    file({ local: { ...acp, extra: true } }),
    file({ local: { ...acp, transport: { ...acp.transport, args: ["--token=never-print-me"] } } }),
    file({ remote: { ...ahp, transport: { type: "websocket", url: "wss://host/?token=secret" } } }),
    stringify({ $schema: "https://untrusted.invalid/schema.json", agents: {} }),
    `${file({})}agents: {}\n`,
  ])
    assert.throws(() => parseAgents(source));
  assert.throws(() => parseConfig("schemaVersion: 2\nagents: {}\n"), /pguide agents migrate/);
});
test("only user/project resources select whole profiles with provenance, independent of explicit main config", async () => {
  const f = await fixture();
  const old = { APPDATA: process.env.APPDATA, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.APPDATA = f.home;
  process.env.XDG_CONFIG_HOME = f.home;
  try {
    await writeFile(join(f.home, "pguide", "agents.yaml"), file({ shared: ahp, user: acp }));
    const project = join(f.cwd, ".pguide", "agents.yaml");
    await writeFile(project, file({ shared: acp }));
    const child = join(f.cwd, "nested");
    await mkdir(child);
    const explicitDirectory = join(f.cwd, "explicit");
    await mkdir(explicitDirectory);
    const explicit = join(explicitDirectory, "config.yaml");
    await writeFile(explicit, "schemaVersion: 2\ndefaultAgent: shared\n");
    await writeFile(join(explicitDirectory, "agents.yaml"), file({ ignored: acp }));
    const config = await loadConfig(child, explicit);
    assert.equal(config.value.defaultAgent, "shared");
    const loaded = { agents: await loadAgents(child) };
    assert.deepEqual(loaded.agents.agents.shared, acp);
    assert.equal(loaded.agents.agents.shared?.type, "acp");
    assert.equal(loaded.agents.agents.ignored, undefined);
    assert.equal(loaded.agents.agents.constructor, undefined);
    assert.deepEqual(loaded.agents.sources.shared, { scope: "project", path: project });
    assert.equal(loaded.agents.sources.user?.scope, "user");
    assert.deepEqual(await agentsPaths(child), loaded.agents.paths);
    await writeFile(join(f.cwd, ".pguide", "config.yaml"), "schemaVersion: 2\n");
    await mkdir(join(child, ".pguide"));
    await writeFile(join(child, ".pguide", "agents.yaml"), file({ nested: ahp }));
    const sameBoundary = { agents: await loadAgents(child) };
    assert.equal(sameBoundary.agents.paths.project, project);
    assert.equal(sameBoundary.agents.agents.nested, undefined);
    await writeFile(project, file({ shared: { type: "acp", transport: acp.transport } }));
    await assert.rejects(loadAgents(child), /connection/);
  } finally {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    await rm(f.cwd, { recursive: true, force: true });
  }
});
test("validated writes reject malformed files, concurrent snapshots and lock conflicts", async () => {
  const f = await fixture();
  try {
    const path = join(f.cwd, ".pguide", "agents.yaml");
    const before = file({ local: acp });
    await writeFile(path, before);
    await assert.rejects(
      withResourceLocks([path], () => withResourceLocks([path], async () => undefined)),
      /locked/,
    );
    await assert.rejects(
      writeAgents(path, parseAgents(file({ remote: ahp })), "stale"),
      /Concurrent/,
    );
    assert.equal(await readFile(path, "utf8"), before);
    const malformed = "agents: [";
    await writeFile(path, malformed);
    const result = await invoke(f.cwd, f.home, ["remove", "local", "--scope", "project"]);
    assert.equal(result.code, 2, result.stdout);
    assert.equal(await readFile(path, "utf8"), malformed);
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});
test("explicit migration preserves exact evidence, comments and unknown settings without reading compatibility profiles", async () => {
  const f = await fixture();
  try {
    const source = join(f.cwd, ".pguide", "config.yaml");
    const original = `# retained evidence\nschemaVersion: 2\ndefaultAgent: local\nunknown-setting: { nested: 42 }\n${stringify({ agents: { local: { connection: { type: "acp", protocolVersion: "1" }, transport: acp.transport }, remote: ahp } })}`;
    await writeFile(source, original);
    const migration = await migrateAgents(f.cwd, "project");
    assert.equal(await readFile(migration.backup, "utf8"), original);
    const main = await readFile(source, "utf8");
    assert.match(main, /# retained evidence/);
    assert.match(main, /unknown-setting/);
    assert.doesNotMatch(main, /\nagents:/);
    assert.deepEqual(parseAgents(await readFile(migration.destination, "utf8")).agents, {
      local: acp,
      remote: ahp,
    });
    assert.throws(() => parseConfig(main), /unknown-setting/);
    await writeFile(source, original);
    const before = await readFile(migration.destination, "utf8");
    await assert.rejects(migrateAgents(f.cwd, "project"), /conflict/);
    assert.equal(await readFile(source, "utf8"), original);
    assert.equal(await readFile(migration.destination, "utf8"), before);
    await assert.rejects(migrateAgents(f.cwd, "project", join(f.cwd, "elsewhere.yaml")), /beside/);
    assert.ok(!(await readdir(join(f.cwd, ".pguide"))).some((name) => name.endsWith(".lock")));
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});
test("Windows source-write failure rolls migration destination back without changing source", {
  skip: process.platform !== "win32",
}, async () => {
  const f = await fixture();
  const source = join(f.cwd, ".pguide", "config.yaml");
  try {
    const original = stringify({ schemaVersion: 2, defaultAgent: "local", agents: { local: acp } });
    const destination = join(f.cwd, ".pguide", "agents.yaml");
    const before = file({ remote: ahp });
    await writeFile(source, original);
    await writeFile(destination, before);
    await chmod(source, 0o400);
    await assert.rejects(migrateAgents(f.cwd, "project"));
    assert.equal(await readFile(source, "utf8"), original);
    assert.equal(await readFile(destination, "utf8"), before);
    const backups = (await readdir(join(f.cwd, ".pguide"))).filter((name) => name.endsWith(".bak"));
    assert.equal(backups.length, 1);
    assert.equal(await readFile(join(f.cwd, ".pguide", backups[0] as string), "utf8"), original);
  } finally {
    await chmod(source, 0o600).catch(() => undefined);
    await rm(f.cwd, { recursive: true, force: true });
  }
});
test("CLI discovers all operations, enforces scopes and migrates a rejected embedded config", async (t) => {
  const f = await fixture();
  try {
    const profile = join(f.cwd, "profile.yaml");
    await writeFile(profile, stringify(acp));
    for (const args of [["--help"], ["path"], ["validate"], ["list"]]) {
      const result = await invoke(f.cwd, f.home, args);
      assert.equal(result.code, 0, result.stdout + result.stderr);
    }
    assert.equal((await invoke(f.cwd, f.home, ["set", "local", "--from", profile])).code, 2);
    const set = await invoke(f.cwd, f.home, [
      "set",
      "local",
      "--from",
      profile,
      "--scope",
      "project",
    ]);
    assert.equal(set.code, 0, set.stdout);
    const show = await invoke(f.cwd, f.home, ["show", "local"], {
      AGENT_TOKEN: "sensitive-runtime-token",
    });

    await t.test(
      "editor drafts validate before replacement and reject concurrent external edits",
      async () => {
        const f = await fixture();
        try {
          const path = join(f.cwd, ".pguide", "agents.yaml");
          const before = file({ local: acp });
          await writeFile(path, before);
          const editor = join(f.cwd, "editor.mjs");
          await writeFile(
            editor,
            'import{writeFile}from"node:fs/promises";if(process.env.EXTERNAL_EDIT)await writeFile(process.env.EXTERNAL_EDIT,process.env.EXTERNAL_CONTENT);await writeFile(process.argv.at(-1),process.env.EDIT_CONTENT);',
          );
          const env = {
            VISUAL: `"${process.execPath}" "${editor}"`,
            EDIT_CONTENT: file({ remote: ahp }),
          };
          const written = await invoke(f.cwd, f.home, ["edit", "--scope", "project"], env);
          assert.equal(written.code, 0, written.stdout);
          assert.deepEqual(parseAgents(await readFile(path, "utf8")).agents, { remote: ahp });
          const invalid = await invoke(f.cwd, f.home, ["edit", "--scope", "project"], {
            ...env,
            EDIT_CONTENT: "agents: [",
          });
          assert.equal(invalid.code, 2, invalid.stdout);
          const concurrent = await invoke(f.cwd, f.home, ["edit", "--scope", "project"], {
            ...env,
            EXTERNAL_EDIT: path,
            EXTERNAL_CONTENT: before,
          });
          assert.equal(concurrent.code, 2, concurrent.stdout);
          assert.match(concurrent.stdout, /Concurrent/);
          assert.equal(await readFile(path, "utf8"), before);
          assert.deepEqual(await readdir(join(f.cwd, ".pguide")), ["agents.yaml"]);
          for (const args of [
            ["remove", "local", "--scope", "explicit"],
            ["remove", "local", "--scope", "project", "--scope", "user"],
            ["remove", "local", "--scope", "project", "--unknown", "value"],
            ["remove", "local", "extra", "--scope", "project"],
          ]) {
            const rejected = await invoke(f.cwd, f.home, args);
            assert.equal(rejected.code, 2, rejected.stdout);
            assert.equal(await readFile(path, "utf8"), before);
          }
        } finally {
          await rm(f.cwd, { recursive: true, force: true });
        }
      },
    );

    await t.test("packaged offline schema is byte-identical to its public source", async () => {
      assert.equal(
        await readFile(
          new URL(import.meta.resolve("@potential-guide/cli-core/schemas/agents/v1.json")),
          "utf8",
        ),
        await readFile(join(root, "schemas", "agents", "v1.json"), "utf8"),
      );
    });
    assert.equal(show.code, 0, show.stdout);
    assert.doesNotMatch(show.stdout, /sensitive-runtime-token/);
    assert.equal(JSON.parse(show.stdout).source.scope, "project");
    assert.equal((await invoke(f.cwd, f.home, ["remove", "local", "--scope", "user"])).code, 2);
    assert.equal((await invoke(f.cwd, f.home, ["remove", "local", "--scope", "project"])).code, 0);
    const source = join(f.cwd, ".pguide", "config.yaml");
    await writeFile(
      source,
      stringify({ schemaVersion: 2, defaultAgent: "remote", agents: { remote: ahp } }),
    );
    const migrated = await invoke(f.cwd, f.home, ["migrate", "--scope", "project"]);
    assert.equal(migrated.code, 0, migrated.stdout + migrated.stderr);
    assert.equal(
      JSON.parse((await invoke(f.cwd, f.home, ["show", "remote"])).stdout).profile.type,
      "ahp",
    );
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});
