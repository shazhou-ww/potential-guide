import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCheckArtifact } from "@potential-guide/check-artifacts/build";
import {
  inspectObjectiveArtifact,
  objectiveArtifactLocation,
  objectiveArtifactSchemaUri,
} from "../../dist/index.js";

const source = dirname(fileURLToPath(import.meta.url));
export async function buildExample(directory) {
  const root = resolve(directory);
  await mkdir(dirname(root), { recursive: true });
  await mkdir(root);
  const resultSchema = {
    $id: "urn:pguide-example:result",
    type: "object",
    required: ["status", "payload", "message"],
    properties: {
      status: { const: 200 },
      payload: { type: "object" },
      message: { type: "string" },
    },
  };
  const checks = {};
  for (const [id, field, problems] of [
    ["value", "value", { "not-ready": "references/problem.md" }],
    ["dependency", "ready", {}],
  ]) {
    checks[id] = await buildCheckArtifact({
      entry: join(source, `${id}.cjs`),
      outDirectory: join(root, id),
      manifest: {
        format: "pguide-check-v1",
        id,
        worker: "worker.cjs",
        protocol: "pguide-check-host-v1",
        subjectSchema: {
          $id: "urn:pguide-example:subject",
          type: "object",
          required: [field],
          additionalProperties: false,
          properties: { [field]: { type: "boolean" } },
        },
        resultSchema,
        resources: [],
        references: { check: "references/check.md", problems },
      },
      files: {
        "references/check.md": join(source, "check.md"),
        ...(id === "value" ? { "references/problem.md": join(source, "problem.md") } : {}),
      },
    });
  }
  const page = (path, title) => ({ path, title, description: title });
  const references = {
    "system/overview": { en: page("references/overview.md", "Composition") },
    "system/404": { en: page("references/overview.md", "Not found") },
    "levels/ready": { en: page("references/overview.md", "First input ready") },
    "levels/complete": { en: page("references/overview.md", "All inputs and prerequisite ready") },
    "checks/second/problems/not-ready": {
      en: {
        ...page("references/scenario.md", "Second scenario"),
        references: ["pages/base-second-not-ready"],
      },
      "zh-CN": {
        ...page("references/scenario.md", "第二输入场景"),
        references: ["pages/base-second-not-ready"],
      },
    },
    "pages/scenario": { en: page("references/scenario.md", "Explicit additional scenario") },
  };
  const common = {
    $schema: objectiveArtifactSchemaUri,
    subjectSchema: { type: "object" },
    defaultLanguage: "en",
    languages: ["en", "zh-CN"],
    dependencies: {},
    resources: [],
  };
  async function publish(name, manifest) {
    const path = join(root, name);
    await mkdir(join(path, "references"), { recursive: true });
    for (const name of ["overview", "scenario"]) {
      await writeFile(
        join(path, "references", `${name}.md`),
        await readFile(join(source, `${name}.md`)),
      );
    }
    await writeFile(join(path, "objective.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return { directory: path, ...(await inspectObjectiveArtifact(path)) };
  }
  const prerequisite = await publish("prerequisite", {
    ...common,
    id: "objective:composition-prerequisite",
    levels: [{ id: "done", checks: [{ id: "value", problems: ["not-ready"] }] }],
    checks: {
      value: {
        source: { kind: "directory", directory: "../value", digest: checks.value.digest },
        subject: '{"value":ready}',
      },
    },
    references: {
      "system/overview": references["system/overview"],
      "system/404": references["system/404"],
      "levels/done": references["levels/ready"],
      "pages/scenario": { en: page("references/scenario.md", "Additional scenario") },
    },
  });
  // The prerequisite has no "second" reference; its extra page must not link to it.
  await writeFile(
    join(prerequisite.directory, "references", "scenario.md"),
    "# Prerequisite scenario\n",
  );
  const fixedPrerequisite = await inspectObjectiveArtifact(prerequisite.directory);
  const objective = await publish("objective", {
    ...common,
    id: "objective:composition",
    subjectSchema: {
      type: "object",
      additionalProperties: false,
      required: ["first", "second", "dependencyReady"],
      properties: {
        first: { type: "boolean" },
        second: { type: "boolean" },
        dependencyReady: { type: "boolean" },
      },
    },
    levels: [
      { id: "ready", checks: [{ id: "first", problems: ["not-ready"] }] },
      {
        id: "complete",
        checks: [
          { id: "second", problems: ["not-ready"] },
          { id: "prerequisite", problems: [] },
        ],
      },
    ],
    checks: {
      first: {
        source: { kind: "directory", directory: "../value", digest: checks.value.digest },
        subject: '{"value":first}',
      },
      second: {
        source: { kind: "directory", directory: "../value", digest: checks.value.digest },
        subject: '{"value":second}',
      },
      prerequisite: {
        source: { kind: "directory", directory: "../dependency", digest: checks.dependency.digest },
        subject: '{"ready":dependencyReady}',
      },
    },
    dependencies: {
      "objective:composition-prerequisite": {
        directory: "../prerequisite",
        digest: fixedPrerequisite.digest,
      },
    },
    references,
  });
  return {
    directory: objective.directory,
    digest: objective.digest,
    location: objectiveArtifactLocation(objective.directory, objective.digest),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(
    JSON.stringify(await buildExample(process.argv[2] ?? ".cache\\objective-composition"), null, 2),
  );
}
