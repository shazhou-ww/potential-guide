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
Node 类型守护 Worker 可声明 `nodeWorkerImports: [{path, reason}]`；仅适用于 Node runtime
中明确列出的 Worker 入口。观察器要求实际导入 Node `parentPort`/`workerData`，
以及 `import(pathToFileURL(realpathSync(fileURLToPath(workerData.module))).href)` 的本地加载语法。
该声明仅证明动态插件加载边界，不枚举外部模块内容；宿主还必须验证普通文件和本地位置。
未声明、远程 URL、任意动态表达式、非 Node 或其他入口仍为 `unverified`，不是通用豁免。
