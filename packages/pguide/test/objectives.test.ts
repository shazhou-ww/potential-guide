import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { extractGlobals } from "@potential-guide/cli-core";
import {
  bindObjective,
  listObjectives,
  type ObjectiveDeclaration,
  objectiveContext,
  parseObjectives,
  selectObjective,
} from "../../objective-declarations/src/index.js";
import { fixture as pilotFixture } from "../../objective-pilot/test/fixtures.js";
import {
  OBJECTIVES_SCHEMA_URI,
  parseStrictYaml,
  validateObjectivesDocument,
} from "../../pilot-protocol/src/index.js";
import { bin, fixture, git, run, writeConfig } from "./fixtures.js";

const unit = { type: "object", additionalProperties: false, maxProperties: 0 } as const;
const declaration: ObjectiveDeclaration = {
  description: "显式绑定",
  objective: "git+https://unreachable.invalid/rules.git#rules/",
  inputSchema: unit,
  subject: '{"name": $pathJoin(context.repo.rootPath, context.path)}',
};
const document = (entry: ObjectiveDeclaration = declaration) =>
  JSON.stringify({
    $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objectives/v1.json",
    objectives: { check: entry },
  });

test("strict declarations reject governance fields, legacy wrappers, aliases and ambiguous YAML", () => {
  for (const entry of [
    { ...declaration, target: "terminal" },
    { ...declaration, subject: { jsonata: "{}" } },
    { ...declaration, objective: "git+https://example.test/repo.git#rules/objective.yaml" },
    { ...declaration, objective: ".\\rules\\objective.yaml" },
  ])
    assert.throws(() => parseObjectives(document(entry as ObjectiveDeclaration)));
  assert.throws(() => parseObjectives("schemaVersion: 1\nschemaVersion: 1\nobjectives: {}\n"));
  assert.throws(() => parseObjectives("schemaVersion: 1\nobjectives: &x {check: *x}\n"));
  assert.equal(parseObjectives(document()).check?.subject, declaration.subject);
});

test("Unit is unique {}, optional-object is not Unit, and both schema boundaries are enforced", async () => {
  const spec = await pilotFixture().load();
  const context = { repo: { rootPath: "checkout", origin: null }, path: "." };
  assert.deepEqual(bindObjective(declaration, context, undefined, spec), { name: "checkout" });
  assert.deepEqual(
    bindObjective({ ...declaration, inputSchema: { const: {} } }, context, undefined, spec),
    { name: "checkout" },
  );
  assert.deepEqual(
    bindObjective(
      { ...declaration, inputSchema: { type: "object", additionalProperties: false } },
      context,
      undefined,
      spec,
    ),
    { name: "checkout" },
  );
  assert.deepEqual(
    bindObjective({ ...declaration, inputSchema: { type: "null" } }, context, null, spec),
    { name: "checkout" },
  );
  assert.throws(() => bindObjective(declaration, context, { extra: true }, spec), /input/);
  const optional = {
    ...declaration,
    inputSchema: { type: "object", properties: { name: { type: "string" } } },
  };
  assert.throws(() => bindObjective(optional, context, undefined, spec), /Only Unit/);
  assert.throws(
    () => bindObjective({ ...declaration, subject: '{"name": 4}' }, context, {}, spec),
    /projected subject/,
  );
  assert.throws(
    () => bindObjective({ ...declaration, subject: "context.repository.id" }, context, {}, spec),
    /Missing projection/,
  );
  assert.throws(
    () => bindObjective({ ...declaration, subject: "$eval('1')" }, context, {}, spec),
    /projection|JSONata/,
  );
  for (const [inputSchema, input] of [
    [{ type: "string" }, "value"],
    [{ type: "integer", minimum: 1 }, 2],
    [{ type: "array", items: { type: "string" } }, ["a"]],
  ] as const) {
    assert.deepEqual(
      bindObjective(
        { ...declaration, inputSchema, subject: '{"name": "valid"}' },
        context,
        input,
        spec,
      ),
      { name: "valid" },
    );
  }
  assert.throws(
    () => bindObjective({ ...declaration, inputSchema: { type: "integer" } }, context, "1", spec),
    /input/,
  );
});

