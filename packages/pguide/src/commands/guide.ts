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
  writeResult,
} from "@potential-guide/cli-core";
import { createObjectiveLoader, type ObjectiveSubject } from "@potential-guide/objective-guide";

export const guideCommandVersion = "0.2.0-rc.1";

async function loadGuide(path: string) {
  try {
    return await createObjectiveLoader().load(path);
  } catch (error) {
    throw new CliError(
      error instanceof Error ? error.message : "Guide could not be loaded.",
      2,
      "guide-error",
    );
  }
}

async function createInstance(argv: string[], globals: GlobalOptions) {
  const guidePath = option(argv, "--guide", { required: true }) as string;
  const subjectPath = option(argv, "--subject-file", { required: true }) as string;
  const language = option(argv, "--language") as string | undefined;
  const guide = await loadGuide(resolve(globals.cwd, guidePath));
  const created = guide.createInstance({
    subject: (await readJsonSubject(subjectPath, globals.cwd)) as ObjectiveSubject,
    ...(language === undefined ? {} : { language }),
  });
  if (!created.ok) throw new CliError(`Cannot create Guide instance: ${created.error.type}.`);
  return created.instance;
}

export async function runProbe(argv: string[], globals: GlobalOptions): Promise<void> {
  if (globals.help) {
    writeResult(
      {
        schemaVersion: 1,
        command: "probe",
        options: ["--guide", "--subject-file", "--language", "--report"],
      },
      globals.format,
      "Usage: pguide probe --guide <path> --subject-file <path|-> [--language <tag>]",
    );
    return;
  }
  const observation = await (await createInstance(argv, globals)).probe();
  const value = {
    schemaVersion: 1,
    status: "observed",
    currentLevelId: observation.current.id,
    gapSummary: observation.gapSummary,
    problems: observation.problems,
  };
  const report = option(argv, "--report") as string | undefined;
  if (report !== undefined)
    await atomicWrite(resolve(globals.cwd, report), `${JSON.stringify(value, null, 2)}\n`);
  writeResult(
    value,
    globals.format,
    `# Observation\n\nCurrent level: \`${observation.current.id}\`\n\n${observation.gapSummary}`,
  );
}

function page(title: string, description: string, outcome?: string): string {
  return `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}${outcome === undefined ? "" : `\noutcome: ${JSON.stringify(outcome)}`}\n---\n\nTODO: replace this generated guidance.\n`;
}

export async function runScaffold(argv: string[], globals: GlobalOptions): Promise<void> {
  if (globals.help) {
    writeResult(
      { schemaVersion: 1, command: "scaffold", types: ["guide"] },
      globals.format,
      "Usage: pguide scaffold guide <directory> [--language <tag>] [--level <id>] [--check <id>] [--problem <id>]",
    );
    return;
  }
  if (argv[0] !== "guide" || argv[1] === undefined)
    throw new CliError("Expected scaffold guide <directory>.");
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
    join(root, "objective-guide.yaml"),
    `schemaVersion: 1\ndomainSchema:\n  type: object\nlevels:\n  - id: ${level}\n    advancement:\n      checks:${check === undefined ? " []" : `\n        - id: ${check}\n          problems: [${problems.join(", ")}]`}\ndefaultLanguage: ${languages[0]}\nlanguages: [${languages.join(", ")}]\n`,
  );
  for (const language of languages) {
    const pages: [string, string][] = [
      ["system/overview", page("Generated Guide", "TODO: describe this Objective Guide.")],
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
      '#!/usr/bin/env node\nlet source="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>source+=c);process.stdin.on("end",()=>{JSON.parse(source);process.stdout.write(JSON.stringify({pass:true}));});\n',
    );
    if (process.platform !== "win32") await chmod(executable, 0o755);
  }
  writeResult(
    {
      schemaVersion: 1,
      status: "created",
      directory: root,
      manifest: join(root, "objective-guide.yaml"),
    },
    globals.format,
    `Created Objective Guide skeleton at ${root}.`,
  );
}

export async function runValidate(argv: string[], globals: GlobalOptions): Promise<void> {
  if (globals.help) {
    writeResult(
      { schemaVersion: 1, command: "validate", types: ["guide"] },
      globals.format,
      "Usage: pguide validate guide <objective-guide.yaml>",
    );
    return;
  }
  if (argv[0] !== "guide" || argv[1] === undefined)
    throw new CliError("Expected validate guide <manifest>.");
  const guide = await loadGuide(resolve(globals.cwd, argv[1]));
  const value = { schemaVersion: 1, status: "valid", manifestUri: guide.manifestUri };
  writeResult(value, globals.format, `Valid Objective Guide: ${guide.manifestUri}`);
}

export function launchGuideCommand(
  metadata: CommandMetadata,
  run: (argv: string[], globals: GlobalOptions) => Promise<void>,
): void {
  void commandMain(metadata, run);
}
