import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, delimiter, join, resolve } from "node:path";
import { consumerManifest, verifyConsumerGraph } from "/source/scripts/deployment-consumer.mjs";
import { releasePackages } from "/source/scripts/release-packages.mjs";

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      PATH: ["/toolchain/node_modules/.bin", process.env.PATH].filter(Boolean).join(delimiter),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
    },
  }).trim();
}

const registry = new URL(process.env.npm_config_registry ?? "https://registry.npmjs.org/");
assert.equal(registry.protocol, "https:");
assert.equal(registry.username + registry.password + registry.search + registry.hash, "");
const { parse } = createRequire("/source/packages/pilot-protocol/package.json")("yaml");
const workspace = parse(await readFile("/source/pnpm-workspace.yaml", "utf8"));
const uiRoot = "/source/apps/task-engine-webui";
const uiManifest = JSON.parse(await readFile(join(uiRoot, "package.json"), "utf8"));
const uiBuildDependencies = [
  "@tailwindcss/cli",
  "@types/jsdom",
  "@types/react",
  "@types/react-dom",
  "esbuild",
  "jsdom",
  "linkedom",
  "tailwindcss",
  "tw-animate-css",
];
const toolchainVersions = {
  typescript: "5.9.3",
  "@types/node": "22.20.5",
  "@types/cross-spawn": "6.0.6",
  "@types/semver": workspace.catalog["@types/semver"],
  "undici-types": "6.21.0",
};
assert.match(
  toolchainVersions["@types/semver"],
  /^\d+\.\d+\.\d+$/u,
  "@types/semver: use the exact source catalog version",
);
for (const name of ["typescript", "@types/node", "@types/cross-spawn"]) {
  assert.equal(
    workspace.catalog[name],
    toolchainVersions[name],
    `${name}: isolated toolchain must match the selected source catalog`,
  );
}
for (const name of uiBuildDependencies) {
  assert.equal(
    uiManifest.devDependencies[name],
    "catalog:",
    `${name}: expected UI catalog dependency`,
  );
  assert.match(
    workspace.catalog[name],
    /^\d+\.\d+\.\d+$/u,
    `${name}: use the exact source catalog version`,
  );
  toolchainVersions[name] = workspace.catalog[name];
}
await mkdir("/toolchain");
run(
  "npm",
  [
    "install",
    "--prefix",
    "/toolchain",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--save-exact",
    "--registry",
    registry.href,
    ...Object.entries(toolchainVersions).map(([name, version]) => `${name}@${version}`),
  ],
  "/toolchain",
);
for (const [name, version] of Object.entries(toolchainVersions)) {
  const manifest = JSON.parse(
    await readFile(join("/toolchain/node_modules", name, "package.json"), "utf8"),
  );
  assert.equal(manifest.name, name);
  assert.equal(manifest.version, version);
}
await mkdir("/source/node_modules/@types", { recursive: true });
for (const name of ["node", "cross-spawn", "semver"]) {
  await symlink(`/toolchain/node_modules/@types/${name}`, `/source/node_modules/@types/${name}`);
}
for (const name of uiBuildDependencies) {
  const destination = join(uiRoot, "node_modules", name);
  await mkdir(join(destination, ".."), { recursive: true });
  await symlink(join("/toolchain/node_modules", name), destination);
}
await symlink("/toolchain/node_modules/typescript", "/source/node_modules/typescript");
await mkdir("/source/packages/check-environment/node_modules/@potential-guide", {
  recursive: true,
});
await symlink(
  "/source/packages/pguide-task-bundle",
  "/source/packages/check-environment/node_modules/@potential-guide/pguide-task-bundle",
);
run(
  process.execPath,
  [
    "/toolchain/node_modules/typescript/bin/tsc",
    "-b",
    "/source/packages/task-protocol/tsconfig.json",
    "/source/packages/task-sdk/tsconfig.json",
    "/source/packages/check-sdk/tsconfig.json",
    "--pretty",
    "false",
  ],
  "/source",
);
run(process.execPath, ["/source/packages/check-environment/prepare.mjs"], "/source");
run(
  process.execPath,
  [
    "/toolchain/node_modules/typescript/bin/tsc",
    "-b",
    "/source/tsconfig.json",
    "--pretty",
    "false",
  ],
  "/source",
);
run("npm", ["--prefix", uiRoot, "run", "build"], "/source");
run(process.execPath, ["/source/packages/check-environment/build.mjs"], "/source");

await mkdir("/packs");
await mkdir("/opt/consumer", { recursive: true });
const versions = new Map();
const tarballs = new Map();
for (const { name, directory, workspace, requiredFiles } of releasePackages) {
  const packageRoot = join("/source", workspace ?? "packages", directory);
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  for (const file of requiredFiles ?? []) await access(join(packageRoot, file));
  const packed = JSON.parse(
    run(
      "pnpm",
      ["--dir", packageRoot, "pack", "--pack-destination", "/packs", "--json"],
      "/source",
    ),
  );
  assert.equal(packed.name, name);
  assert.equal(packed.version, manifest.version);
  versions.set(name, manifest.version);
  tarballs.set(name, resolve(packed.filename));
}
await writeFile(
  "/opt/consumer/package.json",
  JSON.stringify(
    consumerManifest(
      "packed",
      versions,
      tarballs,
      releasePackages.filter(({ bins }) => bins.length > 0).map(({ name }) => name),
    ),
    null,
    2,
  ),
);
run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], "/opt/consumer");
await verifyConsumerGraph(
  "/opt/consumer",
  versions,
  releasePackages.filter(({ bins }) => bins.length > 0).map(({ name }) => name),
);

await mkdir("/opt/objective/packages", { recursive: true });
await cp(
  "/source/packages/objective-pguide-self-check",
  "/opt/objective/packages/objective-pguide-self-check",
  {
    recursive: true,
    filter: (source) => !["node_modules", ".turbo", "test"].includes(basename(source)),
  },
);
await cp(
  "/source/packages/objective-pguide-setup",
  "/opt/objective/packages/objective-pguide-setup",
  {
    recursive: true,
    filter: (source) => !["node_modules", ".turbo", "test"].includes(basename(source)),
  },
);
run("git", ["init", "-q", "--initial-branch=fixture"], "/opt/objective");
run("git", ["add", "packages"], "/opt/objective");
run(
  "git",
  [
    "-c",
    "user.name=Credential-free fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "Self-check Objective snapshot",
    "--date=2000-01-01T00:00:00Z",
  ],
  "/opt/objective",
);
const provenance = JSON.parse(await readFile("/harness/provenance.json", "utf8"));
provenance.buildMethod = "frozen-prod-plus-tsc-ui-and-environment-build";
provenance.toolchainVersions = toolchainVersions;
provenance.toolchainLockSha256 = createHash("sha256")
  .update(await readFile("/toolchain/package-lock.json"))
  .digest("hex");
provenance.objectiveRevision = run("git", ["rev-parse", "HEAD"], "/opt/objective");
provenance.pguideVersion = versions.get("pguide");
provenance.installedLockSha256 = createHash("sha256")
  .update(await readFile("/opt/consumer/package-lock.json"))
  .digest("hex");
await writeFile("/harness/provenance.json", `${JSON.stringify(provenance, null, 2)}\n`);
