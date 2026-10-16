import { chmod, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  atomicWrite,
  CliError,
  type CommandMetadata,
  commandMain,
  type GlobalOptions,
  option,
  readJsonSubject,
  rejectUnknownOptions,
  writeResult,
} from "@potential-guide/cli-core";
import { startEffect } from "@potential-guide/effects";
import {
  fileResources,
  loadPilotSpec,
  observe,
  type Subject,
} from "@potential-guide/objective-pilot";
import { withPilot } from "../pilot-source.js";

export const pilotCommandVersion = "0.3.0-rc.0";

async function loadStaticPilot(path: string) {
  try {
    return await loadPilotSpec(path, fileResources);
  } catch (error) {
    throw new CliError(
      error instanceof Error ? error.message : "Pilot could not be loaded.",
      2,
      "pilot-error",
    );
  }
}

export async function runProbe(argv: string[], globals: GlobalOptions): Promise<number | void> {
  if (globals.help) {
    writeResult(
      {
        schemaVersion: 1,
        command: "probe",
        options: ["--pilot", "--subject-file", "--language", "--revision", "--report"],
      },
      globals.format,
      "Usage: pguide probe --pilot <path|Git URI> --subject-file <path|-> [--language <tag>] [--revision <ref|commit>]",
    );
    return;
  }
  rejectUnknownOptions(argv, {
    "--pilot": "value",
    "--subject-file": "value",
    "--language": "value",
    "--revision": "value",
    "--report": "value",
  });
  const subject = (await readJsonSubject(
    option(argv, "--subject-file", { required: true }) as string,
    globals.cwd,
  )) as Subject;
  const language = option(argv, "--language") as string | undefined;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const value = await (async () => {
    try {
      return await withPilot(
        option(argv, "--pilot", { required: true }) as string,
        globals.cwd,
        option(argv, "--revision") as string | undefined,
        (spec, runtime) =>
          startEffect(
            observe({ spec, subject, ...(language === undefined ? {} : { language }) }, runtime),
            controller.signal,
          ).await(),
      );
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
  })();
  const report = option(argv, "--report") as string | undefined;
  if (report !== undefined)
    await atomicWrite(resolve(globals.cwd, report), `${JSON.stringify(value, null, 2)}\n`);
  writeResult(
    value,
    globals.format,
    value.status === 200 && value.payload !== null
      ? `# Observation\n\nCurrent level: \`${value.payload.current.levelId}\`\n\n${value.payload.gapSummary}`
      : `Pilot invocation failed: ${value.message}`,
  );
  return value.status === 200 && value.payload !== null ? 0 : 6;
}

function page(
  title: string,
  description: string,
  content = "TODO: replace this generated guidance.",
): string {
  return `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\nreferences: []\n---\n\n${content}\n`;
}

export async function runScaffold(argv: string[], globals: GlobalOptions): Promise<void> {
  if (globals.help) {
    writeResult(
      { schemaVersion: 1, command: "scaffold", types: ["pilot"] },
      globals.format,
      "Usage: pguide scaffold pilot <directory> [--language <tag>] [--level <id>] [--check <id>] [--problem <id>]",
    );
    return;
  }
  if (argv[0] !== "pilot" || argv[1] === undefined)
    throw new CliError(
      "Expected scaffold pilot <directory>; legacy Guide scaffolds are incompatible.",
    );
  const root = resolve(globals.cwd, argv[1]);
  try {
    if ((await stat(root)).isDirectory() && (await readdir(root)).length > 0)
      throw new CliError("Scaffold destination must not exist or must be empty.");
  } catch (error) {
    if (error instanceof CliError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const languages = option(argv, "--language", { multiple: true }) as string[];
  if (languages.length === 0) languages.push("en-US");
  if (
    new Set(languages).size !== languages.length ||
    languages.some((language) => !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language))
  )
    throw new CliError("Languages must be unique BCP 47 language tags.");
  try {
    for (const language of languages) Intl.getCanonicalLocales(language);
  } catch {
    throw new CliError("Languages must be valid BCP 47 language tags.");
  }
  const level = (option(argv, "--level") as string | undefined) ?? "initial";
  const check = option(argv, "--check") as string | undefined;
  const problems = option(argv, "--problem", { multiple: true }) as string[];
  if (
    !/^[a-z0-9][a-z0-9-]*$/.test(level) ||
    (check !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(check)) ||
    problems.some((problem) => !/^[a-z0-9][a-z0-9-]*$/.test(problem))
  )
    throw new CliError("Level, check and problem IDs must be lowercase kebab-case.");
  if ((check === undefined && problems.length > 0) || new Set(problems).size !== problems.length)
    throw new CliError("Problems require one check and must be unique.");
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "pilot.yaml"),
    `schemaVersion: 1\ndomainSchema:\n  type: object\nlevels:\n  - id: ${level}\n    advancement:\n      checks:${check === undefined ? " []" : `\n        - id: ${check}\n          problems: [${problems.join(", ")}]`}\ndefaultLanguage: ${languages[0]}\nlanguages: [${languages.join(", ")}]\n`,
  );
  for (const language of languages) {
    const pages: [string, string][] = [
      ["system/overview", page("Generated Pilot", "TODO: describe this Objective Pilot.")],
      ["system/404", page("Not found", "The requested Reference does not exist.")],
      [
        `levels/${level}`,
        page("Initial", "TODO: describe this level.", "TODO: describe advancement."),
      ],
      ["levels/terminal", page("Complete", "The Objective is complete.")],
    ];
    if (check !== undefined)
      pages.push([`checks/${check}`, page("Generated check", "TODO: describe this check.")]);
    for (const problem of problems)
      pages.push([
        `problems/${problem}`,
        page("Generated problem", "TODO: describe this problem."),
      ]);
    for (const [id, source] of pages) {
      const path = join(root, "references", ...id.split("/"), `${language}.md`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, source);
    }
  }
  if (check !== undefined) {
    const executable = join(root, "checks", check, "run.js");
    await mkdir(dirname(executable), { recursive: true });
    await writeFile(
      executable,
      '#!/usr/bin/env node\nlet source="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>source+=c);process.stdin.on("end",()=>{JSON.parse(source);process.stdout.write(JSON.stringify({status:200,payload:{ok:true,problems:[]},message:""}));});\n',
    );
    if (process.platform !== "win32") await chmod(executable, 0o755);
  }
  writeResult(
    {
      schemaVersion: 1,
      status: "created",
      directory: root,
      manifest: join(root, "pilot.yaml"),
    },
    globals.format,
    `Created Objective Pilot skeleton at ${root}.`,
  );
}

export async function runValidate(argv: string[], globals: GlobalOptions): Promise<void> {
  if (globals.help) {
    writeResult(
      { schemaVersion: 1, command: "validate", types: ["pilot"] },
      globals.format,
      "Usage: pguide validate pilot <pilot.yaml>",
    );
    return;
  }
  if (argv[0] !== "pilot" || argv[1] === undefined)
    throw new CliError(
      "Expected validate pilot <manifest>; legacy Guide manifests are incompatible.",
    );
  const pilot = await loadStaticPilot(resolve(globals.cwd, argv[1]));
  const value = { schemaVersion: 1, status: "valid", objectiveId: pilot.objectiveId };
  writeResult(value, globals.format, `Valid Objective Pilot: ${pilot.objectiveId}`);
}

export function launchPilotCommand(
  metadata: CommandMetadata,
  run: (argv: string[], globals: GlobalOptions) => Promise<number | void>,
): void {
  void commandMain(metadata, run);
}
