import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import spawn from "cross-spawn";

const root = fileURLToPath(new URL("..", import.meta.url));
async function environmentInputs(directory) {
  const { environmentCacheInputs } = await import("./environment-cache-inputs.mjs");
  return environmentCacheInputs(directory);
}
export async function buildWorkspace(args = [], run = spawn.sync, cacheInputs = environmentInputs) {
  let acceptEnvironment = args.length === 0;
  if (args.length) {
    const plan = run("pnpm", ["exec", "turbo", "run", "build", ...args, "--dry=json"], {
      cwd: root,
      env: process.env,
      encoding: "utf8",
    });
    if (plan.error) throw plan.error;
    if (plan.status !== 0) throw new Error(plan.stderr || "Cannot inspect filtered build plan.");
    const tasks = JSON.parse(plan.stdout).tasks;
    if (
      !Array.isArray(tasks) ||
      tasks.length === 0 ||
      tasks.some((task) => !task || typeof task.taskId !== "string")
    )
      throw new Error("Invalid filtered build plan.");
    acceptEnvironment = tasks.some(
      (task) => task.taskId === "@potential-guide/check-environment#build",
    );
  }
  const env = { ...process.env };
  if (acceptEnvironment) env.PGUIDE_ENVIRONMENT_BINARY_INPUTS = await cacheInputs(root);
  const commands = [["exec", "turbo", "run", "build", ...args]];
  if (acceptEnvironment)
    commands.push([
      "exec",
      "turbo",
      "run",
      "verify",
      "--filter=@potential-guide/check-environment",
    ]);
  for (const command of commands) {
    const result = run("pnpm", command, { cwd: root, env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  if (args.length === 0) {
    const result = run(
      process.execPath,
      [join(root, "scripts", "run-probe-objectives.mjs"), "build"],
      {
        cwd: root,
        env,
        stdio: "inherit",
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await buildWorkspace(process.argv.slice(2));
