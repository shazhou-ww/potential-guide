# Package Standard Objective

`@potential-guide/objective-package-standard` is one standalone npm Objective.
Build with `pnpm --filter @potential-guide/objective-package-standard build`, then
consume its `dist/package` directory or a package-specific release tarball.
Its root `objective.yaml` defines `structure` and `deliveries`; workers are
self-contained generated output, not Git source. Package identity is the actual
package name; revisions are versioned package-tree content digests.
