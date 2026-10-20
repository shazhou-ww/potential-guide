import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../../../../../", import.meta.url));
const baseline = "345027e47f4b530e66539bae822b51b2728e3427";
const reusedBuild = "5ff1c5105681379d910703a6d66ec66d5b336e7a";
const git = (...args) => execFileSync("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
const oid = (revision, path) => git("rev-parse", `${revision}:${path}`).toString().trim();
const foundations = [
  "effects", "git-source", "objective-pilot", "objective-regulator",
  "objective-portfolio-supervisor", "pguide-cli-core", "pguide-config", "pguide",
].map((directory) => {
  const path = `packages/${directory}`;
  const sourceTree = oid(baseline, `${path}/src`);
  assert.equal(sourceTree, oid(reusedBuild, `${path}/src`));
  assert.equal(oid(baseline, `${path}/package.json`), oid(reusedBuild, `${path}/package.json`));
  const manifest = JSON.parse(git("show", `${baseline}:${path}/package.json`).toString());
  return { directory, name: manifest.name, version: manifest.version, sourceTree };
});
const archive = git("archive", "--format=tar", baseline,
  "packages", "objectives", "scripts", "package.json", "pnpm-workspace.yaml", "tsconfig.base.json");
console.log(JSON.stringify({
  baseline, reusedBuild,
  archiveSha256: createHash("sha256").update(archive).digest("hex"),
  setupSourceBlob: oid(baseline, "objectives/pguide-setup/setup-check.mjs"),
  setupTestBlob: oid(baseline, "packages/pguide/test/setup-objective.test.ts"),
  foundations,
  scope: "原始 archive 包含旧 objectives 与旧 setup 测试；未复制迁移后的 setup/self-check package 或其 runtime。",
  buildOrigin: "基础包 dist 来自整合提交5ff1c51工作树中完整 pnpm check 的 TypeScript/Turbo 构建；上述8包源码树与manifest逐一同345027e。仅复用这些dist与依赖链接，基线业务源码和测试均来自原始archive。",
  reproduction: "在独立短路径提取上述archive，按锁安装依赖并构建8个基础包，运行原 packages/pguide/test/setup-objective.test.ts 的六项 name pattern；本次实际为.cache/b，不带Git worktree。依赖junction仅unlink，不递归跟随。",
  pattern: "remote payload uses|real sanity|sanity invocation diagnostics|sanity timeout during",
  limitation: "基础包dist非独立从零构建，来源如上；路径/宿主环境可能影响时序。六项结果只证明该环境可复现，不是普遍平台结论或任意豁免。",
}, null, 2));
