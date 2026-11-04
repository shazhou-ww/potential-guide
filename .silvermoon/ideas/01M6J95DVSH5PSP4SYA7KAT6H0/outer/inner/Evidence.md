# 实施证据

## 实现与兼容策略

- 默认 `init` 生成公开 `@potential-guide/task-sdk` 值导入及作者自己的
  `runTask(callback)`；contract 仅 `import type`。初始化独立添加缺失的
  TypeBox 和 SDK 声明，保留四类 dependency 字段中的已有版本和其他包字段。
- 新模板的 `source.mode: explicit` 对应低层 `entryMode: explicit`：
  esbuild 直接以作者文件为入口，不能因父包 `sideEffects: false` 丢弃作者启动。
  构建器只绑定声明和三个 validator，不再套 `runTask`。任意本地委托封装
  可复用同一配置；不新增 `runCheck`/`runProbe`。作者单独安装的 SDK 副本也获得
  同一绑定，不要求依赖管理器把 SDK 去重为构建工具的同一路径。
- 未指定 mode 和显式 callback mode 均保留旧惰性 callback/exportName 行为，
  不破坏内置任务。显式 mode 与 exportName 组合明确失败。构建不会执行业务入口；
  trusted contract module 仍按既有设计在构建时执行。
- `task-protocol/schema.ts` 保留编译入口、严格 Ajv2020 配置和原型字段修复，
  新增 standalone 代码生成。`schema-runtime.ts` 保留原投影、revision、
  JSON/Schema/引用预算和错误语义，由传入的预生成函数完成数据检查。
  `worker` 子路径隔离协议 barrel 中 `bundle.ts` 的顶层 Ajv 初始化，
  不是只删除 SDK 表层 import。SDK 的 input/result/message 检查仍在 Worker。
- binding 是 esbuild 插件替换的 SDK 内部模块，不来自作者 contract import
  或宿主 workerData。声明以 `JSON.parse` 保留 `__proto__` 等 own 属性，
  并继续与 verified Bundle 声明比较。所有非内置代码仍打入唯一 Worker；
  没有 external、旁路代码文件或运行时下载。
- 字节和 CID 发生预期变化；旧产物的现有验收规则未放宽。构建失败仍先于
  受管理输出替换；author check 保持无产物写入。
- 仓库构建脚本同步再嵌入 `probe-task/src/worker-source.ts` 和
  `runtime-identity.ts`；它们是本次 SDK 变更产生的受管理产物，不是手工修改。
  内置任务仍走兼容路径，其作者主动导入协议 barrel 等业务依赖不被默默 external。
- 更快的 Worker 启动暴露 UI 集成测试的时间假设：顺序等待 admission 后，
  第二个共享请求可能错过第一个 Run；fixture 的本地 allocation counter 又不能
  跨独立 Bundle Worker 限流。仅修正该回归测试的调度控制：同时提交共享请求、
  显式设置 Engine 单并发并在共享 Run 启动后再提交排队任务；不改变应用或 Engine
  生产语义、不靠保留编译器启动延迟维持测试。该定向案例已通过。

## 精确体积与来源

同条件基线提交为 `e6447bb0bb237ccb925efc21ffafe1258ab3ee6b`。
新数据属于包含本证据的实现候选；`Current.json.checkoutHead` 是测量时的
旧 HEAD，不冒充当时尚不存在的实现提交。最终实现提交由 Git 历史固定。

两侧均为 Windows、Node `v24.11.1`、pnpm `11.22.0`、esbuild `0.28.2`、Ajv `8.20.0`；
锁文件 SHA-256：
`566e448f2c16fbedee924e03c27e63d07fd458969bdc941d8fbaa768afeeff84`。
构建参数均来自正式 `compileTaskBundle`：node22/CommonJS、bundle/minify、
`packages: bundle`、`legalComments: eof`，无分析专用 flags。
每例 `buildTask` 的磁盘 Worker 与同配置 compile 的分析字节逐字断言相同。
Measure 先创建仅含 private/type 的包壳，避免 init 向上修改 checkout 的
manifest；主入口、contract 和 YAML 均由实际 init 原样生成，不手写精简模板。
仅代表性约束和作者 validator 案例再按脚本明确修改业务输入。

| 真实模板/案例 | Worker 原始字节 | Bundle 所有文件字节 |
| --- | ---: | ---: |
| 旧 init Echo | 167139 | 167902 |
| 新 init Echo | 34148 | 34911 |
| 新共享引用/组合约束 | 36162 | 37339 |
| 作者主动导入 validator | 170787 | 171550 |

