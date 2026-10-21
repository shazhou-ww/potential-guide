import {
  canonicalManifestUri,
  loadPilotSpec,
  type ObjectiveManifest,
  type ResourceResolver,
} from "../src/index.js";

export const objectiveId = "git+https://example.test/objectives.git#root/";
export const commit = "a".repeat(40);

export function manifest(overrides: Partial<ObjectiveManifest> = {}): ObjectiveManifest {
  return {
    $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v2.json",
    subjectSchema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
      additionalProperties: false,
    },
    levels: [
      {
        id: "z-first",
        checks: [
          { id: "one", problems: ["broken"] },
          { id: "two", problems: ["broken"] },
        ],
      },
      { id: "a-next", checks: [{ id: "one", problems: ["broken"] }] },
    ],
    defaultLanguage: "en-US",
    languages: ["en-US", "zh-CN"],
    ...overrides,
  };
}

export function fixture(
  configs: Record<string, ObjectiveManifest> = { [objectiveId]: manifest() },
) {
  const texts = new Map(
    Object.entries(configs).map(([uri, config]) => [
      canonicalManifestUri("objective.yaml", uri),
      JSON.stringify(config),
    ]),
  );
  const pages = new Map<string, { uri: string; source: string }[]>();
  for (const [uri, config] of Object.entries(configs)) {
    const root = canonicalManifestUri("references/", uri);
    const ids = [
      "system/overview",
      "system/404",
      "levels/terminal",
      ...config.levels.flatMap((level) => [
        `levels/${level.id}`,
        ...level.checks.flatMap((check) => [
          `levels/${level.id}/checks/${check.id}`,
          ...check.problems.map(
            (problem) => `levels/${level.id}/checks/${check.id}/problems/${problem}`,
          ),
        ]),
      ]),
    ];
    pages.set(
      root,
      config.languages.flatMap((language) =>
        ids.map((id) => ({
          uri: canonicalManifestUri(`${id}/${language}.md`, root),
          source: `---\ntitle: ${JSON.stringify(`${id} ${language}`)}\ndescription: ${JSON.stringify(`Description ${id} ${language}`)}\nreferences: []\n---\nWiki [[system/overview]]\n`,
        })),
      ),
    );
  }
  const resources: ResourceResolver = {
    version: commit,
    async readText(uri) {
      const value = texts.get(uri);
      if (value === undefined) throw new Error(`Missing resource ${uri}.`);
      return value;
    },
    async readPages(uri) {
      const value = pages.get(uri);
      if (value === undefined) throw new Error(`Missing pages ${uri}.`);
      return value;
    },
  };
  return { texts, pages, resources, load: (uri = objectiveId) => loadPilotSpec(uri, resources) };
}