test("user and directory input types are orthogonal, source provenance and name ambiguity are explicit", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  const previous = { APPDATA: process.env.APPDATA, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  const user = join(f.directory, "user");
  try {
    process.env.APPDATA = user;
    process.env.XDG_CONFIG_HOME = user;
    await mkdir(join(user, "pguide"), { recursive: true });
    const parameterized = {
      ...declaration,
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
        additionalProperties: false,
      },
      subject: '{"name": input.name}',
    };
    const userFile = join(user, "pguide", "objectives.yaml");
    const localFile = join(f.repository, "objectives.yaml");
    await writeFile(userFile, document(declaration));
    await writeFile(localFile, document(parameterized));
    const globals = extractGlobals(["--cwd", f.repository]).options;
    const config = { schemaVersion: 2 as const };
    assert.equal((await listObjectives(f.repository)).length, 2);
    await assert.rejects(selectObjective(["--objective", "check"], globals, config), /Ambiguous/);
    const spec = await pilotFixture().load();
    const userSelection = await selectObjective(
      ["--objective", "check", "--scope", "user"],
      globals,
      config,
    );
    assert.deepEqual(await userSelection.subject(spec), { name: f.repository });
    const directorySelection = await selectObjective(
      ["--objective", "check", "--scope", "directory"],
      globals,
      config,
    );
    await assert.rejects(directorySelection.subject(spec), /input is required/);
    await writeFile(userFile, document(parameterized));
    await writeFile(localFile, document(declaration));
    const input = join(f.directory, "input.json");
    await writeFile(input, '{"name":"explicit"}');
    const required = await selectObjective(
      ["--objective", "check", "--scope", "user", "--input-file", input],
      globals,
      config,
    );
    assert.deepEqual(await required.subject(spec), { name: "explicit" });
    const local = await selectObjective(
      ["--objective", "check", "--scope", "directory"],
      globals,
      config,
    );
    assert.deepEqual(await local.subject(spec), { name: f.repository });
    assert.equal(required.binding?.entry.file, userFile);
    assert.equal(local.binding?.entry.file, localFile);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Unit inference is conservative about expandable schemas and validates the empty value", async () => {
  const spec = await pilotFixture().load();
  const context = { repo: { rootPath: "checkout", origin: null }, path: "." };
  const expandable = [
    {
      type: "object",
      additionalProperties: false,
      patternProperties: { "^x": { type: "string" } },
    },
    { type: "object", additionalProperties: false, properties: { x: { type: "string" } } },
    {
      type: "object",
      unevaluatedProperties: false,
      allOf: [{ properties: { x: { type: "string" } } }],
    },
    { enum: [{}, { x: "value" }] },
  ] as const;
  for (const inputSchema of expandable) {
    const entry = { ...declaration, inputSchema };
    assert.deepEqual(bindObjective(entry, context, {}, spec), { name: "checkout" });
    assert.deepEqual(bindObjective(entry, context, { x: "value" }, spec), { name: "checkout" });
    assert.throws(() => bindObjective(entry, context, undefined, spec), /Only Unit/);
  }
  for (const inputSchema of [
    { type: "object", additionalProperties: false, patternProperties: {} },
    { type: "object", maxProperties: 0, patternProperties: { "^x": { type: "string" } } },
    { type: "object", const: {}, patternProperties: { "^x": { type: "string" } } },
    { type: "object", additionalProperties: true, enum: [{}] },
    { const: {}, enum: [{}, { x: "value" }] },
  ] as const) {
    assert.deepEqual(bindObjective({ ...declaration, inputSchema }, context, undefined, spec), {
      name: "checkout",
    });
    assert.throws(
      () => bindObjective({ ...declaration, inputSchema }, context, { x: "value" }, spec),
      /Invalid Objective input/,
    );
  }
  for (const inputSchema of [
    { type: "object", maxProperties: 0, minProperties: 1 },
    { type: "object", const: {}, required: ["x"], properties: { x: { type: "string" } } },
    { type: "object", enum: [{}], minProperties: 1 },
    { const: { x: "value" }, enum: [{}] },
  ] as const) {
    assert.throws(
      () => bindObjective({ ...declaration, inputSchema }, context, undefined, spec),
      /Only Unit/,
    );
    assert.throws(
      () => bindObjective({ ...declaration, inputSchema }, context, {}, spec),
      /Invalid Objective input/,
    );
  }
});

