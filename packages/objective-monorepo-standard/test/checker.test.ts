import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { Contract } from "../src/contract.js";
import { type Delivery, parsePackageSubject, type Report, type Workspace } from "../src/index.js";
import { Snapshot } from "../src/shared.js";
import { checkFixture } from "./capability-fixture.js";

const scratch = join(process.cwd(), ".cache");
await mkdir(scratch, { recursive: true });
const tmpdir = () => scratch;

function workspace(name = "shared"): Workspace {
  return {
    name,
    path: `packages/${name}`,
    roles: ["internal"],
    runtime: "universal",
    allows: [],
    entries: ["src/index.ts"],
    sources: ["src/index.ts"],
    tasks: ["build", "test", "typecheck"],
  };
}
function delivery(kind = "npm", name = "shared"): Delivery {
  return {
    id: `${name}-${kind}`,
    purpose: "Fixture delivery",
    kind,
    packages: [name],
    entry: { package: name, path: "src/index.ts" },
    runtime: "universal",
    resources: [],
    services: [],
    capabilities: [],
    independent: false,
  };
}
async function fixture(
  run: (f: {
    root: string;
    contract: Contract;
    write: (path: string, value: unknown) => Promise<void>;
    check: () => Promise<Report>;
  }) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "objective-monorepo-standard-"));
  async function write(path: string, value: unknown) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
  }
  const contract: Contract = {
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
    workspaces: [workspace()],
    deliveries: [],
  };
  try {
    await write("package.json", { name: "fixture", private: true });
    await write("README.md", "# Fixture");
    await write(
      "pnpm-workspace.yaml",
      "packages: [packages/*, apps/*]\ncatalog:\n  external: 1.0.0\n",
    );
    await write("turbo.json", {
      tasks: {
        build: { dependsOn: ["^build"], outputs: ["dist/**"] },
        test: { outputs: [] },
        typecheck: { outputs: [] },
      },
    });
    await write("packages/shared/package.json", {
      name: "shared",
      private: true,
      exports: { ".": "./src/index.ts" },
      scripts: { build: "DO_NOT_RUN", test: "DO_NOT_RUN", typecheck: "DO_NOT_RUN" },
    });
    await write("packages/shared/README.md", "# Shared");
    await write("packages/shared/src/index.ts", "export const value = 1;");
    await run({
      root,
      contract,
      write,
      check: async () => {
        return checkFixture(root, contract);
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function has(report: Report, rule: string, state = "fail") {
  return report.findings.some((finding) => finding.rule === rule && finding.state === state);
}
test("layer one can pass and internal packages do not require public release metadata", async () => {
  await fixture(async ({ root, contract, check, write }) => {
    const report = await check();
    assert.equal(report.layer2, "checked");
    assert.equal(has(report, "internal-role", "pass"), true);
    assert.equal(
      report.findings.some((finding) => finding.rule.startsWith("npm-")),
      false,
    );
    assert.equal(report.state, "pass");
    assert.equal(report.scope, "delivery-preparation");
    assert.ok(report.limitations.length > 0);
    assert.equal(report.onlineVerified, false);
    const structure = await checkFixture(root, contract, 1);
    assert.equal(structure.state, "pass");
    assert.equal(structure.layer2, "not-requested");
    assert.equal(
      structure.findings.every((finding) => finding.layer === 1),
      true,
    );
    await write("packages/shared/src/index.ts", "void import(computed);");
    assert.equal(has(await check(), "computed-import", "unverified"), true);
    await write("packages/shared/src/index.ts", "import './missing.js';");
    assert.equal(has(await check(), "source-import-resolution", "unverified"), true);
    await write("packages/shared/src/index.ts", "import 'unmapped-runtime';");
    assert.equal(has(await check(), "external-import-resolution", "unverified"), true);
  });
});
test("only explicitly assigned generated files skip source observation", async () => {
  await fixture(async ({ contract, check, write }) => {
    const bundle = "packages/shared/runtime/bundle.cjs";
    await write(bundle, " ".repeat(1024 * 1024 + 1));
    assert.equal(has(await check(), "source-observation", "unverified"), true);
    contract.policy.assignments.push({
      path: bundle,
      purpose: "generated",
      owner: "shared",
      reason: "Verified standalone build output.",
    });
    assert.equal((await check()).state, "pass");
    await write("packages/shared/runtime/manual.cjs", "require('undeclared-runtime');");
    assert.equal(has(await check(), "external-import-resolution", "unverified"), true);
  });
});
test("legacy contracts and invalid package subjects are rejected, not silently adapted", () => {
  for (const value of [
    { root: process.cwd(), contract: "requirements.json" },
    { typo: true },
    { directory: "../outside" },
  ])
    assert.throws(() => parsePackageSubject(value), /Invalid package subject/);
});
test("missing global files, YAML duplicate keys and wrong schema types are not success-shaped", async () => {
  await fixture(async ({ check, write, root }) => {
    for (const yaml of ["packages: [packages/*]\npackages: [apps/*]", "packages: wrong"]) {
      await write("pnpm-workspace.yaml", yaml);
      assert.equal((await check()).layer2, "blocked");
    }
    await rm(join(root, "pnpm-workspace.yaml"));
    assert.equal(has(await check(), "required-file"), true);
  });
});
test("workspace identity, inclusion and delivery mapping require explicit coverage", async () => {
  await fixture(async ({ contract, check, write }) => {
    await write("packages/extra/package.json", { name: "extra" });
    contract.deliveries.push({ ...delivery(), packages: ["absent"] });
    const report = await check();
    assert.equal(has(report, "workspace-coverage"), true);
    assert.equal(has(report, "delivery-mapping"), true);
    assert.equal(report.layer2, "blocked");
  });
});
test("known misplaced files report provenance, current path, destination, reference maintenance and conflicts", async () => {
  await fixture(async ({ contract, check, write }) => {
    await write("guide.md", "# Service guide");
    await write("packages/shared/docs/guide.md", "# Existing");
    contract.policy.assignments.push({
      path: "guide.md",
      purpose: "package-doc",
      owner: "shared",
      reason: "Owned service operation guide",
    });
    const report = await check();
    const finding = report.findings.find((finding) => finding.rule === "file-responsibility");
    assert.equal(finding?.location, "guide.md");
    assert.equal(finding?.targetDirectory, "packages/shared/docs");
    assert.match(finding?.evidence ?? "", /pnpm-default-v1.*Target already exists/);
    assert.match(finding?.remedy ?? "", /references.*never overwrite/);
    contract.policy.exceptions.push({ path: "guide.md", reason: "Tool requires this exact path" });
    assert.equal(has(await check(), "file-responsibility"), false);
  });
});
test("unknown purpose is pending classification; generated and tool-fixed exceptions are not misplaced", async () => {
  await fixture(async ({ contract, check, write }) => {
    await write("odd.txt", "Not enough context");
    let report = await check();
    assert.equal(has(report, "file-classification", "unverified"), true);
    assert.equal(
      report.findings.find((finding) => finding.location === "odd.txt")?.targetDirectory,
      undefined,
    );
    contract.policy.assignments.push({
      path: "odd.txt",
      purpose: "generated",
      reason: "Tool-generated fixture at its fixed path",
    });
    report = await check();
    assert.equal(report.layer2, "checked");
  });
});
test("structure inventory excludes dist directories but still classifies source files and files named dist", async () => {
  await fixture(async ({ check, write }) => {
    await write("dist/package.json", "not a source manifest");
    await write("packages/removed/dist/package.json", "not a workspace manifest");
    await write("packages/removed/dist/index.js", "generated output");
    assert.equal((await check()).state, "pass");

    await write("packages/removed/src/index.ts", "export const value = 1;");
    await write("unclassified/dist", "not a build directory");
    const report = await check();
    for (const path of ["packages/removed/src/index.ts", "unclassified/dist"]) {
      assert.ok(
        report.findings.some(
          (finding) =>
            finding.rule === "file-classification" &&
            finding.state === "unverified" &&
            finding.location === path,
        ),
      );
    }
  });
});
test("migration responsibility follows its owner; cross-service migrations require a declared target", async () => {
  await fixture(async ({ contract, write, check }) => {
    await write("move.sql", "-- fixture only");
    contract.policy.assignments.push({
      path: "move.sql",
      purpose: "migration",
      owner: "shared",
      reason: "Service-owned schema",
    });
    assert.equal(
      (await check()).findings.find((finding) => finding.rule === "file-responsibility")
        ?.targetDirectory,
      "packages/shared/migrations",
    );
    delete contract.policy.assignments[0]?.owner;
    const report = await check();
    assert.equal(has(report, "file-responsibility", "unverified"), true);
  });
});
test("dependency directions, workspace ranges, missing catalogs and cycles are diagnosed", async () => {
  await fixture(async ({ contract, write, check }) => {
    contract.workspaces.push(workspace("other"));
    await write("packages/other/package.json", {
      name: "other",
      private: true,
      dependencies: { shared: "workspace:^" },
    });
    await write("packages/other/src/index.ts", "export {};");
    await write("packages/other/README.md", "# Other");
    await write("packages/shared/package.json", {
      name: "shared",
      private: true,
      dependencies: { other: "^1", external: "catalog:missing" },
    });
    const report = await check();
    for (const rule of [
      "dependency-direction",
      "workspace-range",
      "catalog-reference",
      "dependency-cycle",
      "task-graph",
    ])
      assert.equal(has(report, rule), true, rule);
    contract.policy.dependencyExceptions.push(
      { from: "shared", to: "other", reason: "Explicit allowed direction" },
      { from: "other", to: "shared", reason: "Fixture" },
    );
    assert.equal(has(await check(), "dependency-direction"), false);
    const exception = contract.policy.dependencyExceptions[0];
    assert.ok(exception);
    exception.allowCycle = true;
    assert.equal(has(await check(), "dependency-cycle"), false);
  });
});
test("cross-package relative paths and private exports fail without treating package paths as delivery identities", async () => {
  await fixture(async ({ contract, write, check }) => {
    contract.workspaces.push(workspace("other"));
    await write("packages/other/package.json", {
      name: "other",
      private: true,
      exports: { ".": "./src/index.ts" },
    });
    await write("packages/other/src/index.ts", "export {};");
    await write("packages/other/README.md", "# Other");
    await write(
      "packages/shared/src/index.ts",
      "import '../../other/src/index.js'; import 'other/private';",
    );
    const report = await check();
    assert.equal(has(report, "entry-boundary"), true);
    assert.equal(has(report, "undeclared-import"), true);
  });
});
test("npm and CLI roles compose and absent artifacts are unverified, not validated by a build script", async () => {
  await fixture(async ({ contract, write, check }) => {
    const shared = contract.workspaces[0];
    assert.ok(shared);
    shared.roles = ["npm", "cli"];
    shared.runtime = "node";
    contract.deliveries.push(
      { ...delivery("cli"), runtime: "node" },
      { ...delivery("npm"), runtime: "node" },
    );
    await write("packages/shared/package.json", {
      name: "shared",
      version: "1.0.0",
      publishConfig: { access: "public" },
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
      bin: { fixture: "./dist/bin.js" },
      files: ["dist"],
      engines: { node: ">=22.13.0" },
      scripts: { build: "DO_NOT_RUN", test: "DO_NOT_RUN", typecheck: "DO_NOT_RUN" },
    });
    const report = await check();
    assert.equal(has(report, "npm-identity", "pass"), true);
    assert.equal(has(report, "cli-bin", "pass"), true);
    assert.equal(has(report, "npm-artifact", "unverified"), true);
    assert.equal(has(report, "cli-artifact", "unverified"), true);
    assert.equal(
      report.limitations.some((limitation) => limitation.includes("packing")),
      true,
    );
    assert.equal(report.state, "unverified");
    await write("packages/shared/dist/index.js", "export {};");
    await write("packages/shared/dist/index.d.ts", "export {};");
    await write("packages/shared/dist/bin.js", "#!/usr/bin/env node\nconsole.log('fixture');");
    const complete = await check();
    assert.equal(complete.state, "pass");
    assert.equal(complete.onlineVerified, false);
    shared.roles = ["npm"];
    contract.deliveries = contract.deliveries.filter((item) => item.kind === "npm");
    assert.equal((await check()).state, "pass");
  });
});
async function appFixture(
  kind: "browser" | "cloudflare-worker",
  run: (f: {
    contract: Contract;
    write: (path: string, value: unknown) => Promise<void>;
    check: () => Promise<Report>;
    delivery: Delivery;
  }) => Promise<void>,
) {
  await fixture(async (f) => {
    const app: Workspace = {
      ...workspace("app"),
      path: "apps/app",
      roles: [kind],
      runtime: kind === "browser" ? "browser" : "worker",
      allows: ["shared"],
    };
    f.contract.workspaces.push(app);
    await f.write("apps/app/package.json", {
      name: "app",
      private: true,
      dependencies: { shared: "workspace:^" },
      scripts: { build: "DO_NOT_RUN", test: "DO_NOT_RUN", typecheck: "DO_NOT_RUN" },
    });
    await f.write("apps/app/README.md", "# App");
    await f.write("apps/app/src/index.ts", "import 'shared';");
    await f.write("apps/app/dist/index.js", "export {};");
    const item: Delivery = {
      ...delivery(kind, "app"),
      runtime: app.runtime,
      packages: ["app", "shared"],
      config: "apps/app/deployment.json",
      output: "apps/app/dist",
      environment: "preview",
    };
    f.contract.deliveries.push(item);
    await f.write(
      item.config ?? "",
      kind === "browser"
        ? {
            entry: "apps/app/src/index.ts",
            environment: "preview",
            outputDirectory: "apps/app/dist",
          }
        : {
            name: "fixture",
            main: "src/index.ts",
            compatibility_date: "2026-01-01",
            env: { preview: {} },
          },
    );
    await run({ ...f, delivery: item });
  });
}
test("browser positive configuration supports multi-package association; API and private configuration mismatch fail", async () => {
  await appFixture("browser", async ({ delivery: item, write, check }) => {
    let report = await check();
    assert.equal(report.layer2, "checked");
    assert.equal(
      report.findings.some((finding) => finding.state === "fail"),
      false,
    );
    assert.equal(report.state, "pass");
    assert.equal(report.onlineVerified, false);
    assert.equal(has(report, "delivery-artifact", "pass"), true);
    item.resources.push({
      name: "TOKEN",
      kind: "secret",
      visibility: "public",
      supply: "build",
      environment: "production",
    });
    item.services.push("not-mapped-api");
    await write("apps/app/deployment.json", {
      entry: "wrong",
      environment: "production",
      outputDirectory: "elsewhere",
    });
    await write("apps/app/src/index.ts", "import fs from 'node:fs';");
    report = await check();
    for (const rule of [
      "secret-boundary",
      "resource-environment",
      "service-mapping",
      "browser-deployment",
      "source-runtime",
    ])
      assert.equal(has(report, rule), true, rule);
  });
});
test("Cloudflare configuration checks environment, entry, bindings and optional capabilities without provisioning", async () => {
  await appFixture("cloudflare-worker", async ({ delivery: item, write, check }) => {
    let report = await check();
    assert.equal(
      report.findings.some((finding) => finding.state === "fail"),
      false,
    );
    assert.equal(has(report, "oidc-preparation", "not-applicable"), true);
    assert.equal(report.state, "pass");
    item.resources.push({
      name: "DB",
      kind: "resource",
      visibility: "server",
      supply: "platform",
      environment: "preview",
    });
    item.capabilities.push("oidc", "migrations");
    report = await check();
    for (const rule of ["worker-binding", "oidc-preparation", "migration-preparation"])
      assert.equal(has(report, rule), true, rule);
    await write("apps/app/deployment.json", {
      name: "fixture",
      main: "wrong.ts",
      compatibility_date: "not-date",
      env: { preview: {} },
    });
    report = await check();
    assert.equal(has(report, "worker-entry"), true);
    assert.equal(has(report, "worker-schema"), true);
  });
});
test("unsupported delivery, capability and deployment formats never fall back to success", async () => {
  await fixture(async ({ contract, check }) => {
    contract.deliveries.push(delivery("other-service"));
    const unsupported = await check();
    assert.equal(has(unsupported, "unsupported-delivery", "unverified"), true);
    assert.equal(unsupported.state, "unverified");
  });
  await appFixture("cloudflare-worker", async ({ delivery: item, write, check }) => {
    item.config = "apps/app/wrangler.toml";
    await write(item.config, "name = 'fixture'");
    assert.equal(has(await check(), "deployment-format", "unverified"), true);
  });
});
test("checker does not execute scripts or read secret-value files and leaves the target unchanged", async () => {
  await fixture(async ({ root, contract, write, check }) => {
    await write(".env", "DO_NOT_READ=fixture-canary");
    await check();
    async function digest(directory: string): Promise<string> {
      const hash = createHash("sha256");
      async function walk(path: string) {
        for (const item of await readdir(path, { withFileTypes: true })) {
          const full = join(path, item.name);
          hash.update(full);
          if (item.isDirectory()) await walk(full);
          else hash.update(await readFile(full));
        }
      }
      await walk(directory);
      return hash.digest("hex");
    }
    const before = await digest(root);
    const report = await checkFixture(root, contract);
    assert.equal(await digest(root), before);
    assert.equal(JSON.stringify(report).includes("fixture-canary"), false);
    await assert.rejects(new Snapshot(root).text(".env"), /secret-value/);
  });
});

test("task cycles and dangling task references are not hidden by valid build script names", async () => {
  await fixture(async ({ write, check }) => {
    await write("turbo.json", {
      tasks: {
        build: { outputs: ["dist/**"], dependsOn: ["test", "missing"] },
        test: { dependsOn: ["build"], outputs: [] },
        typecheck: { outputs: [] },
      },
    });
    const report = await check();
    assert.equal(has(report, "task-cycle"), true);
    assert.equal(has(report, "task-reference"), true);
  });
});

test("role combinations do not force browser and Worker into separate packages", async () => {
  await appFixture("browser", async ({ contract, delivery: browser, write, check }) => {
    const app = contract.workspaces.find((workspace) => workspace.name === "app");
    assert.ok(app);
    app.roles.push("cloudflare-worker");
    app.runtime = "universal";
    app.entries.push("src/service.ts");
    await write("apps/app/src/service.ts", "export default {};");
    await write("apps/app/worker.json", {
      name: "fixture",
      main: "src/service.ts",
      compatibility_date: "2026-01-01",
      env: { preview: {} },
    });
    contract.deliveries.push({
      ...browser,
      id: "combined-api",
      kind: "cloudflare-worker",
      runtime: "worker",
      entry: { package: "app", path: "src/service.ts" },
      config: "apps/app/worker.json",
      resources: [],
      services: [],
      capabilities: [],
    });
    let report = await check();
    assert.equal(report.layer2, "checked");
    assert.equal(
      report.findings.some((finding) => finding.state === "fail"),
      false,
    );
    await write("apps/app/src/index.ts", "import './browser-path.js';");
    await write("apps/app/src/browser-path.ts", "import 'node:crypto';");
    report = await check();
    assert.equal(has(report, "entry-runtime"), true);
    const finding = report.findings.find(
      (finding) => finding.rule === "entry-runtime" && finding.state === "fail",
    );
    assert.deepEqual(finding?.requirements, [browser.id]);
  });
});

test("worker ordinary config and secrets are references; explicit migration mappings can satisfy preparation", async () => {
  await appFixture("cloudflare-worker", async ({ contract, delivery: item, write, check }) => {
    const app = contract.workspaces.find((workspace) => workspace.name === "app");
    assert.ok(app);
    app.entries.push("src/upgrade.ts");
    await write("apps/app/src/upgrade.ts", "export {};");
    item.capabilities = ["oidc", "migrations"];
    item.resources = [
      {
        name: "DB",
        kind: "resource",
        visibility: "server",
        supply: "platform",
        environment: "preview",
      },
      {
        name: "IDENTITY",
        kind: "identity",
        visibility: "server",
        supply: "platform",
        environment: "preview",
      },
      {
        name: "MODE",
        kind: "configuration",
        visibility: "server",
        supply: "runtime",
        environment: "preview",
      },
      {
        name: "TOKEN",
        kind: "secret",
        visibility: "server",
        supply: "platform",
        environment: "preview",
      },
    ];
    item.migration = { package: "app", entry: "src/upgrade.ts", resource: "DB" };
    await write("apps/app/deployment.json", {
      name: "fixture",
      main: "src/index.ts",
      compatibility_date: "2026-01-01",
      env: {
        preview: {
          vars: { MODE: "preview" },
          d1_databases: [{ binding: "DB", database_id: "non-secret-fixture-resource" }],
        },
      },
    });
    let report = await check();
    assert.equal(has(report, "migration-preparation", "pass"), true);
    assert.equal(has(report, "oidc-preparation", "pass"), true);
    assert.equal(has(report, "worker-binding"), false);
    assert.equal(report.state, "pass");
    assert.equal(
      report.findings.some((finding) => finding.state === "fail"),
      false,
    );
    await write("apps/app/deployment.json", "{not-json");
    report = await check();
    assert.equal(has(report, "delivery-observation"), true);
  });
});

test("unknown global fields and a missing support closure block rather than guessing requirements", async () => {
  await fixture(async ({ contract, write, check }) => {
    await write("pnpm-workspace.yaml", "packages: [packages/*]\nunknownSetting: true");
    assert.equal(has(await check(), "workspace-schema", "unverified"), true);
    await write("pnpm-workspace.yaml", "packages: [packages/*]");
    contract.workspaces.push(workspace("other"));
    contract.deliveries.push(delivery("external"));
    await write("packages/shared/package.json", {
      name: "shared",
      private: true,
      dependencies: { other: "workspace:^" },
    });
    await write("packages/other/package.json", { name: "other", private: true });
    await write("packages/other/README.md", "# Other");
    await write("packages/other/src/index.ts", "export {};");
    assert.equal(has(await check(), "requirement-closure"), true);
  });
});

test("directory overrides are explicit and justified fixed-location exceptions stay legal", async () => {
  await fixture(async ({ contract, check }) => {
    contract.policy.directories.packages = "modules";
    assert.equal(has(await check(), "layout-package-role"), true);
    contract.policy.exceptions.push({
      path: "packages/shared",
      reason: "Incremental adoption preserves the existing published package location.",
    });
    assert.equal((await check()).layer2, "checked");
  });
});

test("executable-only npm packages are valid without library exports or type declarations", async () => {
  await fixture(async ({ contract, write, check }) => {
    const shared = contract.workspaces[0];
    assert.ok(shared);
    shared.roles = ["npm", "cli", "tool"];
    shared.runtime = "node";
    contract.deliveries.push(
      { ...delivery("npm"), runtime: "node" },
      { ...delivery("cli"), runtime: "node" },
    );
    await write("packages/shared/dist/bin.js", "#!/usr/bin/env node\nconsole.log('fixture');");
    await write("packages/shared/package.json", {
      name: "shared",
      version: "1.0.0",
      bin: { fixture: "./dist/bin.js" },
      files: ["dist"],
      engines: { node: ">=22.13.0" },
      publishConfig: { access: "public", tag: "next" },
      scripts: { build: "DO_NOT_RUN", test: "DO_NOT_RUN", typecheck: "DO_NOT_RUN" },
    });
    const report = await check();
    assert.equal(has(report, "npm-exports", "not-applicable"), true);
    assert.equal(has(report, "npm-types", "not-applicable"), true);
    assert.equal(has(report, "cli-entry", "pass"), true);
    assert.equal(report.state, "pass");
    assert.equal(
      report.findings.some((finding) => finding.state === "fail"),
      false,
    );
  });
});

test("service references require an actual service delivery in the same environment, not package association", async () => {
  await appFixture("browser", async ({ contract, delivery: browser, write, check }) => {
    const app = contract.workspaces.find((workspace) => workspace.name === "app");
    assert.ok(app);
    app.roles.push("cloudflare-worker");
    app.runtime = "universal";
    app.entries.push("src/service.ts");
    await write("apps/app/src/service.ts", "export default {};");
    const service: Delivery = {
      ...browser,
      id: "api-preview",
      kind: "cloudflare-worker",
      runtime: "worker",
      entry: { package: "app", path: "src/service.ts" },
      config: "apps/app/worker.json",
      resources: [],
      services: [],
      capabilities: [],
    };
    contract.deliveries.push(service);
    browser.services = ["app"];
    await write("apps/app/worker.json", {
      name: "fixture",
      main: "src/service.ts",
      compatibility_date: "2026-01-01",
      env: { preview: {} },
    });
    assert.equal((await check()).state, "pass");

    service.environment = "production";
    await write("apps/app/worker.json", {
      name: "fixture",
      main: "src/service.ts",
      compatibility_date: "2026-01-01",
      env: { production: {} },
    });
    let report = await check();
    assert.equal(has(report, "service-environment"), true);
    assert.equal(report.state, "fail");
    assert.deepEqual(
      report.findings.find(
        (finding) => finding.rule === "service-environment" && finding.state === "fail",
      )?.requirements,
      [browser.id],
    );

    browser.services = ["shared"];
    report = await check();
    assert.equal(has(report, "service-role"), true);
    assert.equal(report.state, "fail");

    browser.services = ["external-api"];
    browser.resources.push({
      name: "external-api",
      kind: "service",
      visibility: "public",
      supply: "runtime",
      environment: "preview",
    });
    assert.equal((await check()).state, "pass");
    const reference = browser.resources[0];
    assert.ok(reference);
    reference.environment = "production";
    assert.equal((await check()).state, "fail");
    reference.environment = "preview";
    reference.kind = "resource";
    assert.equal(has(await check(), "service-mapping"), true);
  });
});
