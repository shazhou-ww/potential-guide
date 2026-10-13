# `@potential-guide/objective-guide`

Defines language-neutral, URI-keyed Objective Guides and binds them to immutable
JSON subjects and one explicit content language. The package owns manifest and
domain validation, prerequisite projection, ordered levels, executable checks,
localized observations, and reference pages. It does not own command reports,
Git workflow policy, regulation, or portfolio supervision.

## Transport layout

Each Guide is a self-contained transport unit:

```text
my-objective-guide/
├── objective-guide.yaml
├── checks/
│   └── repository-ready/
│       └── run.js
└── references/
    ├── system/{overview,404}/{en-US,zh-CN}.md
    ├── levels/<level-id>/{en-US,zh-CN}.md
    ├── checks/<check-id>/{en-US,zh-CN}.md
    ├── problems/<problem-id>/{en-US,zh-CN}.md
    └── pages/<page-id>/{en-US,zh-CN}.md
```

Manifest checks contain stable IDs only. The file runner discovers exactly one
`run` or `run.*` entry in the matching check directory and exchanges one JSON
request and response over standard I/O. Every complete probe receives a unique
temporary directory shared by its prerequisite chain and ordered checks.

Reference identity is `<namespace>/<id>`; language is always the leaf file.
Checks return stable Problem IDs plus JSON parameters, while the selected locale
supplies the human-facing problem content.

## Public API

- `createObjectiveLoader` loads and caches Guides by canonical Manifest URI.
- `fileObjectiveCheckRunner` validates and executes convention-based checks.
- `canonicalManifestUri` normalizes Manifest and resource identities.
- `fileObjectiveResources` reads UTF-8 file resources and Markdown References.
- `ObjectiveConfigurationError` reports invalid manifests and resources.
- `ObjectiveOperationError` reports runtime protocol and query failures.
- `SUBJECT_PROJECTION_LIMITS` documents deterministic JSONata profile bounds.

Loader and I/O failures reject. Expected subject, language, and prerequisite
projection failures are typed instance-creation results. A prerequisite may
declare `minimumLevelId`; omitting it retains the terminal-only unlock behavior.