test("discovery is exact-directory, technology independent and never evaluates or resolves remote sources", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  const subdirectory = join(f.repository, "plain");
  await mkdir(subdirectory);
  await writeFile(
    join(f.repository, "objectives.yaml"),
    document({ ...declaration, subject: "context.directory.notYetKnown" }),
  );
  assert.equal((await listObjectives(f.repository, "directory")).length, 1);
  assert.deepEqual(await listObjectives(subdirectory, "directory"), []);
  await writeFile(
    join(subdirectory, "objectives.yaml"),
    document({ ...declaration, description: "普通目录的独立目标" }),
  );
  const subentries = await listObjectives(subdirectory, "directory");
  assert.equal(subentries.length, 1);
  assert.equal(subentries[0]?.description, "普通目录的独立目标");
  assert.equal(subentries[0]?.file, join(subdirectory, "objectives.yaml"));
  const listed = await run(bin("objectives"), [
    "list",
    "--scope",
    "directory",
    "--cwd",
    f.repository,
    "--format",
    "json",
  ]);
  assert.equal(listed.code, 0, listed.stdout + listed.stderr);
  const entry = JSON.parse(listed.stdout).objectives[0];
  assert.equal(entry.objective, declaration.objective);
  assert.equal(entry.file, join(f.repository, "objectives.yaml"));
  assert.match(entry.revision, /^[a-f0-9]{64}$/);
  assert.equal(entry.scope, "directory");
  assert.equal(JSON.parse(listed.stdout).objectives.length, 1);
});

test("list and show identify discovery responses separately from declaration documents", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  const file = join(f.repository, "objectives.yaml");
  await writeFile(file, document());
  const config = join(f.directory, "aliases.json");
  await writeFile(
    config,
    JSON.stringify({ schemaVersion: 2, objectives: { old: declaration.objective } }),
  );
  for (const command of [["list"], ["show", "check"]]) {
    const result = await run(bin("objectives"), [
      ...command,
      "--scope",
      "directory",
      "--cwd",
      f.repository,
      "--fixture-config",
      config,
      "--format",
      "json",
    ]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const { schemaVersion, ...response } = JSON.parse(result.stdout);
    assert.equal(schemaVersion, 1);
    assert.equal(Object.hasOwn(response, "$schema"), false);
    assert.equal(Array.isArray(response.objectives), true);
    assert.equal(response.objectives[0].name, "check");
    assert.deepEqual(response.legacyAliases, [
      {
        name: "old",
        objective: declaration.objective,
        semantics: "legacy-source-alias",
        file: join(f.repository, ".pguide", "config.jsonc"),
      },
    ]);
    assert.equal(
      validateObjectivesDocument({ $schema: OBJECTIVES_SCHEMA_URI, ...response }),
      false,
    );
  }
  assert.equal(validateObjectivesDocument(parseStrictYaml(await readFile(file, "utf8"))), true);
});

test("context exposes only repo root/origin and repo-relative path across worktrees and non-Git directories", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  await writeFile(join(f.repository, "objectives.yaml"), document());
  await f.commit();
  const checkout = join(f.directory, "another-checkout");
  await git(f.repository, "worktree", "add", "--detach", checkout);
  const one = await objectiveContext(f.repository);
  const two = await objectiveContext(checkout);
  assert.equal(one.repo?.origin, two.repo?.origin);
  assert.equal(one.repo?.rootPath, f.repository);
  assert.equal(two.repo?.rootPath, checkout);
  assert.equal(one.path, ".");
  assert.equal(two.path, ".");
  const nested = join(f.repository, "plain", "nested");
  await mkdir(nested, { recursive: true });
  assert.equal((await objectiveContext(nested)).path, "plain/nested");
  assert.notDeepEqual(
    (await listObjectives(f.repository, "directory"))[0]?.file,
    (await listObjectives(checkout, "directory"))[0]?.file,
  );
  assert.deepEqual(Object.keys(one).sort(), ["path", "repo"]);
  assert.deepEqual(Object.keys(one.repo ?? {}).sort(), ["origin", "rootPath"]);
  const plain = join(f.directory, "plain");
  await mkdir(plain);
  const ceiling = process.env.GIT_CEILING_DIRECTORIES;
  try {
    process.env.GIT_CEILING_DIRECTORIES = f.directory;
    assert.deepEqual(await objectiveContext(plain), { repo: null, path: plain });
  } finally {
    if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = ceiling;
  }
});

