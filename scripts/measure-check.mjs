import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import spawn from "cross-spawn";

const directory = resolve(process.argv[2] ?? ".");
const label = process.argv[3] ?? "check";
const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
const stages = manifest.scripts.check.split(" && ").map((command) => command.split(" ").at(-1));
const timings = [];
let current;
let pending = "";
const start = performance.now();
function line(text) {
  process.stdout.write(`${text}\n`);
  const stage = stages.find(
    (name) =>
      text.startsWith(`> ${manifest.name}@${manifest.version} ${name} `) ||
      text === `$ ${manifest.scripts[name]}`,
  );
  if (!stage) return;
  const now = performance.now();
  if (current) current.seconds = (now - current.start) / 1000;
  current = { stage, start: now };
  timings.push(current);
}
const code = await new Promise((accept, reject) => {
  const child = spawn("pnpm", ["check"], { cwd: directory, env: process.env, shell: false });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop();
    for (const text of lines) line(text);
  });
  child.stderr.pipe(process.stderr);
  child.on("error", reject);
  child.on("close", accept);
});
if (pending) line(pending);
const end = performance.now();
if (current) current.seconds = (end - current.start) / 1000;
const result = {
  label,
  revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim(),
  node: process.version,
  pnpm: execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--version"], {
    cwd: directory,
    encoding: "utf8",
    shell: process.platform === "win32",
  }).trim(),
  platform: `${process.platform}-${process.arch}`,
  seconds: (end - start) / 1000,
  code,
  stages: timings.map(({ stage, seconds }) => ({ stage, seconds })),
};
await mkdir(resolve(directory, ".check-metrics"), { recursive: true });
await writeFile(
  resolve(directory, ".check-metrics", `${label}.json`),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify(result));
process.exitCode = code ?? 1;
