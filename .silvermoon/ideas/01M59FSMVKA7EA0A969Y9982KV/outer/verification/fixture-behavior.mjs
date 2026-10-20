import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { sanity } from "/opt/objective/packages/pguide-setup-pilot/src/sanity.mjs";

const execute = promisify(execFile);
const directory = await mkdtemp("/work/runs/fixture-behavior-");
const stop = new Error("owned-fixture-observation-complete");
let observed = false;
try {
  const subject = { timeoutMs: 20000, workingDirectory: directory };
  await assert.rejects(sanity(subject, {
    async execute(command, args, options = {}) {
      const result = await execute(command, args, { cwd: options.cwd ?? directory });
      return { code: 0, stdout: result.stdout, stderr: result.stderr };
    },
    async cli(args) {
      assert.equal(args[0], "probe");
      const repository = join(directory, "fixture");
      await mkdir(join(repository, ".cache"));
      await writeFile(join(repository, ".cache", "owned-cache.txt"), "runtime scratch");
      const ignored = await execute("git", ["-C", repository, "check-ignore", "marker.txt", ".cache/owned-cache.txt"]);
      assert.deepEqual(ignored.stdout.trim().split("\n"), ["marker.txt", ".cache/owned-cache.txt"]);
      const status = await execute("git", ["-C", repository, "status", "--porcelain", "--untracked-files=all"]);
      assert.equal(status.stdout, "");
      const subjectFile = args[args.indexOf("--subject-file") + 1];
      const input = JSON.parse(await readFile(subjectFile, "utf8"));
      const probe = async () => {
        const result = await new Promise((resolve, reject) => {
          const child = execFile(process.execPath, [join(repository, "checks", "marker", "run.cjs")], (error, stdout) =>
            error ? reject(error) : resolve(JSON.parse(stdout)));
          child.stdin.end(JSON.stringify(input));
        });
        return result;
      };
      assert.equal((await probe()).payload.ok, false);
      await writeFile(input.marker, input.expected);
      assert.equal((await probe()).payload.ok, true);
      await writeFile(join(repository, "gitignore"), "not marker content");
      assert.equal((await probe()).payload.ok, true);
      observed = true;
      throw stop;
    },
  }, directory, {
    name: "unused-fixture",
    profile: {},
    config: { commandDirectories: [] },
  }), (error) => error === stop);
  assert.equal(observed, true);
} finally {
  await rm(directory, { recursive: true, force: true });
  assert.ok(!(await readdir("/work/runs")).includes(directory.split("/").at(-1)));
}
console.log(JSON.stringify({
  verified: true,
  actualMaterialization: true,
  markerAndCacheIgnored: true,
  cleanGitStatusAfterCacheWrite: true,
  markerCheckerIgnoresTemplateContents: true,
  ownedScratchRemoved: true,
  modelPrompts: 0,
}));