默认 Worker 和总量分别减少 132991 字节（约 79.57% 和 79.21%）。
默认新旧旁路文件均共 763 字节：三个 Schema 399 字节、task.yaml 364 字节；
没有把节省的代码转移到其他交付文件。
契约中的早期观察值 167151/167914 比本次受控复测各多 12 字节；
早期值未附构建提交、完整命令或依赖图，不能据此虚构确切原因。
本次使用同一可记录旧提交、同一锁与运行环境重新建立可复现对照，
而不是将早期观察值冒称本次实测。两个独立作者目录的 Worker SHA-256 和
CID 均严格相同；默认新 CID 为
`bafybeifdmntykosjfemw6wmelabpiqn7xqmd2xemqpq5xnmeir7wujjlrq`。

`Baseline.json`/`Current.json` 保存全部逐文件和逐依赖 `bytesInOutput`。
其合计不等于文件总长，esbuild 包装、分隔及 banner 属于未归因余量：

| 案例 | Ajv 非 runtime | Ajv runtime | fast-uri | 其他归因 |
| --- | ---: | ---: | ---: | ---: |
| 旧默认 | 113625 | 819 | 16900 | 35005 |
| 新默认 | 0 | 0 | 0 | 33502 |
| 共享引用/组合 | 0 | 302 | 0 | 35214 |
| 作者 validator | 115720 | 819 | 16900 | 36703 |

新默认没有 Ajv helper。代表性任务唯一 helper 是 standalone 字符串长度
检查引用的 `ajv/dist/runtime/ucs2length.js`，贡献 302 字节。
作者 validator 相对默认增加 136639 Worker 字节；完整编译器和 fast-uri
均由作者主动导入 `compileJsonSchema` 归因，测试还证明作者检查确实执行。
默认和代表性 metafile 断言无 Ajv 入口/core/compile/codegen/vocabularies/
元 Schema、fast-uri 或 contract 运行时模块。

### 复现命令

所有工作目录和中间文件都在 checkout 内，Measure 最终删除自己创建的目录。
先构建对应 checkout 的 `@potential-guide/pguide-task-bundle...`；
不需要网络、npm 发布或 Task Engine 服务。

```powershell
git worktree add --detach .schema-baseline e6447bb0bb237ccb925efc21ffafe1258ab3ee6b
Set-Location .schema-baseline
pnpm install --offline
pnpm --filter @potential-guide/pguide-task-bundle... build
```

旧编译器本来已经使用 `metafile: true`，但未返回它。仅为旧版本依赖归因，
把该隔离 checkout 的 `packages/task-sdk/src/build.ts` 返回值从
`{ ...checked, contents: files }` 改为
`{ ...checked, contents: files, metafile: bundle.metafile }` 后重建 SDK。
这不改变 esbuild 参数、输入或输出。撤销的也仅是本次测量新增的一行。

```powershell
pnpm --filter @potential-guide/task-sdk build
Set-Location ..
node .silvermoon\ideas\01M6J95DVSH5PSP4SYA7KAT6H0\outer\inner\Measure.mjs .schema-baseline baseline-repro.json
pnpm --filter @potential-guide/pguide-task-bundle... build
node .silvermoon\ideas\01M6J95DVSH5PSP4SYA7KAT6H0\outer\inner\Measure.mjs . current-repro.json --expanded
```

复测结果写到显式指定的仓库内文件；清理自己的文件并恢复那一行后，
普通 `git worktree remove .schema-baseline` 即可，不需要 force/clean/reset。

## 自动化证明

- `task-protocol/test/precompile.test.ts`：普通编译与 standalone 的明确成功/
  失败预期，Never、布尔、required/optional、数值/字符串、tuple/数组、
  record/patternProperties、additional/unevaluated、引用 siblings、原型名称。
  同时复用全部 sharing fixtures，对照 revision、projection、等价关系、
  输入与投影预算错误，不引入 coercion/default/remove 或数据变异。
- `task-sdk/test/precompile.test.ts`：真实 Worker；显式入口、自定义委托、
  单次启动、多次独立执行、输入回调前拒绝、非法结果、有效/非法消息与 Never、
  共享引用和组合约束及原型字段、作者 validator 实际执行、命名旧 callback、
  单独安装 SDK 副本；完整 metafile 和失败后已有输出保持不变。
  自定义封装案例还在 Worker 内禁止 `Function` 调用/构造，重复执行与非法输入
  仍按预期处理，结合静态依赖图证明启动和请求期不重新生成校验代码。
- `pguide-task-bundle/test/init.test.ts`：真实模板、公开依赖和独立 TypeScript
  类型检查、初始化版本保留、check/build/artifact 一致性和真实 Worker。
  既有 authoring/bundle/日志/流/资源/取消回归保持为下限。
- 定向结果：task-protocol 121/121、task-sdk 31/31（新增真实 Worker 16/16）、
  pguide-task-bundle 54/54；单独模板 init 39/39，模板消费者 tsc 和根
  `tsc -p tsconfig.test.json --pretty false` 均通过。
- 全量测试曾在共享机器并行负载下触发 check-task 的 5 秒守护启动及
  子进程 readiness timeout；单独重跑该包 20/20 通过。未修改测试时限或生产逻辑，
  随后以 `turbo run test --concurrency=1` 运行所有 workspace 测试并重新执行
  标准 `pnpm check`。
