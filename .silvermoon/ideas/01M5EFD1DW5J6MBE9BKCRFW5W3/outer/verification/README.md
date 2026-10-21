# 隔离消费复现

这些脚本是本 Outer World 的消费验证材料，不属于产品实现或新的业务契约。
`pack-install.mjs` 只从指定归档源码打包；`consume.mjs` 只导入消费者实际安装的公开包，
通过公开 bin、Git Objective 和公开 API 检验部署契约。`isolation.mjs` 使用 Node 同步
模块解析 hooks，拒绝任何消费者目录之外的文件模块；示例检查只使用 Node 内置模块，
实际依赖检查显式引用同一消费者的已安装 Pilot 入口。

## 执行

要求本次使用的 Node 24.11.1、Git 2.55.0.windows.5，以及设备级 pnpm。执行目录需要
是尚不存在的、操作专属的项目 `.cache` 子目录。归档源码与消费者是相邻的独立目录，
不会把当前工作区的 dist 或 workspace 模块链接安装进消费者。不要把脚本所在的
Outer World 路径当成产品模块导入路径。

在仓库根目录的 PowerShell 中执行；`$phase` 指向本材料所在目录：

```powershell
$phase = '.silvermoon\ideas\01M5EFD1DW5J6MBE9BKCRFW5W3\outer\verification'
$run = '.cache\level-deploy-replay'
if (Test-Path -LiteralPath $run) { throw 'Refusing to overwrite an existing execution root.' }
New-Item -ItemType Directory -Path "$run\source","$run\consumer","$run\artifacts" | Out-Null
git archive --format=zip --output="$run\source.zip" 682311db15c41344232a5d3f5cd806d5750779d5
Expand-Archive -LiteralPath "$run\source.zip" -DestinationPath "$run\source"
pnpm --dir "$run\source" install --offline --frozen-lockfile --ignore-scripts
pnpm --dir "$run\source" build
$env:LEVEL_DEPLOY_PNPM = (Get-Command pnpm.exe -ErrorAction Stop).Source
node "$phase\pack-install.mjs" $run
Copy-Item -LiteralPath "$phase\consume.mjs","$phase\isolation.mjs" -Destination "$run\consumer"
$consumer = (Resolve-Path "$run\consumer").Path
$artifacts = (Resolve-Path "$run\artifacts").Path
$guard = ([System.Uri](Join-Path $consumer 'isolation.mjs')).AbsoluteUri
Push-Location $consumer
try { node --import $guard .\consume.mjs $artifacts } finally { Pop-Location }
```

每一步都必须检查退出码；上例为紧凑的操作索引，不授权在失败后继续。
脚本不会发布包或更改远程环境。源码依赖恢复失败时应先解决所报告的缺包，不能链接
实时工作区的 node_modules。消费者安装使用 `--prefer-offline --ignore-scripts`，
允许刷新公共 registry 元数据，但全部内部包都通过本次本地 tarball 显式覆盖。

## 输出与边界

- `artifacts/packages.json`：固定源码提交、归档 SHA-256、17 个包的版本与 tarball SHA-256、
  平台、Node、源码打包与消费者安装实际使用的 pnpm 版本。
- `artifacts/installed-graph.json`：从每个真实父依赖解析的完整生产依赖图与物理路径；
  不允许 workspace 范围残留或消费者外部链接。
- `artifacts/results.json`：观察矩阵、同一 subject 的最高层/terminal 比较、initial 的实际
  Regulation 输出与零执行证据、依赖结果、迁移前后数据、原始 CLI stdout/stderr/退出码，
  以及固定旧证据的文件哈希和相等断言。
- `artifacts/module-resolutions.jsonl`：模块解析 guard 实际放行的原始文件记录。
  归档的 `module-paths.json` 保存所有不同物理路径、原始解析计数、说明符集合和原始
  trace SHA-256，避免将数 MB 重复路径加入仓库；CLI 原始 stdout/stderr 不做此归并。

归档证据另含 `fixture.bundle`，保留实际 fixture commit 和所有 Git 对象，
已通过 `git bundle verify`。可用 `git bundle list-heads` 或克隆到独立审计目录读取；
运行时 file URI 指向可清理的缓存目录，不是永久分发地址。复现脚本明确新建一轮 fixture，
不会将原证据中的 commit/tree 静默改绑为新一轮对象。

Windows `--import` 参数是模块说明符，必须使用 file URI；不能使用 `.\isolation.mjs`
作为说明符。一般文件和命令参数仍使用 Windows 路径。

成功后保留本 Outer World 中已归档的证据；操作专属的源码归档、安装树、fixture、
打包文件和运行缓存可整体清理。不要清理其他会话的文件或父代理的 decision request。
