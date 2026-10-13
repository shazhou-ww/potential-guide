import type { LoadedLocale } from "./guide.js";
import { createObjectiveGuide } from "./guide.js";
import { canonicalManifestUri, fileObjectiveResources, validatePages } from "./resources.js";
import type { ObjectiveGuide, ObjectiveLoader, ObjectiveLoaderOptions } from "./types.js";
import { ObjectiveConfigurationError, parseContent, parseManifest } from "./validation.js";

export function createObjectiveLoader(options: ObjectiveLoaderOptions = {}): ObjectiveLoader {
  const resources = options.resources ?? fileObjectiveResources;
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
    if (cached !== undefined) {
      return cached;
    }

    const manifest = parseManifest(await resources.readText(canonical));
    const prerequisite =
      manifest.prerequisite === undefined
        ? undefined
        : await load(canonicalManifestUri(manifest.prerequisite.manifestUri, canonical), [
            ...ancestors,
            canonical,
          ]);

    const locales = new Map<string, LoadedLocale>();
    let baselineIds: string[] | undefined;
    let baselineFallback: string | undefined;
    for (const [language, localization] of Object.entries(manifest.localizations)) {
      const contentUri = canonicalManifestUri(localization.content, canonical);
      const sourceUri = canonicalManifestUri(localization.references.source, canonical);
      const content = parseContent(
        await resources.readText(contentUri),
        manifest.levels.map(({ id }) => id),
      );
      const references = validatePages(
        await resources.readPages(sourceUri),
        sourceUri,
        localization.references.notFoundPageId,
      );
      const ids = [...references.pages.keys()].sort();
      if (
        baselineIds !== undefined &&
        (JSON.stringify(ids) !== JSON.stringify(baselineIds) ||
          references.fallbackId !== baselineFallback)
      ) {
        throw new ObjectiveConfigurationError(
          "Locales must share page IDs and not-found identity.",
        );
      }
      baselineIds = ids;
      baselineFallback = references.fallbackId;
      locales.set(language, { content, ...references });
    }

    const checks =
      options.resolveChecks === undefined
        ? (options.checks ?? {})
        : options.resolveChecks(canonical);
    const guide = createObjectiveGuide(
      canonical,
      manifest,
      {
        checks,
        ...(prerequisite === undefined ? {} : { prerequisite }),
      },
      locales,
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