- 修正 UI 回归测试后，诊断性
  `pnpm exec turbo run test --concurrency=1 --filter='!@potential-guide/objective-monorepo-standard'`
  为 72/72 task 通过，UI 91/91；`node --test` 全部根 scripts 测试 37/37 通过。
  该诊断过滤没有替代标准门限、没有修改脚本或设置 waiver。
- 最终原样 `pnpm check` 退出 1：layers/build、format、lint、typecheck 均通过；
  workspace 阶段 73/74 task 通过，唯一失败是下述既存 dependency-direction
  元数据问题。因此 I-AC02 未完成，不记录 submitInner。
- 独立执行 `node scripts/check-packages.mjs --task-sdk` 通过：3 个选定包、
  5 个内部包的真实打包消费通过；作者进程退出后，无 node_modules 的 Worker
  仍完成任务，协议 v1/废弃及未来版本的控制继续正确。
- 完整 `pnpm pack:check` 的受管理旧 dist 残留先按现有 clean/force-build 工具
  重建（objective-pilot、task-engine-server，无源码改动），随后到达 authoring
  消费环境，但被下述本机 CLI discovery 歧义阻塞，退出 1；没有把该失败省略为成功。

### 尚未满足的门限

`packages/task-engine/package.json` 早已声明
`@potential-guide/ipfs-content`（来源提交 `6471f793`），但同包
`objectives.yaml` 的 `allows` 缺少该依赖。真实仓库的 monorepo 测试报：

```text
rule: dependency-direction
location: packages/task-engine/package.json
dependencies: @potential-guide/ipfs-content is outside the allowed dependency direction.
```

这两份文件本次均未修改，工作区内容与基线 `e6447bb0` 的 Git blob 完全相同：

| 路径 | 基线和当前共同 blob |
| --- | --- |
| packages/task-engine/package.json | beb9a36f620b1c9db9ad657ad82a63e341aeff9c |
| packages/task-engine/objectives.yaml | 24ab309a79e920d73403748c1add904a3d5ea39c |

该策略文件最近提交为 `f2604206d41c3d6aa147f187dd9aaa4247d612e4`，
早于本次实施。未扩大本任务修改无关依赖策略，也未把失败当成通过。
完整包检查的第二个独立阻塞是已有本机环境：authoring 消费者自己的
`node_modules/.bin/pguide-task-bundle.CMD` 与全局 pnpm bin 中同名命令同时
被发现，报 `Ambiguous command task-bundle`。没有卸载、修改或隐藏用户全局
命令，也没有更改 CLI 的歧义保护规则。

需由父 agent 的门限责任范围处理既有依赖策略和消费测试的 PATH 隔离，再重跑
标准 check、补齐 I-AC02、同步并提交准确 implementation revision；不能直接
验收或提前进入部署。本阶段只保留经过 Silvermoon snapshot 检查的本地提交，
不把未满足完整门限的候选推送为 primary 当前实现。

## 变更路径

实现与测试：

```text
apps/task-engine-web-ui/test/integration.test.ts
packages/task-protocol/package.json
packages/task-protocol/src/bundle.ts
packages/task-protocol/src/schema.ts
packages/task-protocol/src/schema-runtime.ts
packages/task-protocol/src/task-schema-uri.ts
packages/task-protocol/src/worker.ts
packages/task-protocol/test/precompile-fixtures.ts
packages/task-protocol/test/precompile.test.ts
packages/task-sdk/README.md
packages/task-sdk/src/binding.ts
packages/task-sdk/src/build.ts
packages/task-sdk/src/index.ts
packages/task-sdk/test/precompile.test.ts
packages/pguide-task-bundle/README.md
packages/pguide-task-bundle/examples/echo/main.ts
packages/pguide-task-bundle/examples/echo/task.build.yaml
packages/pguide-task-bundle/src/authoring.ts
packages/pguide-task-bundle/src/init.ts
packages/pguide-task-bundle/test/init.test.ts
packages/probe-task/src/runtime-identity.ts
packages/probe-task/src/worker-source.ts
schemas/artifacts/task-build/v1.json
```

本 idea 内更新 `outer/inner/Implementation.md`、新增同层 `Evidence.md`、
`Baseline.json`、`Current.json`、`Measure.mjs`；根 `ledger.md` 仅镜像实施
checkbox。`events.jsonl` 仅由 CLI 写入授权的 acceptIdeal；submitInner 尚未记录。
未改 Ideal/Deployment 契约、依赖锁文件或不相关用户内容。

## 阶段边界

本文件没有记录任何 `acceptInner`/`acceptOuter` 或 gate waiver。
真实 tarball 消费、仓库外断网隔离、最低 Node 支持版本均属于 Deployment，
尚未执行、没有勾选其 ledger，也没有 npm 发布。早期基线的 12 字节差异
缺失原始 provenance，已如实保留而非伪造解释；父 agent 可据受控复测作门限判断。
