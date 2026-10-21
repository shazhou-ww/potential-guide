import { parseDocument } from "yaml";
import {
  matches,
  packageValidator,
  type RecordValue,
  record,
  type Snapshot,
  texts,
  turboValidator,
  workspaceValidator,
} from "./shared.js";

export interface RepositoryFacts {
  inventory: string[];
  workspaceConfig: RecordValue;
  workspaceObserved: boolean;
  tasks: RecordValue;
  turboValidity?: "valid" | "fail" | "unverified";
  rootObserved: boolean;
  packages: { file: string; directory: string; manifest: RecordValue; valid: boolean }[];
  manifests: Map<string, RecordValue>;
  failure?: string;
}

export async function observeRepository(
  snapshot: Snapshot,
  packageDirectory?: string,
): Promise<RepositoryFacts> {
  const facts: RepositoryFacts = {
    inventory: [],
    workspaceConfig: {},
    workspaceObserved: false,
    tasks: {},
    rootObserved: false,
    packages: [],
    manifests: new Map(),
  };
  try {
    if (packageDirectory === undefined) facts.inventory = await snapshot.files();
    const document = parseDocument(await snapshot.text("pnpm-workspace.yaml"), {
      uniqueKeys: true,
    });
    if (document.errors.length) throw new Error("pnpm-workspace.yaml has YAML parse errors.");
    const parsed: unknown = document.toJS();
    if (!workspaceValidator(parsed) || !record(parsed))
      throw new Error("pnpm-workspace.yaml violates the supported workspace schema.");
    facts.workspaceConfig = { ...parsed };
    facts.workspaceObserved = true;
    const patterns = texts(parsed.packages);
    if (packageDirectory !== undefined) {
      facts.inventory = patterns.some((pattern) => /[{}[\]?\\]/.test(pattern))
        ? await snapshot.files()
        : [
            ...new Set([
              ...(await snapshot.workspaceManifests(patterns)),
              ...(await snapshot.files(packageDirectory)),
            ]),
          ];
    }
    if (facts.inventory.length > 20000)
      throw new Error("Inventory exceeds 20,000 files; narrow the target.");
    const turbo = await snapshot.json("turbo.json");
    facts.turboValidity = turboValidator(turbo)
      ? "valid"
      : turboValidator.errors?.some((error) => error.keyword !== "additionalProperties")
        ? "fail"
        : "unverified";
    facts.tasks = record(turbo.tasks) ? turbo.tasks : {};
    if (!packageValidator(await snapshot.json("package.json")))
      throw new Error("Root package.json violates package metadata types.");
    facts.rootObserved = true;
    for (const file of facts.inventory.filter((file) => file.endsWith("/package.json"))) {
      const directory = file.slice(0, -"/package.json".length);
      if (
        !patterns.some((pattern) => !pattern.startsWith("!") && matches(directory, pattern)) ||
        patterns.some((pattern) => pattern.startsWith("!") && matches(directory, pattern.slice(1)))
      )
        continue;
      let manifest: RecordValue;
      try {
        manifest = await snapshot.json(file);
      } catch (error) {
        if (!(error instanceof SyntaxError || error instanceof TypeError)) throw error;
        facts.packages.push({ file, directory, manifest: {}, valid: false });
        continue;
      }
      const valid = packageValidator(manifest);
      facts.packages.push({ file, directory, manifest, valid });
      if (valid) facts.manifests.set(String(manifest.name), manifest);
    }
  } catch (error) {
    facts.failure = error instanceof Error ? error.message : String(error);
  }
  return facts;
}
