# Pilot package 架构与消费契约

正式 Objective 由完整、私有的 pnpm workspace package 交付。package 是
源码版本、依赖、构建和资源交付边界，不代表公开 npm 发布，不改变 Objective 的业务身份。
通用协议、共享 Host 执行和资源加载由基础包维护，不为每个 check 建包。
紧密相关的仓库标准化和包标准化由同一 workspace 内两个自包含 Pilot 目录交付。

## Objective 实例包命名

1. 统一使用 `objective-` 前缀；目录名与去掉 `@potential-guide/` scope 的包名一致。
2. 后缀表达具体的价值或期望状态，而非仅描述技术对象。例如 `monorepo-standard`
   表达标准化 monorepo，`devbox-health` 表达开发机健康；避免 `monorepo` 这种泛称。
3. 使用简短的 kebab-case，可使用 `devbox` 等惯用缩写；不重复添加 `pilot`、
   `objective` 等类型词，也不使用难以理解的自造缩写。
   产品名只在明确目标范围时保留，例如 `pguide-setup` 和 `pguide-self-check`。

这些规则适用于携带 `objective.yaml` 的 Objective 实例包。`objective-pilot`、
`objective-regulator`、`objective-portfolio-supervisor` 是共享基础设施，不是实例，
不参与本次重命名。包名与路径变化不修改 manifest 的业务身份、检查 ID 或 problem ID。

## 范围与历史路径

| 历史路径（仅历史 commit 保留） | 当前 Pilot 目录 ID fragment |
| --- | --- |
| `objectives/pnpm-monorepo` / `packages/monorepo-objective` | `packages/objective-monorepo-standard/` |
| `objectives/pguide-setup` / `packages/pguide-setup-pilot` | `packages/objective-pguide-setup/` |
| `objectives/pguide-self-check` / `packages/pguide-self-check-pilot` | `packages/objective-pguide-self-check/` |
| `objectives/development-machine-health` / `packages/development-machine-health-pilot` | `packages/objective-devbox-health/` |

旧 URI 固定到旧 commit 时仍由该历史源码提供；新 commit 不保留第二套旧主体或
静默重定向。迁移调用方的 URI fragment、脚本路径及版本 pin，然后重新加载 manifest
和 References。不能只改 fragment 却继续复用旧 commit；缓存、执行配方和 evidence 的
Objective URI / version 随之改变，旧结果不自动证明新版本。检查 ID、problem ID、
其他 Pilot subject 的授权/预算/目标约束保持不变；monorepo 的目录声明迁移见下文。

## 源码与职责

- 每个 package 自有 manifest、References、README、入口、运行资源和测试。
  v3 的 `checks/<id>/worker.cjs` 是自包含 worker，显式资源放在同一产物目录内；
  重复 check ID 使用 `levels/<level>/checks/<id>/worker.cjs`。
  业务实现按实际独立检查职责放在 `src`，使用 `pnpm workers:build` 统一生成，
  不手改 bundle。Git loader 明确拒绝旧 `run.*`，不回退到逐 check 进程执行。
- monorepo 的 structure、packages/delivery、task graph、schema/import 观察分离；
  deliveries 保留结构前置验证，不是运行全部业务后过滤 findings。
  `repository-observation` 只读取/解析一次仓库事实，`repository-configuration`
  消费这些事实；layout、workspace mapping、file placement/classification 各自可调用。
  package 依赖、任务、发布内容、CLI 和 source boundary 分开检查；
  browser、Worker metadata/bindings、service、identity、migration 是独立能力，
  delivery 入口只编排它们。`source-observation` 产出 AST 导入事实，
  单一导入规则不执行同文件其他导入或全仓库业务。
- setup 的 installation、configuration/ACP readiness、sanity、direct sanity、
  execution 和 subject/envelope 契约分离。self-check 使用同源生成的模块，禁止手改生成物。
- health 的 identity、system、toolchains、order、sustainability 独立；
  transport、执行和输入校验与业务规则分离，仅调用请求的 stage。
- setup 的 `sanity-fixture` 是该 package 内嵌的运行资源，不是独立 workspace，
  也不是可从交付物排除的普通测试数据。
  必需的 ignore 模板命名为普通文件 `gitignore`，避免 pack 丢弃隐藏的 `.gitignore`；
  仅在本次独占 sanity 仓库中将其 materialize 为 `.gitignore`。
