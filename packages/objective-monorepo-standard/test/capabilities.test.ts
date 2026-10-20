import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Contract, Delivery, Workspace } from "../src/contract.js";
import { checkBrowserConfiguration } from "../src/delivery-browser.js";
import { checkIdentityPreparation } from "../src/delivery-identity.js";
import { checkMigrationPreparation } from "../src/delivery-migrations.js";
import { checkDeliveryOutput } from "../src/delivery-output.js";
import { checkServiceReferences } from "../src/delivery-services.js";
import { checkWorkerConfiguration } from "../src/delivery-worker.js";
import { checkFileAssignments, checkFileClassification } from "../src/file-placement.js";
import { checkRepositoryConfiguration } from "../src/repository-configuration.js";
import { observeRepository } from "../src/repository-observation.js";
import { type Add, type Finding, type ReportPut, Snapshot } from "../src/shared.js";
import { checkSourceImport } from "../src/source-boundaries.js";
import { observeSourceImports } from "../src/source-observation.js";
import { checkWorkspaceLayout } from "../src/workspace-layout.js";

function workspace(): Workspace {
  return {
    name: "shared",
    path: "packages/shared",
    roles: ["internal"],
    runtime: "universal",
    allows: [],
    entries: ["src/index.ts"],
    sources: ["src/index.ts"],
    tasks: ["build"],
  };
}
function contract(owner = workspace()): Contract {
  return {
    schemaVersion: 1,
    policy: {
      source: "pnpm-default-v1",
      directories: { apps: "apps", packages: "packages", docs: "docs", scripts: "scripts" },
      requiredFiles: [],
      exceptions: [],
      assignments: [],
      allowedDirectories: [],
      dependencyExceptions: [],
    },
    workspaces: [owner],
    deliveries: [],
  };
}
function delivery(): Delivery {
  return {
    id: "site",
    purpose: "Unit preparation",
    kind: "browser",
    runtime: "browser",
    packages: ["site"],
    entry: { package: "site", path: "src/main.ts" },
    config: "apps/site/deploy.json",
    environment: "test",
    output: "apps/site/dist",
    resources: [],
    services: [],
    capabilities: [],
    independent: false,
  };
}
function recorder() {
  const findings: Finding[] = [];
  const add: Add = (
    layer,
    state,
    rule,
    location,
    evidence,
    remedy,
    packages = [],
    requirements = [],
    targetDirectory,
  ) => {
    findings.push({
      layer,
      state,
      rule,
      location,
      evidence,
      remedy,
      packages,
      requirements,
      ...(targetDirectory === undefined ? {} : { targetDirectory }),
    });
  };
  const put: ReportPut = (state, rule, evidence, remedy = "", location = "") =>
    add(2, state, rule, location, evidence, remedy);
  return { findings, add, put };
}

