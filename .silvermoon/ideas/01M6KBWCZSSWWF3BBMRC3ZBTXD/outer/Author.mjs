import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readTaskArtifact } from "@potential-guide/pguide-task-bundle/artifact";
import { buildTaskBundle } from "@potential-guide/pguide-task-bundle/build";

const execute = promisify(execFile);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.resolve("@potential-guide/pguide-task-bundle/build"))));
const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
assert.equal(manifest.pguide?.settings, undefined);
assert.equal(Object.hasOwn(manifest.exports, "./publish"), false);
const network = [];
globalThis.fetch = async (...args) => {
  network.push(String(args[0]));
  throw new Error("离线作者不允许网络请求。");
};
const resource = Buffer.from(Array.from({ length: 800_000 }, (_, i) => (i * 13 + Math.floor(i / 262_144)) % 251));
const payload = {
  path: "resources/nested/payload.bin",
  bytes: resource.length,
  sha256: createHash("sha256").update(resource).digest("hex"),
  sum: resource.reduce((sum, byte) => sum + byte, 0),
};
await writeFile("payload.bin", resource);
await writeFile("task.yaml", JSON.stringify({
  $schema: "https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json",
  name: "独立 CAR 交付验证",
  runtime: { type: "node", minVersion: "22.13.0" },
  entry: "worker.cjs",
  inputSchema: { type: "object", properties: { mode: { enum: ["ok", "missing-path", "missing-block", "cid-mismatch", "cancel", "outage"] } }, required: ["mode"], additionalProperties: false },
  resultSchema: { type: "object", properties: { mode: { type: "string" }, path: { type: "string" }, bytes: { type: "integer" }, sha256: { type: "string" }, sum: { type: "integer" } }, required: ["mode", "path", "bytes", "sha256", "sum"], additionalProperties: false },
  messageSchema: false,
}));
await writeFile("callback.mjs", `
import {createHash} from "node:crypto";
export default async(input,context)=>{
 const path=input.mode==="missing-path"?"resources/nested/absent.bin":"resources/nested/payload.bin";
 const hash=createHash("sha256");let bytes=0,sum=0;
 for await(const part of context.bundle.read(path)){bytes+=part.length;hash.update(part);for(const byte of part)sum+=byte;}
 return {mode:input.mode,path,bytes,sha256:hash.digest("hex"),sum};
};`);
const built = await buildTaskBundle({
  declaration: resolve("task.yaml"), entry: resolve("callback.mjs"),
  resources: { [payload.path]: resolve("payload.bin") }, outDirectory: resolve("bundle"),
});
const archive = await readFile(built.car);
assert.equal((await readTaskArtifact(built.car)).cid, built.cid);
const bin = fileURLToPath(import.meta.resolve("@potential-guide/pguide-task-bundle/bin/task-bundle"));
const help = JSON.parse((await execute(process.execPath, [bin, "--help", "--format", "json"])).stdout);
assert.deepEqual(help.subcommands, ["init", "check", "build"]);
const checked = JSON.parse((await execute(process.execPath, [bin, "check", "artifact", built.car, "--format", "json"])).stdout);
assert.equal(checked.result.cid, built.cid);
let removedCommand;
try {
  await execute(process.execPath, [bin, "publish", built.car, "--ipfs-rpc", "http://127.0.0.1:1"]);
  assert.fail("已移除的发布命令不得成功。");
} catch (error) {
  assert.equal(error.code, 2);
  removedCommand = { exitCode: error.code, stderr: error.stderr };
}
const removedExport = "@potential-guide/pguide-task-bundle/publish";
await assert.rejects(import(removedExport), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
assert.deepEqual(network, []);
await writeFile("author-proof.json", JSON.stringify({
  node: process.version, packageVersion: manifest.version, settingsRemoved: true,
  cid: built.cid, carFile: "bundle.car", carBytes: archive.length,
  carSha256: createHash("sha256").update(archive).digest("hex"), payload,
  files: checked.result.files, helpSubcommands: help.subcommands,
  artifactCheck: checked, removedCommand, removedExport: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  networkRequests: network,
}, null, 2));
for (const path of ["callback.mjs", "task.yaml", "payload.bin"]) await rm(path);
console.log(JSON.stringify({ cid: built.cid, carBytes: archive.length, authorSourcesRemoved: true }));
