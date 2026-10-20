import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";

const script = resolve(import.meta.dirname, "..", "dist", "bin.js");
const scratch = resolve(import.meta.dirname, "..", "..", "..", ".cache");
await mkdir(scratch, { recursive: true });
const tmpdir = () => scratch;

function run(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: {
        ...env,
        APPDATA:
          env.APPDATA !== process.env.APPDATA ? env.APPDATA : join(scratch, "config-test-user"),
        XDG_CONFIG_HOME:
          env.XDG_CONFIG_HOME !== process.env.XDG_CONFIG_HOME
            ? env.XDG_CONFIG_HOME
            : join(scratch, "config-test-user"),
      },
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolveRun({ code: code ?? 70, stdout }));
  });
}

test("config path is available without creating configuration", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pguide-config-command-"));
  try {
    const result = await run(["path", "--cwd", cwd, "--format", "json"]);
    assert.equal(result.code, 0);
    assert.ok(JSON.parse(result.stdout).paths.user);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("Objective commands persist scoped registrations and reject invalid edits atomically", async () => {
  const cwd = await mkdtemp(join(scratch, "pguide-config-objective-"));
  const env = { ...process.env, APPDATA: cwd, XDG_CONFIG_HOME: cwd };
  const uri = "git+https://example.invalid/repo.git#objective/pilot.yaml";
  const invoke = (args: string[]) => run([...args, "--cwd", cwd, "--format", "json"], env);
  try {
    const help = JSON.parse((await invoke(["--help"])).stdout);
    for (const command of [
      "add-objective",
      "list-objectives",
      "update-objective",
      "remove-objective",
    ])
      assert.ok(help.subcommands.includes(command));
    assert.ok(help.subcommands.every((command: string) => !command.includes("alias")));
    const added = await invoke(["add-objective", "health", uri, "--scope", "user"]);
    assert.equal(added.code, 0, added.stdout);
    const listed = JSON.parse((await invoke(["list-objectives"])).stdout).objectives;
    assert.deepEqual(
      listed.map(({ name, location }: { name: string; location: string }) => ({ name, location })),
      [{ name: "health", location: uri }],
    );
    assert.ok(listed[0].source);
    const local = await invoke(["add-objective", "health", "./pilot.yaml"]);
    assert.equal(local.code, 0, local.stdout);
    const configPath = join(cwd, ".pguide", "config.yaml");
    const before = await readFile(configPath, "utf8");
    for (const args of [
      ["add-objective", "health", uri],
      ["update-objective", "missing", uri],
      ["add-objective", "bad/name", uri],
      ["update-objective", "health", "@other"],
      ["remove-objective", "missing"],
      ["add-objective", "missing"],
    ]) {
      const result = await invoke(args);
      assert.equal(result.code, 2, result.stdout);
      assert.equal(await readFile(configPath, "utf8"), before);
    }
    const shown = JSON.parse((await invoke(["list-objectives"])).stdout).objectives;
    assert.equal(shown[0].location, join(cwd, "pilot.yaml"));
    const updated = await invoke(["update-objective", "health", uri]);
    assert.equal(updated.code, 0, updated.stdout);
    const removed = await invoke(["remove-objective", "health"]);
    assert.equal(removed.code, 0, removed.stdout);
    const inherited = JSON.parse((await invoke(["list-objectives"])).stdout).objectives;
    assert.equal(inherited[0].location, uri);
    assert.equal(inherited[0].source, listed[0].source);
    const removedUser = await invoke(["remove-objective", "health", "--scope", "user"]);
    assert.equal(removedUser.code, 0, removedUser.stdout);
    assert.deepEqual(JSON.parse((await invoke(["list-objectives"])).stdout).objectives, []);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("user config permissions round trip and invalid grants cannot replace the ceiling", async () => {
  const cwd = await mkdtemp(join(scratch, "pguide-config-permissions-"));
  const env = { ...process.env, APPDATA: cwd, XDG_CONFIG_HOME: cwd };
  const permissions = {
    ceiling: [{ id: "edit-result", operation: "edit", resources: [join(cwd, "result")] }],
    grants: ["edit-result"],
  };
  try {
    const configured = await run(
      [
        "set",
        "regulationPermissions",
        JSON.stringify(permissions),
        "--scope",
        "user",
        "--cwd",
        cwd,
        "--format",
        "json",
      ],
      env,
    );
    assert.equal(configured.code, 0, configured.stdout);
    const read = await run(["get", "regulationPermissions", "--cwd", cwd, "--format", "json"], env);
    assert.deepEqual(JSON.parse(read.stdout).value, permissions);
    const invalid = await run(
      [
        "set",
        "regulationPermissions",
        JSON.stringify({ ...permissions, grants: ["unlisted"] }),
        "--scope",
        "user",
        "--cwd",
        cwd,
        "--format",
        "json",
      ],
      env,
    );
    assert.equal(invalid.code, 2, invalid.stdout);
    const unchanged = await run(
      ["get", "regulationPermissions", "--cwd", cwd, "--format", "json"],
      env,
    );
    assert.deepEqual(JSON.parse(unchanged.stdout).value, permissions);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("config exposes schema 2 strategy help and validates strategy edits", async () => {
  const cwd = await mkdtemp(join(scratch, "pguide-config-strategy-"));
  try {
    const help = await run(["--help", "--format", "json"]);
    assert.equal(JSON.parse(help.stdout).configurationSchemaVersion, 2);
    const strategy = {
      quota: { timeoutMs: 20000, maxAgentRuns: 5, maxStallRuns: 2 },
      probe: { timeoutMs: 5000, retry: { maxRetries: 2, delayMs: 10 } },
    };
    const configured = await run([
      "set",
      "regulationStrategy",
      JSON.stringify(strategy),
      "--cwd",
      cwd,
      "--format",
      "json",
    ]);
    assert.equal(configured.code, 0, configured.stdout);
    const read = await run(["get", "regulationStrategy", "--cwd", cwd, "--format", "json"]);
    assert.deepEqual(JSON.parse(read.stdout).value, strategy);
    const invalid = await run([
      "set",
      "regulationStrategy",
      '{"effectTtlMs":0}',
      "--cwd",
      cwd,
      "--format",
      "json",
    ]);
    assert.equal(invalid.code, 2);
    const unchanged = await run(["get", "regulationStrategy", "--cwd", cwd, "--format", "json"]);
    assert.deepEqual(JSON.parse(unchanged.stdout).value, strategy);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("config edit validates a temporary copy before atomically replacing the target", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pguide-config-edit-"));
  try {
    const target = join(cwd, ".pguide", "config.yaml");
    const editor = join(cwd, "editor.mjs");
    await writeFile(
      editor,
      `import{writeFile}from"node:fs/promises";await writeFile(process.argv.at(-1),process.env.EDIT_CONTENT);`,
    );
    const visual = `"${process.execPath}" "${editor}"`;
    const first = await run(["edit", "--cwd", cwd], {
      ...process.env,
      VISUAL: visual,
      EDIT_CONTENT: "schemaVersion: 2\nretentionDays: 7\n",
    });
    assert.equal(first.code, 0, first.stdout);
    assert.match(await readFile(target, "utf8"), /retentionDays: 7/);

    const invalid = await run(["edit", "--cwd", cwd], {
      ...process.env,
      VISUAL: visual,
      EDIT_CONTENT: "schemaVersion: 1\n",
    });
    assert.equal(invalid.code, 2, invalid.stdout);
    assert.match(await readFile(target, "utf8"), /retentionDays: 7/);
    assert.deepEqual((await readdir(join(cwd, ".pguide"))).sort(), ["config.yaml"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("show-agent rejects secret-bearing transport arguments without echoing them", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pguide-config-secret-"));
  try {
    const config = join(cwd, "config.yaml");
    await writeFile(
      config,
      'schemaVersion: 2\nagents:\n  fixture:\n    connection: {type: acp, protocolVersion: "1"}\n    transport: {type: stdio, command: fixture, args: ["--token=do-not-print"]}\n',
    );
    const result = await run(["show-agent", "fixture", "--config", config, "--format", "json"]);
    assert.equal(result.code, 2);
    assert.doesNotMatch(result.stdout, /do-not-print/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("config editor and Agent commands normalize legacy ACP and preserve AHP profiles", async () => {
  const cwd = await mkdtemp(join(scratch, "pguide-config-ahp-"));
  try {
    const editor = join(cwd, "editor.mjs");
    await writeFile(
      editor,
      'import{writeFile}from"node:fs/promises";await writeFile(process.argv.at(-1),process.env.EDIT_CONTENT);',
    );
    const ahp = {
      type: "ahp",
      confirmations: "external",
      connection: { protocolVersion: "1.0.0", agent: "generic-provider" },
      transport: { type: "websocket", url: "wss://host.example.invalid/ahp" },
      authentication: { type: "query-token", parameter: "tkn", tokenEnv: "AHP_TOKEN" },
    };
    const edited = await run(["edit", "--cwd", cwd], {
      ...process.env,
      VISUAL: `"${process.execPath}" "${editor}"`,
      EDIT_CONTENT: JSON.stringify({
        schemaVersion: 2,
        agents: {
          legacy: {
            connection: { type: "acp", protocolVersion: "1" },
            transport: { type: "stdio", command: "fixture" },
          },
          remote: ahp,
        },
      }),
    });
    assert.equal(edited.code, 0, edited.stdout);
    const list = await run(["list-agents", "--cwd", cwd, "--format", "json"]);
    assert.deepEqual(
      JSON.parse(list.stdout)
        .agents.filter(({ name }: { name: string }) => ["legacy", "remote"].includes(name))
        .map(({ type }: { type: string }) => type),
      ["acp", "ahp"],
    );
    const shown = await run(["show-agent", "remote", "--cwd", cwd, "--format", "json"]);
    assert.deepEqual(JSON.parse(shown.stdout).profile, ahp);
    const legacy = await run(["show-agent", "legacy", "--cwd", cwd, "--format", "json"]);
    assert.equal(JSON.parse(legacy.stdout).profile.type, "acp");
    assert.equal(JSON.parse(legacy.stdout).profile.connection.type, undefined);
    const source = join(cwd, "profile.json");
    await writeFile(source, JSON.stringify(ahp));
    assert.equal((await run(["add-agent", "added", source, "--cwd", cwd])).code, 0);
    const updated = { ...ahp, connection: { ...ahp.connection, agent: "another-provider" } };
    await writeFile(source, JSON.stringify(updated));
    assert.equal((await run(["update-agent", "added", source, "--cwd", cwd])).code, 0);
    const actual = await run(["show-agent", "added", "--cwd", cwd, "--format", "json"]);
    assert.deepEqual(JSON.parse(actual.stdout).profile, updated);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
