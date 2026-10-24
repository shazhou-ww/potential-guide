import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  atomicWrite,
  CliError,
  type GlobalOptions,
  loadConfig,
  markdownInlineCode,
  markdownText,
  option,
  rejectUnknownOptions,
  reportOptions,
  requiredSetting,
  showCommandHelp,
  writeResult,
} from "@potential-guide/cli-core";
import { pilotSourceBudgets, withPilot } from "@potential-guide/cli-runtime";
import { startEffect } from "@potential-guide/effects";
import { selectObjective } from "@potential-guide/objective-declarations";
import {
  type Envelope,
  fileResources,
  loadPilotSpec,
  observe,
  type PilotObservation,
  type PilotSpec,
  isObjectivePackageName,
} from "@potential-guide/objective-pilot";

export function observationMarkdown(
  value: Envelope<PilotObservation>,
  spec: PilotSpec,
  language = spec.manifest.defaultLanguage,
): string {
  const lines = ["# Observation", "", `- Objective: ${markdownInlineCode(spec.objectiveId)}`];
  if (value.status !== 200 || value.payload === null) {
    lines.push(
      "- Status: observation failed; completion could not be determined.",
      `- Cause: ${markdownText(value.message)}`,
      "- Next action: inspect the failing check and its report, then rerun this probe.",
    );
    return lines.join("\n");
  }
  const observation = value.payload;
  const terminal = observation.current.levelId === spec.manifest.levels.at(-1)?.id;
  lines.push(
    `- Status: ${terminal ? "complete - terminal reached." : "observed - Objective not yet complete."}`,
    `- Current level: ${markdownInlineCode(observation.current.levelId)}`,
    `- Problems: ${observation.problems.length}`,
  );
  const pages = spec.locales[language] ?? {};
  const references = new Set<string>([`levels/${observation.current.levelId}`]);
  if (observation.problems.length > 0) {
    lines.push("", "## Problems", "");
    for (const problem of observation.problems) {
      if (problem.kind === "dependency") {
        lines.push(
          `- Dependency: ${markdownInlineCode(problem.objectiveId)}; current ${markdownInlineCode(problem.currentLevelId)}; required ${markdownInlineCode(problem.expectedLevelId)}.`,
        );
      } else {
        const scoped = `levels/${problem.ref.levelId}/checks/${problem.ref.checkId}/problems/${problem.ref.problemId}`;
        const id = pages[scoped] === undefined ? `problems/${problem.ref.problemId}` : scoped;
        references.add(id);
        const page = pages[id];
        const description =
          typeof problem.parameters.description === "string" &&
          problem.parameters.description.trim()
            ? problem.parameters.description
            : page?.description;
        lines.push(
          `- Problem: ${markdownInlineCode(problem.ref.problemId)}; check: ${markdownInlineCode(problem.ref.checkId)}; level: ${markdownInlineCode(problem.ref.levelId)}${description === undefined ? "." : ` - ${markdownText(description)}`}`,
        );
      }
    }
  }
  lines.push("", "## References", "");
  for (const id of references)
    lines.push(
      `- Reference: ${markdownInlineCode(id)}; language: ${markdownInlineCode(language)}.`,
    );
  const guidance = pages[`levels/${observation.current.levelId}`];
  if (!terminal && guidance?.content.trim())
    lines.push("", "## Guidance", "", markdownText(guidance.content));
  lines.push(
    "",
    `- Next action: ${terminal ? "no repair is needed for this observation." : "review the listed Pilot references, address the problems, then rerun this probe with the same Objective and input."}`,
  );
  return lines.join("\n");
}

