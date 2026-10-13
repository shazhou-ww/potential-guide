# `@potential-guide/objective-guide`

Defines language-neutral Objectives and binds them to immutable subjects and one
explicit content language. The package owns manifest loading, prerequisite
projection, ordered levels, checks, localized observations, and reference pages.

Loader and I/O failures reject. Expected subject and language failures are returned
as typed instance-creation results. Objective Guide APIs observe and explain; they
do not change the subject's real-world state.

## Public API

- `createObjectiveLoader` loads and caches Guides by canonical Manifest URI.
- `canonicalManifestUri` normalizes Manifest and resource identities.
- `fileObjectiveResources` reads UTF-8 file resources and Markdown reference pages.
- `ObjectiveConfigurationError` reports invalid manifests and resources.
- `ObjectiveOperationError` reports invalid check and query behavior.
- `SUBJECT_PROJECTION_LIMITS` documents the deterministic JSONata profile bounds.
- Public types describe manifests, checks, Guides, instances, observations, typed
  creation failures, resource resolvers, and reference pages.

## Usage

```ts
import { createObjectiveLoader } from "@potential-guide/objective-guide";

const loader = createObjectiveLoader({
  checks: {
    "repository-ready": async (subject, language) => {
      return subject.root === "/ready"
        ? { pass: true }
        : {
            pass: false,
            problems: [
              {
                pageId: "prepare-repository",
                description: `Prepare ${String(subject.root)} for ${language}.`,
              },
            ],
          };
    },
  },
});

const guide = await loader.load(
  new URL("./objective-guide.yaml", import.meta.url).href,
);
const created = guide.createInstance({
  subject: { root: "/workspace" },
  language: "en-US",
});

if (!created.ok) {
  console.error(created.error);
} else {
  const observation = await created.instance.probe();
  const firstProblem = observation.problems[0];
  if (firstProblem) {
    console.log(await observation.current.instance.readPage(firstProblem.pageId));
  }
}
```

Manifest structure is language-neutral. Locale content must completely cover every
explicit level and the implicit terminal level, while every locale exposes the same
reference-page identities.
