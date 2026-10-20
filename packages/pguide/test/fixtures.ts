import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

export const root = resolve(import.meta.dirname, "..", "..", "..");
export const scratch = join(root, ".cache");
await mkdir(scratch, { recursive: true });
export const commandPackage = (name: string) =>
  name === "regulate" || name === "continue"
    ? "pguide-regulate"
    : name === "supervise"
      ? "pguide-supervise"
      : name === "objectives"
        ? "pguide-objectives"
        : "pguide-pilot";
export const bin = (name: string) =>
  join(root, "packages", commandPackage(name), "dist", "bin", `${name}.js`);
const execute = promisify(execFile);
export async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execute("git", ["-C", cwd, ...args], { windowsHide: true })).stdout.trim();
}
export function run(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  input?: string,
) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      env: {
        ...env,
        APPDATA: join(scratch, "isolated-user-config"),
        XDG_CONFIG_HOME: join(scratch, "isolated-user-config"),
        HOME: join(scratch, "isolated-user-home"),
      },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => done({ code: code ?? 70, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
  });
}
export async function fixture(baseDirectory = scratch) {
  const directory = await mkdtemp(join(baseDirectory, "pguide-test-"));
  const repository = join(directory, "repository");
  await mkdir(repository);
  await git(repository, "init", "-q");
  await git(repository, "config", "user.name", "Fixture");
  await git(repository, "config", "user.email", "fixture@example.invalid");
  await git(repository, "remote", "add", "origin", pathToFileURL(repository).href);
  const scaffold = await run(bin("scaffold"), [
    "pilot",
    join(repository, "objective"),
    "--check",
    "ready",
    "--problem",
    "not-ready",
    "--language",
    "en-US",
    "--language",
    "zh-CN",
    "--format",
    "json",
  ]);
  if (scaffold.code !== 0) throw new Error(scaffold.stdout + scaffold.stderr);
  const manifest = join(repository, "objective", "pilot.yaml");
  const uri = `git+${pathToFileURL(repository).href}#objective/`;
  const subject = join(directory, "subject.json");
  await writeFile(subject, "{}");
  async function commit() {
    await git(repository, "add", ".");
    await git(repository, "commit", "-qm", "Fixture");
    return git(repository, "rev-parse", "HEAD");
  }
  return { directory, repository, manifest, uri, subject, commit };
}
export async function page(repository: string, id: string, language: string, content: string) {
  const path = join(repository, "objective", "references", ...id.split("/"), `${language}.md`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `---\ntitle: Fixture\ndescription: Fixture reference\nreferences: []\n---\n\n${content}\n`,
  );
}