async function loadStaticPilot(path: string) {
  try {
    const entry = resolve(path);
    const directory = basename(entry) === "objective.yaml" ? dirname(entry) : entry;
    let metadata: unknown;
    try {
      metadata = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (metadata !== undefined) {
      if (
        !metadata ||
        typeof metadata !== "object" ||
        !("name" in metadata) ||
        typeof metadata.name !== "string" ||
        !isObjectivePackageName(metadata.name)
      )
        throw new Error("Objective package.json needs a valid actual package name.");
      const prefix = `npm-objective:///${encodeURIComponent(metadata.name)}/`;
      const local = (uri: string) => {
        if (!uri.startsWith(prefix)) throw new Error("Static resource escapes its Objective.");
        const name = decodeURIComponent(uri.slice(prefix.length));
        if (name.split("/").some((part) => part === "." || part === ".." || /[\\:]/.test(part)))
          throw new Error("Unsafe static Objective resource.");
        return pathToFileURL(join(directory, ...name.split("/"))).href;
      };
      return loadPilotSpec(metadata.name, {
        version: "working-tree",
        readText: (uri) => fileResources.readText(local(uri)),
        readPages: async (uri) =>
          (await fileResources.readPages(local(uri))).map((page) => ({
            ...page,
            uri: `${prefix}${relative(directory, fileURLToPath(page.uri)).split("\\").join("/")}`,
          })),
      });
    }
    return await loadPilotSpec(directory, fileResources);
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
  const loaded = await loadConfig(globals.cwd, ["pilot", "cli-core", "objectives"]);
  const selected = await selectObjective(argv, globals, loaded.value);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  let markdown = "";
  const value = await (async () => {
    try {
      return await withPilot(
        selected.location,
        globals.cwd,
        option(argv, "--revision") as string | undefined,
        async (spec, runtime) => {
          const subject = await selected.subject(spec);
          const observation = await startEffect(
            observe({ spec, subject, ...(language === undefined ? {} : { language }) }, runtime),
            controller.signal,
          ).await();
          if (globals.format !== "json")
            markdown = observationMarkdown(observation, spec, language);
          return observation;
        },
        {
          ...pilotSourceBudgets(
            requiredSetting<Parameters<typeof pilotSourceBudgets>[0]>(loaded.value, "pilot.probe"),
          ),
          signal: controller.signal,
          packageSpecs: requiredSetting<Record<string, string>>(loaded.value, "objectives.aliases"),
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
  writeResult(value, globals.format, markdown);
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
  const packageName = basename(root).toLowerCase();
  if (!isObjectivePackageName(packageName))
    throw new CliError("Scaffold directory basename must be a valid npm package name.");
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
  const level = (option(argv, "--level") as string | undefined) ?? "ready";
  const check = option(argv, "--check") as string | undefined;
  const problems = option(argv, "--problem", { multiple: true }) as string[];
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(level) ||
    ["initial", "terminal"].includes(level) ||
    (check !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(check)) ||
    problems.some((problem) => !/^[a-z0-9][a-z0-9-]*$/.test(problem))
  )
    throw new CliError("Level, check and problem IDs must be lowercase kebab-case.");
  if ((check === undefined && problems.length > 0) || new Set(problems).size !== problems.length)
    throw new CliError("Problems require one check and must be unique.");
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: packageName,
        version: "0.1.0",
        type: "module",
        scripts: { build: "node build.mjs" },
        files: ["objective.yaml", "references", "checks"],
        engines: { node: ">=22.13.0" },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(root, ".gitignore"), "dist/\nnode_modules/\n");
  await writeFile(
    join(root, "build.mjs"),
    `import {cp,mkdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
const output="dist/package";
await mkdir(output,{recursive:true});
for(const name of ["objective.yaml","references"])await cp(name,join(output,name),{recursive:true});
const manifest=JSON.parse(await readFile("package.json","utf8"));
delete manifest.scripts;
await writeFile(join(output,"package.json"),JSON.stringify(manifest,null,2)+"\\n");
${
  check === undefined
    ? ""
    : `await mkdir(join(output,"checks",${JSON.stringify(check)}),{recursive:true});
await cp(${JSON.stringify(`src/${check}.cjs`)},join(output,"checks",${JSON.stringify(check)},"worker.cjs"));`
}
`,
  );
  await writeFile(
    join(root, "objective.yaml"),
    `$schema: https://shazhou-ww.github.io/potential-guide/schemas/objective/v3.json\nsubjectSchema:\n  type: object\nlevels:\n  - id: ${level}\n    checks:${check === undefined ? " []" : `\n      - id: ${check}\n        problems: [${problems.join(", ")}]`}\ndefaultLanguage: ${languages[0]}\nlanguages: [${languages.join(", ")}]\n`,
  );
  for (const language of languages) {
    const pages: [string, string][] = [
      ["system/overview", page("Generated Pilot", "TODO: describe this Objective Pilot.")],
      ["system/404", page("Not found", "The requested Reference does not exist.")],
      [
        `levels/${level}`,
        page(
          "Business level",
          "TODO: describe this attained level.",
          "TODO: describe attainment conditions.",
        ),
      ],
      ["levels/initial", page("Initial", "No business level has been attained.")],
      [
        "levels/terminal",
        page("Highest level alias", "terminal targets the highest declared business level."),
      ],
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
    const executable = join(root, "src", `${check}.cjs`);
    await mkdir(dirname(executable), { recursive: true });
    await writeFile(
      executable,
      `exports.execute = async function execute(subject, context) {\n  context.signal.throwIfAborted();\n  // TODO: inspect subject; register request-owned cleanup with context.defer.\n  return {status:200,payload:{ok:true,problems:[]},message:""};\n};\n`,
    );
  }
  writeResult(
    {
      schemaVersion: 1,
      status: "created",
      directory: root,
      manifest: join(root, "objective.yaml"),
    },
    globals.format,
    [
      "# Pilot scaffold created",
      "",
      "- Action: created Objective Pilot skeleton.",
      `- Directory: ${markdownInlineCode(root)}`,
      `- Manifest: ${markdownInlineCode(join(root, "objective.yaml"))}`,
      `- Languages: ${languages.map(markdownInlineCode).join(", ")}`,
      `- Business level: ${markdownInlineCode(level)}`,
      `- Check: ${check === undefined ? "none" : markdownInlineCode(check)}`,
      `- Next action: replace TODO guidance${check === undefined ? "" : " and implement the generated check"}, explicitly run npm run build in the package, then run ${markdownInlineCode(`pguide validate pilot "${join(root, "dist", "package")}"`)} and probe that built package. Commit source, not generated workers.`,
    ].join("\n"),
  );
}

export async function runValidate(argv: string[], globals: GlobalOptions): Promise<void> {
  if (globals.help) {
    showCommandHelp("validate", globals);
    return;
  }
  rejectUnknownOptions(argv, {}, 2);
  if (argv[0] !== "pilot" || argv[1] === undefined)
    throw new CliError(
      "Expected validate pilot <manifest>; legacy Guide manifests are incompatible.",
    );
  const objective = await loadStaticPilot(resolve(globals.cwd, argv[1]));
  const value = { schemaVersion: 1, status: "valid", objectiveId: objective.objectiveId };
  writeResult(
    value,
    globals.format,
    [
      "# Pilot validation",
      "",
      "- Status: valid.",
      `- Objective: ${markdownInlineCode(objective.objectiveId)}`,
      `- Manifest: ${markdownInlineCode(resolve(globals.cwd, argv[1]))}`,
      "- Scope: manifest and localized references; checks were not executed.",
      `- Languages: ${objective.manifest.languages.map(markdownInlineCode).join(", ")}`,
      "- Next action: commit the Pilot, then probe it with a subject to observe its current level.",
    ].join("\n"),
  );
}
