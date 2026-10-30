# Package Standard Objective

`@potential-guide/objective-package-standard` is one standalone npm Objective.
Build with `pnpm --filter @potential-guide/objective-package-standard build`, then
consume its `dist/package` directory or a package-specific release tarball.
Its root `objective.yaml` defines `structure` and `deliveries`; workers are
self-contained generated output, not Git source. Package identity is the actual
package name; revisions are versioned package-tree content digests.

Node CLI packages may declare `localConfigurationImports: [{path, reason}]` for
unique declared entry files that load operator-owned configuration. Only the
syntax `import(pathToFileURL(resolve(...)).href)` with the actual `node:url` and
`node:path` named imports is recognized. This proves a local file-URL boundary,
not the contents of the external configuration. Ordinary computed imports,
HTTP implementation files, undeclared entries and non-Node/non-CLI subjects
remain unverified. All literal package imports still undergo dependency checks.
