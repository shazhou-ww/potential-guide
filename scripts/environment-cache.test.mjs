import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { environmentCacheInputs } from "./environment-cache-inputs.mjs";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));

async function snapshot(directory, prefix = "") {
  const entries = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) entries.push(...(await snapshot(join(directory, entry.name), name)));
    else entries.push([name, (await readFile(join(directory, entry.name))).toString("base64")]);
  }
  return entries;
}

test("real environment build: normalized Git/Turbo hit, binary/rule invalidation and old-cache rejection", {
  timeout: 240_000,
}, async () => {
  await mkdir(join(root, ".cache"), { recursive: true });
  const sandbox = await mkdtemp(join(root, ".cache", "environment-cache-"));
  const environment = join(sandbox, "packages", "check-environment");
  const original = join(root, "packages", "check-environment");
  try {
    await mkdir(environment, { recursive: true });
    for (const path of [
      "build.mjs",
      "prepare.mjs",
      "verify.mjs",
      "src",
      "references",
      "tools.check.build.yaml",
      "directories.check.build.yaml",
      "network.check.build.yaml",
    ])
      await cp(join(original, path), join(environment, path), { recursive: true });
    await cp(join(root, "LICENSE"), join(sandbox, "LICENSE"));
    await cp(join(root, "LICENSE"), join(environment, "LICENSE"));
    const linkType = process.platform === "win32" ? "junction" : "dir";
    await symlink(join(root, "node_modules"), join(sandbox, "node_modules"), linkType);
    await mkdir(join(environment, "node_modules", "@potential-guide"), { recursive: true });
    await mkdir(join(environment, "node_modules", "@sinclair"), { recursive: true });
    for (const name of [
      "@potential-guide/check-sdk",
      "@potential-guide/task-sdk",
      "@potential-guide/task-protocol",
      "@potential-guide/pguide-task-bundle",
      "@sinclair/typebox",
      "yaml",
    ])
      await symlink(
        await realpath(join(original, "node_modules", name)),
        join(environment, "node_modules", name),
        linkType,
      );
    const tsconfig = JSON.parse(await readFile(join(original, "tsconfig.json"), "utf8"));
    tsconfig.extends = join(root, "tsconfig.base.json");
    tsconfig.compilerOptions.tsBuildInfoFile = "dist/build.tsbuildinfo";
    await writeFile(join(environment, "tsconfig.json"), JSON.stringify(tsconfig));
    await writeFile(
      join(sandbox, "package.json"),
      JSON.stringify({ private: true, packageManager: "pnpm@11.22.0" }),
    );
    await writeFile(
      join(sandbox, "pnpm-workspace.yaml"),
      "packages: [packages/*]\nverifyDepsBeforeRun: false\n",
    );
    await writeFile(
      join(sandbox, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/check-environment: {}\n",
    );
    await writeFile(join(sandbox, ".gitattributes"), "* text=auto eol=lf\n");
    await writeFile(join(sandbox, ".gitignore"), "node_modules/\ndist/\n.cache/\n.turbo/\n");
    const manifest = JSON.parse(await readFile(join(original, "package.json"), "utf8"));
    await writeFile(
      join(environment, "package.json"),
      JSON.stringify({
        name: manifest.name,
        type: "module",
        scripts: {
          build: `${manifest.scripts.build} && node poison.mjs`,
          verify: manifest.scripts.verify,
        },
      }),
    );
    const config = JSON.parse(await readFile(join(root, "turbo.json"), "utf8"));
    await mkdir(join(sandbox, "scripts"));
    await cp(
      join(root, "scripts/environment-cache-inputs.mjs"),
      join(sandbox, "scripts/environment-cache-inputs.mjs"),
    );
    const build = config.tasks["@potential-guide/check-environment#build"];
    for (const path of [
      "packages/task-protocol/src",
      "packages/pguide-task-bundle/src",
      "packages/check-sdk/src",
    ])
      await cp(join(root, path), join(sandbox, path), { recursive: true });
    await writeFile(
      join(sandbox, "turbo.json"),
      JSON.stringify({
        tasks: {
          "@potential-guide/check-environment#build": {
            ...build,
            dependsOn: [],
            passThroughEnv: ["IDENTITY_POISON"],
          },
          "@potential-guide/check-environment#verify":
            config.tasks["@potential-guide/check-environment#verify"],
        },
      }),
    );
    await writeFile(
      join(environment, "poison.mjs"),
      `
import {readFile,writeFile} from "node:fs/promises";
import {encodeContentCar} from "@potential-guide/pguide-task-bundle/car";
import {readTaskArtifact} from "@potential-guide/pguide-task-bundle/artifact";
if(process.env.IDENTITY_POISON==="1") {
 const path="dist/candidate/tools";
 const snapshot=await readTaskArtifact(path);
 const files=new Map(snapshot.files);
 const {parse,stringify}=await import("yaml");
 const declaration=parse(files.get("task.yaml").toString());delete declaration.binary;
 files.set("task.yaml",Buffer.from(stringify(declaration)));
 const page="resources/references/en/check.md";
 files.set(page,Buffer.from(files.get(page).toString().replaceAll("\\n","\\r\\n")));
 for(const [name,bytes] of files)await writeFile(path+"/"+name,bytes);
 const car=await encodeContentCar(files);await writeFile(path+".car",car.bytes);
 const refs=JSON.parse(await readFile("dist/candidate/references.json","utf8"));
 refs.tools.cid=car.cid;await writeFile("dist/candidate/references.json",JSON.stringify(refs));
}
`,
    );
    const git = (...args) => execute("git", args, { cwd: sandbox });
    await git("init", "--quiet");
    await git("config", "core.autocrlf", "false");
    const page = join(environment, "references", "tools", "en", "check.md");
    const lf = (await readFile(page, "utf8")).replaceAll("\r\n", "\n");
    await writeFile(page, lf.replaceAll("\n", "\r\n"));
    await git("add", ".");
    const hash = () =>
      git("hash-object", "--path=packages/check-environment/references/tools/en/check.md", page);
    const crlfHash = (await hash()).stdout;
    const turbo = async (cache, poison = false) =>
      execute(
        process.execPath,
        [
          join(root, "node_modules", "turbo", "bin", "turbo"),
          "run",
          "verify",
          "--filter=@potential-guide/check-environment",
          "--cache=local:rw",
          `--cache-dir=${cache}`,
          "--output-logs=full",
        ],
        {
          cwd: sandbox,
          env: {
            ...process.env,
            IDENTITY_POISON: poison ? "1" : "0",
            PGUIDE_ENVIRONMENT_BINARY_INPUTS: await environmentCacheInputs(sandbox),
          },
          maxBuffer: 8 * 1024 * 1024,
        },
      );
    const cache = join(sandbox, ".cache", "good");
    const cold = await turbo(cache);
    assert.match(cold.stdout, /cache miss/);
    const refs = await readFile(join(environment, "dist/bundles/references.json"), "utf8");
    await writeFile(page, lf);
    assert.equal((await hash()).stdout, crlfHash);
    await rm(join(environment, "dist"), { recursive: true, force: true });
    const hit = await turbo(cache);
    assert.match(hit.stdout, /cache hit/);
    assert.equal(await readFile(join(environment, "dist/bundles/references.json"), "utf8"), refs);
    const missingIdentity = JSON.parse(refs);
    delete missingIdentity.tools.cid;
    await writeFile(
      join(environment, "dist/bundles/references.json"),
      JSON.stringify(missingIdentity),
    );
    await assert.rejects(
      execute(process.execPath, ["verify.mjs", "--accepted"], { cwd: environment }),
      /invalid artifact paths/,
    );
    await writeFile(join(environment, "dist/bundles/references.json"), refs);
    const buildFile = join(environment, "tools.check.build.yaml");
    await writeFile(
      buildFile,
      `${await readFile(buildFile, "utf8")}\nbinary: [resources/references/en/check.md]\n`,
    );
    const binary = await turbo(cache);
    assert.match(binary.stdout, /build: cache miss/);
    assert.notEqual(
      await readFile(join(environment, "dist/bundles/references.json"), "utf8"),
      refs,
    );
    const binaryRefs = await readFile(join(environment, "dist/bundles/references.json"), "utf8");
    await writeFile(page, lf.replaceAll("\n", "\r\n"));
    assert.equal((await hash()).stdout, crlfHash);
    assert.match((await turbo(cache)).stdout, /build: cache miss/);
    assert.notEqual(
      await readFile(join(environment, "dist/bundles/references.json"), "utf8"),
      binaryRefs,
    );
    assert.match((await turbo(cache)).stdout, /build: cache hit/);
    const rule = join(sandbox, "packages/task-protocol/src/bundle-content.ts");
    await writeFile(rule, `${await readFile(rule, "utf8")}\n// Cache rule revision probe.\n`);
    assert.match((await turbo(cache)).stdout, /build: cache miss/);
    const oldCache = join(sandbox, ".cache", "old");
    const accepted = await snapshot(join(environment, "dist/bundles"));
    await writeFile(page, lf);
    await assert.rejects(turbo(oldCache, true), (error) =>
      /binary.*Rebuild/.test(error.stdout + error.stderr),
    );
    assert.deepEqual(await snapshot(join(environment, "dist/bundles")), accepted);
    await assert.rejects(
      execute(process.execPath, ["verify.mjs", "--accepted"], { cwd: environment }),
      /resource bytes differ/,
    );
    await rm(join(environment, "dist/candidate"), { recursive: true, force: true });
    await assert.rejects(turbo(oldCache), (error) => {
      assert.match(error.stdout, /build: cache hit/);
      assert.match(error.stdout + error.stderr, /binary.*Rebuild/);
      return true;
    });
    assert.deepEqual(await snapshot(join(environment, "dist/bundles")), accepted);
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 5 });
  }
});
