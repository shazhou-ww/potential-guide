import { createObjectiveGuide } from "./guide.js";
import { canonicalManifestUri, fileObjectiveResources, validateReferences } from "./resources.js";
import { fileObjectiveCheckRunner } from "./runner.js";
import type { ObjectiveGuide, ObjectiveLoader, ObjectiveLoaderOptions } from "./types.js";
import { ObjectiveConfigurationError, parseManifest } from "./validation.js";

export function createObjectiveLoader(options: ObjectiveLoaderOptions = {}): ObjectiveLoader {
  const resources = options.resources ?? fileObjectiveResources;
  const runner = options.checkRunner ?? fileObjectiveCheckRunner;
  const schedulingPolicy = options.checkSchedulingPolicy;
  if (schedulingPolicy !== undefined && typeof schedulingPolicy !== "function") {
    throw new ObjectiveConfigurationError("Check scheduling policy must be a function.");
  }
  const cache = new Map<string, ObjectiveGuide>();
  let queue: Promise<unknown> = Promise.resolve();
  async function load(uri: string, ancestors: readonly string[]): Promise<ObjectiveGuide> {
    const canonical = canonicalManifestUri(uri);
    if (ancestors.includes(canonical)) {
      throw new ObjectiveConfigurationError(
        `Cyclic prerequisite: ${[...ancestors, canonical].join(" -> ")}.`,
      );
    }
    const cached = cache.get(canonical);
    if (cached !== undefined) return cached;
    const manifest = parseManifest(await resources.readText(canonical));
    const prerequisite =
      manifest.prerequisite === undefined
        ? undefined
        : await load(canonicalManifestUri(manifest.prerequisite.manifestUri, canonical), [
            ...ancestors,
            canonical,
          ]);
    const sourceUri = canonicalManifestUri("references/", canonical);
    const locales = validateReferences(await resources.readPages(sourceUri), sourceUri, manifest);
    if (runner.validate !== undefined) {
      for (const checkId of new Set(
        manifest.levels.flatMap(({ advancement }) => advancement.checks.map(({ id }) => id)),
      )) {
        await runner.validate(canonical, checkId);
      }
    }
    const guide = createObjectiveGuide(
      canonical,
      manifest,
      prerequisite,
      runner,
      locales,
      schedulingPolicy,
    );
    cache.set(canonical, guide);
    return guide;
  }
  return Object.freeze({
    load(uri: string) {
      const pending = queue.then(() => load(uri, []));
      queue = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
  });
}
