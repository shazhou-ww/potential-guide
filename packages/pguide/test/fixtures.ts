import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { after, before } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parseConfig, parseLegacyConfig, validateAgentProfile } from "@potential-guide/cli-core";
import { CheckKernel, connectHost, serve } from "../../check-host/dist/index.js";

export const root = resolve(import.meta.dirname, "..", "..", "..");
export const scratch = join(root, ".cache");
await mkdir(scratch, { recursive: true });
const testHostDirectory = await mkdtemp(join(scratch, "pguide-suite-host-"));
const previousHostDirectory = process.env.PGUIDE_CHECK_HOST_DIRECTORY;
let testHost: Awaited<ReturnType<typeof serve>> | undefined;
before(async () => {
  const kernel = await CheckKernel.create(join(testHostDirectory, "snapshots"));
  const token = crypto.randomUUID();
  testHost = await serve(kernel, token);
  await writeFile(
    join(testHostDirectory, "host.json"),
    JSON.stringify({
      endpoint: testHost.endpoint,
      token,
      pid: process.pid,
      instance: crypto.randomUUID(),
    }),
    { flag: "wx" },
  );
  process.env.PGUIDE_CHECK_HOST_DIRECTORY = testHostDirectory;
  await connectHost(testHostDirectory);
});
after(async () => {
  await testHost?.close();
  if (previousHostDirectory === undefined) delete process.env.PGUIDE_CHECK_HOST_DIRECTORY;
  else process.env.PGUIDE_CHECK_HOST_DIRECTORY = previousHostDirectory;
  await rm(testHostDirectory, { recursive: true, force: true });
});
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
export function settingsFixture(source: string): Record<string, unknown> {
  if (source.trimStart().startsWith("{") && !Object.hasOwn(JSON.parse(source), "schemaVersion"))
    return parseConfig(source);
  const value = parseLegacyConfig(source);
  const settings: Record<string, unknown> = {};
  const scalar: Record<string, string> = {
    defaultAgent: "agents.defaultAgent",
    commandDirectories: "pguide.commandDirectories",
    stateDirectory: "cli-core.stateDirectory",
    defaultLanguage: "cli-core.defaultLanguage",
    format: "cli-core.format",
    color: "cli-core.color",
    logLevel: "cli-core.logLevel",
    retentionDays: "regulate.retentionDays",
    regulationPermissions: "regulate.permissions",
    objectives: "objectives.aliases",
  };
  for (const [key, entry] of Object.entries(value)) {
    if (key === "schemaVersion" && entry === 2) continue;
    if (key === "reports") {
      const reports = entry as { enabled?: boolean; directory?: string };
      if (reports.enabled !== undefined) settings["pilot.reportsEnabled"] = reports.enabled;
      if (reports.directory !== undefined) settings["pilot.reportDirectory"] = reports.directory;
    } else if (key === "agentExecutionLimits") {
      const timeout = (entry as { timeoutMs?: number }).timeoutMs;
      if (timeout !== undefined)
        for (const id of [
          "regulate.agentTimeoutMs",
          "supervise.agentTimeoutMs",
          "pguide.diagnoseAhpTimeoutMs",
        ])
          settings[id] = timeout;
    } else if (key === "regulationStrategy") {
      const strategy = entry as { probe?: unknown; quota?: unknown };
      if (strategy.probe !== undefined) settings["pilot.probe"] = strategy.probe;
      if (strategy.quota !== undefined) settings["regulate.quota"] = strategy.quota;
    } else settings[scalar[key] ?? key] = entry;
  }
  return settings;
}
export async function run(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  input?: string,
) {
  // Test-only fixture notation, never passed to the CLI. Existing execution
  // scenarios retain their data builders while running against real JSONC discovery.
  const configIndex = args.indexOf("--fixture-config");
  if (configIndex >= 0) {
    const config = args[configIndex + 1];
    if (!config) throw new Error("--fixture-config requires a test fixture file.");
    const cwdIndex = args.indexOf("--cwd");
    const cwd = cwdIndex >= 0 ? (args[cwdIndex + 1] as string) : dirname(config);
    const settings = settingsFixture(await readFile(config, "utf8"));
    await mkdir(join(cwd, ".pguide"), { recursive: true });
    await writeFile(join(cwd, ".pguide", "config.jsonc"), JSON.stringify(settings));
    args = [...args.slice(0, configIndex), ...args.slice(configIndex + 2)];
    if (cwdIndex < 0) args.push("--cwd", cwd);
  }
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
export async function writeConfig(path: string, source: string, cwd = dirname(path)) {
  const value = JSON.parse(source);
  if (Object.hasOwn(value, "agents")) {
    await mkdir(join(cwd, ".pguide"), { recursive: true });
    await writeFile(
      join(cwd, ".pguide", "agents.yaml"),
      JSON.stringify({
        $schema: "https://shazhou-ww.github.io/potential-guide/schemas/agents/v1.json",
        agents: Object.fromEntries(
          Object.entries(value.agents).map(([name, profile]) => [
            name,
            validateAgentProfile(profile),
          ]),
        ),
      }),
    );
    delete value.agents;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify(path.endsWith("config.jsonc") ? settingsFixture(JSON.stringify(value)) : value),
  );
}
export async function fixture(baseDirectory = scratch, prefix = "pguide-test-") {
  const directory = await mkdtemp(join(baseDirectory, prefix));
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
  const manifest = join(repository, "objective", "objective.yaml");
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