test("repository facts are parsed once and configuration rules can reuse them without layout or task checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "monorepo-facts-"));
  try {
    await mkdir(join(root, "packages", "shared"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"name":"fixture","private":true}');
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages: [packages/*]");
    await writeFile(join(root, "turbo.json"), '{"tasks":{}}');
    await writeFile(
      join(root, "packages", "shared", "package.json"),
      '{"name":"shared","private":true}',
    );
    const facts = await observeRepository(new Snapshot(root));
    assert.equal(facts.failure, undefined);
    assert.equal(facts.manifests.size, 1);
    const valid = recorder();
    checkRepositoryConfiguration(facts, contract(), valid.add);
    assert.deepEqual(
      valid.findings.map(({ rule }) => rule),
      ["global-config"],
    );
    const missing = recorder();
    checkRepositoryConfiguration(facts, { ...contract(), workspaces: [] }, missing.add);
    assert.ok(missing.findings.some(({ rule }) => rule === "workspace-coverage"));
    assert.ok(!missing.findings.some(({ rule }) => ["required-file", "task-graph"].includes(rule)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace layout runs on an isolated package without loading workspace, deliveries or package tasks", async () => {
  const root = await mkdtemp(join(tmpdir(), "monorepo-layout-"));
  try {
    const owner = { ...workspace(), path: "apps/shared" };
    await mkdir(join(root, owner.path, "src"), { recursive: true });
    await writeFile(join(root, owner.path, "README.md"), "# Shared");
    await writeFile(join(root, owner.path, "src", "index.ts"), "export {};");
    const result = recorder();
    await checkWorkspaceLayout(new Snapshot(root), contract(owner), owner, result.add);
    assert.deepEqual(
      result.findings.map(({ rule }) => rule),
      ["layout-package-role"],
    );
    assert.equal(result.findings[0]?.state, "fail");
    assert.equal(result.findings[0]?.targetDirectory, "packages");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file placement and classification consume supplied facts and preserve collision evidence", () => {
  const requirements = contract();
  requirements.policy.assignments = [
    { path: "notes.md", purpose: "project-doc", reason: "Project guidance" },
  ];
  const placement = recorder();
  checkFileAssignments(
    requirements,
    "requirements.json",
    ["notes.md", "docs/notes.md"],
    new Map(),
    placement.add,
  );
  assert.equal(placement.findings[0]?.rule, "file-responsibility");
  assert.match(placement.findings[0]?.evidence ?? "", /Target already exists/);
  const classification = recorder();
  checkFileClassification(
    requirements,
    "requirements.json",
    ["docs/notes.md", "unknown.bin"],
    classification.add,
  );
  assert.deepEqual(
    classification.findings.map(({ location }) => location),
    ["unknown.bin"],
  );
});

test("browser adapter does not evaluate Worker metadata or service and identity requirements", () => {
  const result = recorder();
  const owner = { ...workspace(), name: "site", path: "apps/site" };
  checkBrowserConfiguration(
    {
      entry: "apps/site/src/main.ts",
      environment: "wrong",
      outputDirectory: "apps/site/dist",
    },
    delivery(),
    owner,
    result.put,
  );
  assert.deepEqual(
    result.findings.map(({ rule }) => rule),
    ["browser-deployment"],
  );
});

test("delivery output coverage compares the actual output path with build patterns", async () => {
  const root = await mkdtemp(join(tmpdir(), "monorepo-output-"));
  try {
    const owner = { ...workspace(), name: "site", path: "apps/site" };
    const result = recorder();
    await checkDeliveryOutput(
      new Snapshot(root),
      "apps/site/dist",
      owner,
      { build: { outputs: ["dist/**"] } },
      result.put,
    );
    assert.deepEqual(
      result.findings.map(({ rule, state }) => ({ rule, state })),
      [{ rule: "delivery-artifact", state: "unverified" }],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Worker metadata, variables and bindings remain independent of browser configuration", () => {
  const target: Delivery = {
    ...delivery(),
    kind: "cloudflare-worker",
    runtime: "worker",
    entry: { package: "site", path: "src/worker.ts" },
    resources: [
      {
        name: "DB",
        kind: "resource",
        supply: "platform",
        visibility: "server",
        environment: "test",
      },
    ],
  };
  const owner = { ...workspace(), name: "site", path: "apps/site" };
  const result = recorder();
  const environment = checkWorkerConfiguration(
    {
      main: "src/worker.ts",
      name: "site",
      compatibility_date: "2026-10-19",
      env: { test: {} },
    },
    target,
    owner,
    tmpdir(),
    "apps/site/wrangler.json",
    "test",
    result.put,
  );
  assert.deepEqual(environment, {});
  assert.deepEqual(
    result.findings.map(({ rule }) => rule),
    ["worker-binding"],
  );
});

test("service environment, identity supply and migration entry are separately callable checks", () => {
  const service: Workspace = {
    ...workspace(),
    name: "api",
    roles: ["cloudflare-worker"],
    runtime: "worker",
    entries: ["src/index.ts", "migrations/run.ts"],
  };
  const target = { ...delivery(), packages: ["site", "api"], services: ["api"] };
  const supply: Delivery = {
    ...delivery(),
    id: "api",
    kind: "cloudflare-worker",
    runtime: "worker",
    environment: "production",
    entry: { package: "api", path: "src/index.ts" },
  };
  const names = new Map([[service.name, service]]);
  const services = recorder();
  checkServiceReferences(target, names, [supply], services.put);
  assert.deepEqual(
    services.findings.map(({ rule, state }) => ({ rule, state })),
    [{ rule: "service-environment", state: "fail" }],
  );
  const identity = recorder();
  checkIdentityPreparation(target, identity.put);
  assert.deepEqual(
    identity.findings.map(({ rule }) => rule),
    ["oidc-preparation"],
  );
  const migration = recorder();
  checkMigrationPreparation(
    {
      ...target,
      migration: { package: "api", entry: "migrations/run.ts", resource: "DB" },
      resources: [
        {
          name: "DB",
          kind: "resource",
          supply: "platform",
          visibility: "server",
          environment: "test",
        },
      ],
    },
    names,
    migration.put,
  );
  assert.deepEqual(
    migration.findings.map(({ rule, state }) => ({ rule, state })),
    [{ rule: "migration-preparation", state: "pass" }],
  );
});

test("source parsing produces facts; an individual import rule never evaluates unrelated imports", async () => {
  const root = await mkdtemp(join(tmpdir(), "monorepo-source-facts-"));
  try {
    await mkdir(join(root, "apps", "site", "src"), { recursive: true });
    const source = "apps/site/src/main.ts";
    await writeFile(join(root, source), 'import fs from "node:fs"; import "./missing.js";');
    const snapshot = new Snapshot(root);
    const observed = await observeSourceImports(snapshot, source);
    assert.equal(observed.length, 2);
    const owner: Workspace = {
      ...workspace(),
      name: "site",
      path: "apps/site",
      runtime: "browser",
      sources: ["src/main.ts"],
    };
    const result = recorder();
    const nodeImport = observed.find(({ specifier }) => specifier === "node:fs");
    assert.ok(nodeImport);
    await checkSourceImport(
      {
        snapshot,
        contract: contract(owner),
        workspace: owner,
        manifests: new Map(),
        dependencies: [],
        put: result.put,
      },
      source,
      nodeImport,
    );
    assert.deepEqual(
      result.findings.map(({ rule }) => rule),
      ["source-runtime"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
