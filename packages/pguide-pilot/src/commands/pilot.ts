import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  atomicWrite,
  CliError,
  type GlobalOptions,
  loadConfig,
  option,
  rejectUnknownOptions,
  reportOptions,
  showCommandHelp,
  writeResult,
} from "@potential-guide/cli-core";
import { withPilot } from "@potential-guide/cli-runtime";
import { startEffect } from "@potential-guide/effects";
import { selectObjective } from "@potential-guide/objective-declarations";
import { fileResources, loadPilotSpec, observe } from "@potential-guide/objective-pilot";

async function loadStaticPilot(path: string) {
  try {
    const entry = resolve(path);
    return await loadPilotSpec(
      basename(entry) === "pilot.yaml" ? dirname(entry) : entry,
      fileResources,
    );
  } catch (error) {
    throw new CliError(
      error instanceof Error ? error.message : "Pilot could not be loaded.",
      2,
      "pilot-error",
    );
  }
}

export async function runProbe(
  argv: string[],
  globals: GlobalOptions,
): Promise<number | undefined> {
  if (globals.help) {
    showCommandHelp("probe", globals);
    return;
  }
  rejectUnknownOptions(argv, {
    "--pilot": "value",
    "--objective": "value",
    "--scope": "value",
    "--input-file": "value",
    "--subject-file": "value",
    "--language": "value",
    "--revision": "value",
    "--report": "value",
    "--report-dir": "value",
    "--no-reports": "flag",
  });
  const language = option(argv, "--language") as string | undefined;
  const loaded = await loadConfig(globals.cwd, globals.config);
  const selected = await selectObjective(argv, globals, loaded.value);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const value = await (async () => {
    try {
      return await withPilot(
        selected.location,
        globals.cwd,
        option(argv, "--revision") as string | undefined,
        async (spec, runtime) => {
          const subject = await selected.subject(spec);
          return startEffect(
            observe({ spec, subject, ...(language === undefined ? {} : { language }) }, runtime),
            controller.signal,
          ).await();
        },
        {
          probeTimeoutMs: loaded.value.regulationStrategy?.probe?.timeoutMs,
          reports: reportOptions(argv, loaded.value, globals.cwd),
        },
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
    showCommandHelp("scaffold", globals);
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
    const evidenceSource = await readFile(
      new URL("./evidence.js", import.meta.resolve("@potential-guide/objective-pilot")),
      "utf8",
    );
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(join(root, "runtime", "evidence.mjs"), evidenceSource);
    const executable = join(root, "checks", check, "run.js");
    await mkdir(dirname(executable), { recursive: true });
    await writeFile(
      executable,
      `#!/usr/bin/env node\nvoid (async () => {\nconst { withCheckEvidence, reportArguments } = await import("../../runtime/evidence.mjs");\nconst { options } = reportArguments(process.argv.slice(2));\nconst value = await withCheckEvidence(${JSON.stringify(check)}, async evidence => {\n  let source = "";\n  for await (const chunk of process.stdin) source += chunk;\n  JSON.parse(source);\n  evidence?.fact("assertion.passed", { assertion: "generated-placeholder" });\n  return {status:200,payload:{ok:true,problems:[]},message:""};\n}, options);\nprocess.stdout.write(JSON.stringify(value));\n})();\n`,
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
    showCommandHelp("validate", globals);
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
