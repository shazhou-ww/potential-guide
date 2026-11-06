import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, posix } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  assertLatestVersion,
  consumerManifest,
  consumerMode,
  consumerVersions,
  verifyConsumerGraph,
} from "./deployment-consumer.mjs";
import { releasePackages } from "./release-packages.mjs";
import { createDeploymentWorkspace } from "./verify-deployment-helpers.mjs";

test("deployment fixture uses the worker contract and observes marker changes", async () => {
  const check = new URL("./fixtures/deployment-acp/guide/checks/ready/", import.meta.url);
  await assert.rejects(access(new URL("run.js", check)), { code: "ENOENT" });
  const { execute } = await import(new URL("worker.cjs", check).href);
  const workspace = await createDeploymentWorkspace();
  const subject = { marker: join(workspace.path, "ready") };
  try {
    const missing = await execute(subject);
    assert.equal(missing.status, 200);
    assert.deepEqual(missing.payload, {
      ok: false,
      problems: [{ kind: "internal", id: "not-ready", parameters: {} }],
    });
    await writeFile(subject.marker, "ready");
    assert.deepEqual((await execute(subject)).payload, { ok: true, problems: [] });
  } finally {
    await workspace.cleanup();
  }
});

test("Docker release packing retains app workspace paths, tarballs and required assets", async () => {
  const source = await readFile(
    new URL("./self-check-docker/prepare-image.mjs", import.meta.url),
    "utf8",
  );
  const loop = source.match(
    /for \(const \{ name, directory, workspace, requiredFiles \} of releasePackages\) \{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(loop, "Missing workspace-aware Docker release packing loop");
  const products = releasePackages.filter(
    ({ workspace, id }) => workspace === "apps" || id === "pguide",
  );
  assert.equal(products.length, 3);
  const versions = new Map();
  const manifestVersions = new Map();
  const tarballs = new Map();
  const checkedFiles = [];
  const packedRoots = [];
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  await new AsyncFunction(
    "releasePackages",
    "join",
    "resolve",
    "readFile",
    "access",
    "run",
    "assert",
    "versions",
    "tarballs",
    loop,
  )(
    products,
    posix.join,
    posix.resolve,
    async (path) => {
      assert.match(path, /^\/source\/(?:apps|packages)\//);
      const contents = await readFile(
        new URL(`../${path.slice("/source/".length)}`, import.meta.url),
        "utf8",
      );
      const manifest = JSON.parse(contents);
      manifestVersions.set(manifest.name, manifest.version);
      return contents;
    },
    async (path) => checkedFiles.push(path),
    (_command, args, cwd) => {
      assert.equal(cwd, "/source");
      assert.equal(args[0], "--dir");
      assert.equal(args[2], "pack");
      assert.equal(args[4], "/packs");
      const entry = products.find(
        ({ directory, workspace }) => args[1] === `/source/${workspace ?? "packages"}/${directory}`,
      );
      assert.ok(entry, `Unexpected Docker package root ${args[1]}`);
      packedRoots.push(args[1]);
      return JSON.stringify({
        name: entry.name,
        version: manifestVersions.get(entry.name),
        filename: `/packs/${entry.id}.tgz`,
      });
    },
    assert,
    versions,
    tarballs,
  );
  assert.equal(packedRoots.length, 3);
  for (const entry of products) {
    assert.equal(tarballs.get(entry.name), `/packs/${entry.id}.tgz`);
    for (const file of entry.requiredFiles ?? [])
      assert.ok(
        checkedFiles.includes(
          `/source/${entry.workspace ?? "packages"}/${entry.directory}/${file}`,
        ),
      );
  }
  const manifest = consumerManifest(
    "packed",
    versions,
    tarballs,
    products.map(({ name }) => name),
  );
  for (const entry of products) {
    assert.equal(manifest.dependencies[entry.name], pathToFileURL(`/packs/${entry.id}.tgz`).href);
  }
  const dockerfile = await readFile(
    new URL("./self-check-docker/Dockerfile", import.meta.url),
    "utf8",
  );
  assert.ok(dockerfile.includes("COPY --from=build /opt/consumer /opt/consumer"));
});

test("Docker UI preparation uses existing catalog tools and builds assets before packing", async () => {
  const source = await readFile(
    new URL("./self-check-docker/prepare-image.mjs", import.meta.url),
    "utf8",
  );
  const { parse } = createRequire(
    new URL("../packages/pilot-protocol/package.json", import.meta.url),
  )("yaml");
  const workspace = parse(
    await readFile(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8"),
  );
  const setup = source.match(/const uiRoot = [\s\S]*?(?=await mkdir\("\/toolchain"\);)/)?.[0];
  assert.ok(setup, "Missing catalog-selected UI toolchain setup");
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const { uiRoot, uiBuildDependencies, toolchainVersions } = await new AsyncFunction(
    "workspace",
    "readFile",
    "join",
    "assert",
    `${setup}\nreturn {uiRoot, uiBuildDependencies, toolchainVersions};`,
  )(
    workspace,
    async (path) => {
      assert.equal(path, "/source/apps/task-engine-webui/package.json");
      return readFile(new URL("../apps/task-engine-webui/package.json", import.meta.url), "utf8");
    },
    posix.join,
    assert,
  );
  assert.deepEqual(uiBuildDependencies, [
    "@tailwindcss/cli",
    "@types/jsdom",
    "@types/react",
    "@types/react-dom",
    "esbuild",
    "jsdom",
    "linkedom",
    "tailwindcss",
    "tw-animate-css",
  ]);
  for (const name of uiBuildDependencies)
    assert.equal(toolchainVersions[name], workspace.catalog[name]);
  assert.equal(toolchainVersions["@types/semver"], workspace.catalog["@types/semver"]);
  const typeLinkSource = source.match(
    /for \(const name of \["node"[^\]]*\]\) \{\s*await symlink[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(typeLinkSource, "Missing compiler declaration links");
  const typeLinks = [];
  await new AsyncFunction("symlink", typeLinkSource)(async (sourcePath, destination) =>
    typeLinks.push([sourcePath, destination]),
  );
  assert.deepEqual(
    typeLinks,
    ["node", "cross-spawn", "semver"].map((name) => [
      `/toolchain/node_modules/@types/${name}`,
      `/source/node_modules/@types/${name}`,
    ]),
  );
  const linkSource = source.match(
    /for \(const name of uiBuildDependencies\) \{\s*const destination[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(linkSource, "Missing UI build-stage dependency links");
  const links = [];
  await new AsyncFunction("uiBuildDependencies", "uiRoot", "join", "mkdir", "symlink", linkSource)(
    uiBuildDependencies,
    uiRoot,
    posix.join,
    async () => {},
    async (sourcePath, destination) => links.push([sourcePath, destination]),
  );
  assert.deepEqual(
    links,
    uiBuildDependencies.map((name) => [
      `/toolchain/node_modules/${name}`,
      `/source/apps/task-engine-webui/node_modules/${name}`,
    ]),
  );
  const build = 'run("npm", ["--prefix", uiRoot, "run", "build"], "/source");';
  assert.ok(source.includes(build), "Invoke the existing UI build script");
  assert.ok(source.indexOf(build) < source.indexOf('await mkdir("/packs");'));
  assert.ok(source.includes('PATH: ["/toolchain/node_modules/.bin", process.env.PATH]'));
  const manifest = JSON.parse(
    await readFile(new URL("../apps/task-engine-webui/package.json", import.meta.url), "utf8"),
  );
  assert.match(manifest.scripts.build, /node build\.mjs/);
  assert.match(manifest.scripts.build, /tailwindcss/);
});

test("Docker prepares generated Check types and accepts real environment Bundles before packing", async () => {
  const source = await readFile(
    new URL("./self-check-docker/prepare-image.mjs", import.meta.url),
    "utf8",
  );
  const prepare =
    'run(process.execPath, ["/source/packages/check-environment/prepare.mjs"], "/source");';
  const build =
    'run(process.execPath, ["/source/packages/check-environment/build.mjs"], "/source");';
  assert.ok(source.includes(prepare));
  assert.ok(source.includes(build));
  assert.ok(source.indexOf('"/source/packages/check-sdk/tsconfig.json"') < source.indexOf(prepare));
  assert.ok(source.indexOf(prepare) < source.indexOf('"/source/tsconfig.json"'));
  assert.ok(source.indexOf('"/source/tsconfig.json"') < source.indexOf(build));
  assert.ok(source.indexOf(build) < source.indexOf('await mkdir("/packs");'));
  assert.ok(
    source.includes(
      '"/source/packages/check-environment/node_modules/@potential-guide/pguide-task-bundle"',
    ),
  );
  assert.ok(
    source.includes(
      'await symlink("/toolchain/node_modules/typescript", "/source/node_modules/typescript")',
    ),
  );
});

test("consumer versions follow only the selected entry closure and reject missing workspace packs", () => {
  const manifests = new Map([
    ["pguide", { version: "0.4.0", dependencies: { support: "workspace:^" } }],
    ["support", { version: "0.1.0", dependencies: { pguide: "workspace:^" } }],
    ["unselected-objective", { version: "0.2.0" }],
  ]);
  assert.deepEqual(
    [...consumerVersions(manifests, ["pguide"])],
    [
      ["pguide", "0.4.0"],
      ["support", "0.1.0"],
    ],
  );
  assert.throws(() => consumerVersions(manifests, ["missing"]), /Missing consumer manifest/);
  manifests.delete("support");
  assert.throws(
    () => consumerVersions(manifests, ["pguide"]),
    /Missing internal consumer manifest/,
  );
});

test("entry-only consumers accept shared stable/RC rules and select exact, latest or local overrides", () => {
  for (const version of ["0.4.0", "0.4.1", "0.4.0-rc.0", "0.4.0-rc.12"]) {
    const versions = new Map([
      ["pguide", version],
      ["@potential-guide/effects", "0.1.0-rc.0"],
    ]);
    const tarballs = new Map(
      [...versions.keys()].map((name, i) => [name, join(process.cwd(), `pack ${i}.tgz`)]),
    );
    for (const [args, mode] of [
      [[], "packed"],
      [["--published"], "published"],
      [["--latest"], "latest"],
    ]) {
      assert.equal(consumerMode(args), mode);
      const manifest = consumerManifest(mode, versions, tarballs);
      assert.deepEqual(Object.keys(manifest.dependencies), ["pguide"]);
      assert.equal(
        manifest.dependencies.pguide,
        mode === "packed"
          ? pathToFileURL(tarballs.get("pguide")).href
          : mode === "latest"
            ? "latest"
            : version,
      );
      if (mode === "packed") {
        assert.deepEqual(Object.keys(manifest.overrides), ["@potential-guide/effects"]);
        assert.equal(
          manifest.overrides["@potential-guide/effects"],
          pathToFileURL(tarballs.get("@potential-guide/effects")).href,
        );
      } else assert.equal(manifest.overrides, undefined);
    }
  }
  for (const version of [
    "1.0.0",
    "1.0.0-rc.0",
    "0.04.0",
    "0.4.00",
    "0.4.0-rc.01",
    "0.4.0-beta.1",
    "0.4.0+build",
    "latest",
    "",
  ]) {
    assert.throws(() => consumerManifest("published", new Map([["pguide", version]])));
  }
  for (const args of [["--unknown"], ["--published", "--latest"], ["--latest", "--latest"]])
    assert.throws(() => consumerMode(args));
  assert.throws(() => consumerManifest("packed", new Map([["pguide", "0.4.0"]])));
  assertLatestVersion("0.4.0", "0.4.0");
  assert.throws(() => assertLatestVersion("0.3.0", "0.4.0"));
});

test("entry graph requires every expected dependency, rejects missing, nested wrong versions and workspace ranges", async () => {
  const workspace = await createDeploymentWorkspace();
  const versions = new Map([
    ["pguide", "0.4.0"],
    ["@potential-guide/pguide-config", "0.3.0"],
    ["@potential-guide/cli-core", "0.3.0"],
  ]);
  async function manifest(base, name, version, dependencies = {}) {
    const directory = join(base, "node_modules", ...name.split("/"));
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name, version, dependencies }),
    );
    return directory;
  }
  try {
    await manifest(workspace.path, "pguide", "0.4.0", {
      "@potential-guide/pguide-config": "^0.3.0",
    });
    const config = await manifest(workspace.path, "@potential-guide/pguide-config", "0.3.0");
    await assert.rejects(
      verifyConsumerGraph(workspace.path, versions),
      /Selected entries must reach/,
    );
    await manifest(workspace.path, "@potential-guide/pguide-config", "0.3.0", {
      "@potential-guide/cli-core": "^0.3.0",
    });
    await assert.rejects(verifyConsumerGraph(workspace.path, versions), /Missing transitive/);
    await manifest(workspace.path, "@potential-guide/cli-core", "0.3.0");
    await verifyConsumerGraph(workspace.path, versions);
    const isolated = join(workspace.path, "isolated");
    await manifest(isolated, "pguide", "0.4.0", { "@potential-guide/pguide-config": "^0.3.0" });
    await assert.rejects(verifyConsumerGraph(isolated, versions), /Missing transitive/);
    await manifest(config, "@potential-guide/cli-core", "0.2.0");
    await assert.rejects(
      verifyConsumerGraph(workspace.path, versions),
      /Unexpected transitive version/,
    );
    await manifest(config, "@potential-guide/cli-core", "0.3.0");
    await verifyConsumerGraph(workspace.path, versions);
    await manifest(workspace.path, "@potential-guide/pguide-config", "0.3.0", {
      "@potential-guide/cli-core": "^0.2.0",
    });
    await assert.rejects(verifyConsumerGraph(workspace.path, versions), /packed internal range/);
    await manifest(workspace.path, "pguide", "0.4.0", {
      "@potential-guide/pguide-config": "workspace:^",
    });
    await assert.rejects(
      verifyConsumerGraph(workspace.path, versions),
      /unresolved workspace range/,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("current CLI command versions match their package candidate", async () => {
  const root = new URL("../", import.meta.url);
  for (const [directory, files] of [
    ["pguide", ["src/bin.ts"]],
    ["pguide-config", ["src/bin.ts"]],
  ]) {
    const manifest = JSON.parse(
      await readFile(new URL(`packages/${directory}/package.json`, root), "utf8"),
    );
    for (const file of files) {
      const source = await readFile(new URL(`packages/${directory}/${file}`, root), "utf8");
      assert.ok(
        source.includes(`"${manifest.version}"`),
        `${file} must advertise ${manifest.version}`,
      );
    }
  }
  for (const definition of releasePackages) {
    const manifest = JSON.parse(
      await readFile(
        new URL(`${definition.workspace ?? "packages"}/${definition.directory}/package.json`, root),
        "utf8",
      ),
    );
    consumerManifest("published", new Map([["pguide", manifest.version]]));
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (releasePackages.some((entry) => entry.name === name)) assert.equal(range, "workspace:^");
    }
  }
});