test("context recognizes absent origin but explicitly rejects malformed and non-URL origins", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  await git(f.repository, "remote", "remove", "origin");
  assert.deepEqual((await objectiveContext(f.repository)).repo, {
    rootPath: f.repository,
    origin: null,
  });
  await git(f.repository, "remote", "add", "origin", "git@example.invalid:team/repo.git");
  for (const origin of [
    "",
    "git@example.invalid:team/repo.git",
    "not-a-url",
    "https://name:secret@example.invalid/repo.git",
    "https://example.invalid/repo.git?token=secret",
  ]) {
    await git(f.repository, "remote", "set-url", "origin", origin);
    await assert.rejects(objectiveContext(f.repository), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { status?: string }).status, "context-error");
      assert.match(error.message, /origin|SCP-like/);
      assert.ok(!error.message.includes("secret"));
      return true;
    });
  }
  await writeFile(join(f.repository, "objectives.yaml"), document());
  const invalid = await run(bin("probe"), [
    "--objective",
    "check",
    "--scope",
    "directory",
    "--cwd",
    f.repository,
    "--format",
    "json",
  ]);
  assert.equal(invalid.code, 2, invalid.stdout + invalid.stderr);
  assert.equal(JSON.parse(invalid.stdout).status, "context-error");
  assert.ok(!invalid.stdout.includes("secret"));
});

test("Git operational failures and corrupt metadata never become successful fallback context", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  const fault = (code: string | number | null, stderr = "", extra = {}) =>
    Object.assign(new Error("simulated Git fault"), { code, stdout: "", stderr, ...extra });
  for (const error of [
    fault("ENOENT"),
    fault("EACCES"),
    fault("ETIMEDOUT"),
    fault(null, "", { killed: true }),
    fault(128, "fatal: bad config line 1"),
    fault(128, "fatal: detected dubious ownership"),
  ]) {
    await assert.rejects(
      objectiveContext(f.repository, async () => {
        throw error;
      }),
      { exitCode: 2, status: "context-error" },
    );
  }
  const answers = async (args: readonly string[]) => {
    if (args.includes("--show-toplevel")) return `${f.repository}\n`;
    if (args.includes("--git-common-dir")) return `${join(f.repository, ".git")}\n`;
    throw fault(1, "error: permission denied while reading config");
  };
  await assert.rejects(objectiveContext(f.repository, answers), {
    exitCode: 2,
    status: "context-error",
  });
  for (const stdout of ["", "relative-root\n", `${f.repository}\nextra\n`])
    await assert.rejects(
      objectiveContext(f.repository, async () => stdout),
      { exitCode: 2, status: "context-error" },
    );
  await assert.rejects(
    objectiveContext(f.repository, async () => {
      throw fault(128, "fatal: not a git repository (or any of the parent directories): .git\n");
    }),
    /repository metadata/,
  );
  const broken = join(f.directory, "broken");
  await mkdir(broken);
  await writeFile(join(broken, ".git"), "not a gitfile\n");
  await assert.rejects(objectiveContext(broken), { exitCode: 2, status: "context-error" });
  const plain = join(f.directory, "plain");
  await mkdir(plain);
  const ceiling = process.env.GIT_CEILING_DIRECTORIES;
  try {
    process.env.GIT_CEILING_DIRECTORIES = f.directory;
    const context = await objectiveContext(plain, async () => {
      throw fault(
        128,
        `fatal: not a git repository (or any parent up to mount point ${dirname(f.directory)})\nStopping at filesystem boundary (GIT_DISCOVERY_ACROSS_FILESYSTEM not set).\n`,
      );
    });
    assert.equal(context.repo, null);
    assert.equal(context.path, plain);
  } finally {
    if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = ceiling;
  }
});