- 不默认建立 examples。README 提供最小使用方式，纯测试样本按需放在 test。
  本仓库真实 monorepo 需求由各包 `objectives.yaml` 及[根联合约束](../objectives.yaml)维护。

## 生成物、依赖与实际消费

Git loader 只读取提交，不自动执行 install/build，且不从本机工作树借用未提交文件。
没有新增通用 npm Pilot resolver。支持现有的、固定 commit 的 Git URI，通过真实 pguide
入口加载；库消费者仍可使用现有 monorepo 导出。

| Package | 开发构建 | 隔离 Git snapshot 的运行资源 |
| --- | --- | --- |
| objective-monorepo-standard | TypeScript + `scripts/build-monorepo-runtime.mjs` | 提交的 `runtime/pilot-checker.cjs`，含锁定的第三方运行时 |
| objective-pguide-setup | `scripts/build-setup-runtime.mjs` | Node 内置模块 + package 自有 src/fixture；SSH 经 stdin 传输同版本 standalone helper 和 fixture |
| objective-pguide-self-check | `scripts/build-self-check-runtime.mjs` | 提交的 runtime 与 References，从 setup、cli-core、pguide 权限实现和 direct-agent 源码生成 |
| objective-devbox-health | `scripts/build-health-runtime.mjs` | Node 内置模块与提交的单文件 Docker transport runtime，从实际职责模块生成 |

monorepo 根 subject 为 `{context,policy,deliveries}`；嵌套的自包含 `package-standard/`
Pilot 接受包自有 roles/runtime/allows/entries/joins/deliveries 等 subject。
不再接受 contract 或 checkerModule。声明解析/投影复用 objective-pilot 公共 API，
根 check 返回 dependency requirements 并释放 worker；上层绑定真实包版本、观察目标层级，
校验实际事实后重查根 check。requirements 不等于已经满足的依赖证据；Supervisor 处理交接。
两个 Pilot 目录的运行资源独立包含，仍是同一私有 workspace。
完整[迁移与约束归属](../packages/objective-monorepo-standard/README.md)说明源码版本要求。

运行资源生成器均支持 `--check`，分别由 `pnpm monorepo:check`、`pnpm setup:check`、
`pnpm self-check:check`、`pnpm health:check` 校验。共享第三方版本在 catalog，内部开发依赖使用 workspace range，
Turbo 按依赖构建并缓存生成资源；改变源码后必须重新生成并提交对应运行资源。
全部 16 个 worker 及其显式资源由 `pnpm workers:check` 校验，直接消费测试通过
目录和完整 revision 调用 Host，不将 `worker.cjs` 当作 stdin/stdout 可执行文件。

所有层级的 `dist/` 都是本地构建输出，由根 `.gitignore` 统一忽略，不保留例外。
Git snapshot 必需的 standalone 生成物放在各包的 `runtime/` 并提交；
monorepo 的库入口仍构建到 `dist/`，打包时同时包含库输出与 standalone runtime。
所有者包声明将该 bundle 的确切路径标为 `generated`，源码边界扫描不重复解析此生成物；
未被明确标记的 `runtime/` 源码仍正常检查。生成物的新鲜度由上述生成器校验。

## 保持不变的边界

迁移不增加业务检查、不执行目标构建、不自动安装软件、不放宽 SSH/秘密/身份/权限、
外层 timeout、输出预算或独占 scratch 与进程树清理。setup sanity 仍需 allowSanity；
self-check 仍是本机直接 Agent 修复与独立内容复查，不接受 target/allowSanity。
health 本机检查仍要求受支持的 Linux 环境，Windows 不得被当作健康通过。

本机 self-check 的轻量 sanity 是上述历史迁移之后的自动验收语义：
仅该独占会话自动选择 ACP `allow_once`，不依赖正常修复任务的 grants，也不改写用户权限配置。
正常 regulate 和旧 setup sanity 仍沿用各自的授权策略。

单元测试不是部署证明。交付验证必须使用干净、固定版本、无目标依赖安装的隔离消费环境，
检查资源加载、正反例和适用终态；真实 Agent、外部设备、费用、发布和生产修改仍需各自授权。