test("declaration probe and direct probe agree; declaration mutation does not redirect continue", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  const selected: ObjectiveDeclaration = {
    ...declaration,
    objective: "./objective",
    subject: "{}",
  };
  await writeFile(join(f.repository, "objectives.yaml"), document(selected));
  const commit = await f.commit();
  const args = ["--cwd", f.repository, "--format", "json", "--no-reports"];
  const selectedProbe = await run(bin("probe"), [
    "--objective",
    "check",
    "--scope",
    "directory",
    ...args,
  ]);
  const direct = await run(bin("probe"), ["--pilot", f.uri, "--subject-file", f.subject, ...args]);
  assert.equal(selectedProbe.code, 0, selectedProbe.stdout + selectedProbe.stderr);
  assert.equal(direct.code, 0, direct.stdout + direct.stderr);
  assert.deepEqual(
    JSON.parse(selectedProbe.stdout).payload.versions,
    JSON.parse(direct.stdout).payload.versions,
  );
  for (const extra of [
    ["--pilot", f.uri],
    ["--subject-file", f.subject],
  ]) {
    const result = await run(bin("probe"), ["--objective", "check", ...extra, ...args]);
    assert.equal(result.code, 2, result.stdout);
    assert.match(result.stdout, /mutually exclusive/);
  }
  const input = join(f.directory, "input.json");
  await writeFile(input, '{"extra":true}');
  const invalid = await run(bin("probe"), ["--objective", "check", "--input-file", input, ...args]);
  assert.equal(invalid.code, 2, invalid.stdout);
  const config = join(f.directory, "config.json");
  const state = join(f.directory, "state");
  await writeFile(
    join(f.repository, ".git", "info", "exclude"),
    ".pguide/agents.yaml\n.pguide/config.jsonc\n",
  );
  await writeConfig(
    config,
    JSON.stringify({
      schemaVersion: 2,
      stateDirectory: state,
      defaultAgent: "forbidden",
      agents: {
        forbidden: {
          connection: { type: "acp", protocolVersion: "1" },
          transport: { type: "stdio", command: process.execPath, args: ["-e", "process.exit(99)"] },
        },
      },
    }),
    f.repository,
  );
  const regulated = await run(bin("regulate"), [
    "--objective",
    "check",
    "--scope",
    "directory",
    "--target",
    "terminal",
    "--fixture-config",
    config,
    "--cwd",
    f.repository,
    "--format",
    "json",
  ]);
  assert.equal(regulated.code, 0, regulated.stdout + regulated.stderr);
  const id = JSON.parse(regulated.stdout).regulationId;
  const saved = JSON.parse(
    await readFile(join(state, "regulations", id, "regulation.json"), "utf8"),
  );
  assert.equal(saved.objectiveCommit, commit);
  assert.equal(saved.objectiveTree, await git(f.repository, "rev-parse", `${commit}:objective`));
  assert.equal(saved.binding.entry.name, "check");
  await writeFile(join(f.repository, "objectives.yaml"), document());
  await f.commit();
  const continued = await run(bin("continue"), [
    id,
    "--fixture-config",
    config,
    "--cwd",
    f.repository,
    "--format",
    "json",
  ]);
  assert.equal(continued.code, 0, continued.stdout + continued.stderr);
  assert.equal(
    JSON.parse(continued.stdout).outcome.latestObservation.payload.current.objectiveId,
    f.uri,
  );
});

test("management requires scope, atomically validates, and migration preserves unrelated registrations", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  const from = join(f.directory, "entry.yaml");
  const legacy = join(f.directory, "legacy.json");
  await writeFile(from, document());
  await writeFile(
    legacy,
    JSON.stringify({
      schemaVersion: 2,
      objectives: { check: ".\\old\\objective.yaml", keep: ".\\keep" },
    }),
  );
  const invoke = (args: string[]) =>
    run(bin("objectives"), [...args, "--cwd", f.directory, "--format", "json"]);
  assert.equal((await invoke(["set", "check", "--from", from])).code, 2);
  const migrated = await invoke([
    "migrate",
    "check",
    "--scope",
    "directory",
    "--from",
    from,
    "--legacy-config",
    legacy,
  ]);
  assert.equal(migrated.code, 0, migrated.stdout + migrated.stderr);
  assert.deepEqual(JSON.parse(await readFile(legacy, "utf8")).objectives, { keep: ".\\keep" });
  const file = join(f.directory, "objectives.yaml");
  const before = await readFile(file, "utf8");
  await writeFile(from, document({ ...declaration, target: "terminal" } as ObjectiveDeclaration));
  assert.equal((await invoke(["set", "check", "--scope", "directory", "--from", from])).code, 2);
  assert.equal(await readFile(file, "utf8"), before);
  assert.equal((await invoke(["remove", "check", "--scope", "directory"])).code, 0);
  assert.deepEqual(await listObjectives(f.directory, "directory"), []);
  assert.equal(dirname(file), f.directory);
});

test("continue restores cross-repository dependency snapshots while a new binding follows the source", async (t) => {
  const parent = await fixture();
  const child = await fixture();
  t.after(() =>
    Promise.all(
      [parent.directory, child.directory].map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    ),
  );
  const childScript = join(child.repository, "objective", "checks", "ready", "run.js");
  await writeFile(
    childScript,
    '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({status:200,message:"",payload:{ok:false,problems:[{kind:"internal",id:"not-ready",parameters:{}}]}}));\n',
  );
  const childCommit = await child.commit();
  await writeFile(
    join(parent.repository, "objective", "checks", "ready", "run.js"),
    `#!/usr/bin/env node
void (async () => {
  const { createSourceObjectiveDependencyProbe } = await import("@potential-guide/objective-pilot");
  let input = ""; for await (const chunk of process.stdin) input += chunk;
  const probe = createSourceObjectiveDependencyProbe({ objectiveId: ${JSON.stringify(child.uri)}, expectedLevelId: "terminal" });
  process.stdout.write(JSON.stringify(await probe(JSON.parse(input), new AbortController().signal)));
})();
`,
  );
  await parent.commit();
  const state = join(parent.directory, "state");
  const config = join(parent.directory, "config.json");
  await writeConfig(
    config,
    JSON.stringify({
      schemaVersion: 2,
      stateDirectory: state,
      defaultAgent: "unused",
      agents: {
        unused: {
          connection: { type: "acp", protocolVersion: "1" },
          transport: { type: "stdio", command: process.execPath, args: ["-e", "process.exit(99)"] },
        },
      },
    }),
  );
  const args = [
    "--pilot",
    parent.uri,
    "--subject-file",
    parent.subject,
    "--target",
    "terminal",
    "--fixture-config",
    config,
    "--format",
    "json",
  ];
  const first = await run(bin("regulate"), args);
  assert.equal(first.code, 3, first.stdout + first.stderr);
  const firstReport = JSON.parse(first.stdout);
  const saved = JSON.parse(
    await readFile(join(state, "regulations", firstReport.regulationId, "regulation.json"), "utf8"),
  );
  assert.equal(saved.sourceBindings[child.uri].commit, childCommit);
  await writeFile(
    childScript,
    '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({status:200,message:"",payload:{ok:true,problems:[]}}));\n',
  );
  const updated = await child.commit();
  assert.notEqual(updated, childCommit);
  const resumed = await run(bin("continue"), [
    firstReport.regulationId,
    "--fixture-config",
    config,
    "--format",
    "json",
  ]);
  assert.equal(resumed.code, 3, resumed.stdout + resumed.stderr);
  assert.equal(
    JSON.parse(resumed.stdout).outcome.latestObservation.payload.sources[child.uri].commit,
    childCommit,
  );
  const fresh = await run(bin("regulate"), args);
  assert.equal(fresh.code, 0, fresh.stdout + fresh.stderr);
  assert.equal(
    JSON.parse(fresh.stdout).outcome.latestObservation.payload.sources[child.uri].commit,
    updated,
  );
});
