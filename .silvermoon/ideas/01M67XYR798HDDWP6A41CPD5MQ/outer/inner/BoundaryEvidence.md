# 完整实施验证与边界

以下基础候选/阻塞记录为历史。父代理批准严格 Observer 适配后已完成端到端候选；
当前结果以文末完整验证为准，不把历史失败改写成成功。

## 历史基础候选状态（完整切换前）

此候选尚未实现完整 Idea，不能作为 `submitInner` 或实施验收依据。
`ideal` 树、生命周期事件和 ledger checkbox 均未修改；没有 stage、commit 或同步 primary。
未完成的跨包切换已撤回，现有 Engine、Check/Probe、HTTP、存储、UI 与例子的运行契约仍为原协议。

保留的可独立复验基础：

- `packages/task-protocol/src/schema.ts`：新增支持 boolean 根的 JSON Schema 编译，
  保留 Input object 根约束、本地引用及既有校验/预算限制。
- `packages/task-protocol/src/run.ts`：完整入口、必选消息和标准展示进度的边界类型基础；
  尚未替换现有 `TaskType`，不是已完成的新协议。
- `packages/task-engine/src/type-worker.ts`、`type-supervisor.ts`：
  静态注册数据、独立堆加载、多个 Run、指定 Run 取消、确认、健康观察及失联基础；
  尚未接入 Engine 和业务资源装配，不能宣称整个服务已经隔离。
- `packages/task-engine/test/run-contract.test.ts`、`type-supervisor.test.ts`：
  基础行为的确定性断言；不是完整 I-AC01–I-AC03 证明。

## 已执行验证

1. `pnpm --filter @potential-guide/task-protocol build`：通过。
2. `pnpm --filter @potential-guide/task-engine build`：通过。
3. `pnpm exec tsx --test packages\task-engine\test\run-contract.test.ts packages\task-engine\test\type-supervisor.test.ts`：
   8/8 通过，覆盖 Never/任意 JSON、Input 根、本地引用、标准进度、确认时序、
   多 Run/指定取消、消息归属、存储拒绝，以及类型卡死后宿主仍响应、恢复不自动重跑。
4. `pnpm check`：未通过；首次在 Check 的 `file-source.test.ts` 进程级失败，
   单独复验该文件 8/8 通过。不能据此把首次整仓检查记为成功。
5. 第二次 `pnpm check`：未通过，明确失败于
   `packages/objective-monorepo-standard/test/pilot.test.mjs` 的真实仓库结构证明：
   `computed-import` 将 `packages/task-engine/src/type-worker.ts` 的类型模块导入标为
   `unverified`，预期 `pass` 而实际为 `unverified`。
6. `silvermoon check --worktree --audience agent`：通过，退出码 0；
   该检查仅证明 Silvermoon snapshot 有效，不代表仓库行为或实施验收通过。

本地完整输出位于 `.cache\whole-run-foundation-check.log` 和
`.cache\whole-run-foundation-check-retry.log`；日志只是诊断，不是提交或验收状态。

## 需要父代理处理的边界阻塞

现有结构 Observer 仅允许显式声明的 **Node CLI 入口 file-URL configuration**
作为动态导入边界，条件包括 `roles: ["cli"]`、入口列表及规定的本地 URL 语法。
本任务要求的是 npm 包内的类型守护 Worker，不满足该入口契约；
不能将 Worker 伪标成 CLI、隐藏动态导入、放宽全部 computed import 或改测试为接受未知。

若要继续并满足必跑 `pnpm check`，需要明确批准一个可复验的 **类型守护 Worker 动态模块**
结构观察边界及相应声明/测试。该变更涉及 Objective Package/Monorepo Standard 的观察契约，
不能靠通用任务类型注册自授，也不能静默增加未经审查的静态依赖豁免。
父代理应决定是否将这一必要边界扩展纳入当前实现，并要求严格的本地模块/入口/声明验证；
本候选未擅自改动该 Observer。

## 历史基础阶段尚未完成的工作

I-S01–I-S03 和 I-AC01–I-AC03 全部仍未完成：完整 Run 事件和格式边界、Input-only 调度、
可信资源 RPC、Check/Probe 结果证据与历史隔离复验、消息持久化/幂等/终结竞争、
替换及 owner/reclaim 控制、所有直接消费者、完整回归、最终验证与生命周期提交。
尤其不能把本基础的 Worker 测试当成 Engine 全链路证明。

## 父代理对结构观察边界的决定

父代理已读取本证据、当前 Worker 动态导入和 Observer 的 source-boundaries、
subjects 及 imports 回归。Observer 目前的豁免确实仅覆盖 Node CLI 本地配置入口，
不能用于 npm 类型守护 Worker。该阻塞是新隔离运行机制的直接验证依赖，
不是必须放宽已接受目标或请求用户新增业务需求的阻塞。

依据用户授予的实施监督权限，批准在本实现内补齐严格的 Node 类型守护 Worker 模块边界观察，
作为直接相关工具适配；不批准忽略 computed-import、伪装 CLI、
关闭规则、改期待值为 unverified 或把声明本身视为安全证明。

扩展必须绑定明确的 Node Worker 入口和本地模块加载语法，并校验宿主提供的模块位置；
匹配项只证明已声明的动态插件边界，不证明外部插件静态依赖已被枚举。
未声明、非 Worker/Node 场景、远程 URL、任意动态表达式及其他导入继续保持原判定。
对应声明、解析、Package/Monorepo 观察路径和文档须一致，
正反例及真实仓库观察须验证，不能改变关联 Idea 的验收或生命周期。

此决定允许实施代理继续完成 I-S01–I-S03，不接受当前部分实现；
所有验证和精确 submitInner 仍须在完整实现及同步后由父代理审查。

## 完整候选验证

已将静态 Host 注册、独立类型守护、完整 Run 开始/终结、Input-only 共享、指定 Run 取消、
消息持久化/幂等/接纳/Task signal、checkpoint 与终结后证据、
Check/Probe 资源及 Child 所有权桥、纯历史复验、SQLite v3、UI/例子及独立消费者全部对齐。
模块不在 Engine 初始化；默认无继承环境/execArgv、无共享可变内存，模块内容身份纳入契约。
机器内容不塞入 Progress；准备后分配前的 checkpoint 可跨 Crash 保留，不恢复调用栈或重跑 Run。

实际执行结果：

- `pnpm exec tsx --test packages\task-engine\test\whole-run.test.ts packages\task-engine\test\result-context.test.ts packages\task-engine\test\engine.test.ts packages\task-engine\test\event-binding.test.ts`：35/35 通过。
- `pnpm --filter @potential-guide/task-engine-storage test`：25/25 通过。
- `pnpm --filter @potential-guide/objective-monorepo-standard test`：58/58 通过，
  严格正反例与真实仓库 pilot 仍为 pass，没有改为 unverified。
- Check 完整 suite：20/20 通过；Probe 完整 suite：17/17 通过。
- 最终 `pnpm check`：退出码 0，完整 build/layers/format/lint/typecheck/test/pack:check 通过；
  输出 `.cache\run-complete-check-10.log`。此前失败日志保留，不计为通过。
- 独立 tarball 安装覆盖 generic task、HTTP/SQLite、programmatic/CLI Server、
  HTTPS/file Checker、Probe、历史/SSE 重连及生产依赖图。mvp-check 显式读取新 Result.result/evidence，
  不使用旧结果成功形状 fallback。

此前全量运行在不同 Objective test 文件出现无断言的进程级失败，独立 suite 可通过。
将该包 Node test 文件并发限制为 1，保留全部测试及测试内真实并行案例，
使新增 Worker 回归与全仓 Turbo 并发同时运行时保持有界进程资源；没有关闭检查或豁免规则。

关键可复验来源：

- `packages/task-engine/test/whole-run.test.ts`：准备中共享、迟到结果、无伪绑定消息路由、
  queued/accepted 幂等、目标拒绝、独立需求撤回及主线程数据隔离。
- `packages/task-engine/test/type-supervisor.test.ts`：多 Run、指定取消、持久化确认边界、
  Never、拒绝上报及卡死恢复不自动重跑。
- `packages/task-engine/test/result-context.test.ts` 与 `result-type.mjs`：
  模块在主线程初始化即失败，恢复损坏业务证据明确拒绝。
- Check/Probe restart 与 SQLite crash suites：完整开始事件、checkpoint、原内容/期限及不可自动重跑。
- `packages/objective-monorepo-standard/test/imports.test.ts`：声明、Node Worker、本地加载链的正反例。

当前没有通用 Regulator 注册，消息测试使用可验证的类型消费者；未实现新的 Regulate 系统。
OS 权限/恶意模块发布已传数据不属于此内存隔离验收。未知副作用、未确认清理和接纳不等于消耗
均显式保留，不把重启、postMessage 或百分比当作成功。

## 并发主线整合后的最终候选

通过普通 Git 保全/整合引入 primary `ea6e3cb` 的已接受 UI 改造，未改其他 Idea 的
事件或世界契约。保留 React/Tailwind 工作台、独立 Tab/抽屉、焦点和 glyph 操作、
每响应 CSP nonce，以及权威目录的独立权限、冻结分页和预算。
新目录完整对齐为 `RunQuery/RunSummary/RunPage`、`listRuns`、`GET /runs`、
`list-runs` 和关联查询 `runId`；不是删除并发新增能力，也不提供旧字段成功别名。
accepted ideal 的 Git tree 仍为 `2a35f74813b38242f3f2331feaf50d698174acd8`。

提交前实际复验：

- Engine 全 suite：104/104；HTTP：8/8；SQLite：26/26；UI：48/48。
- `pnpm --filter @potential-guide/task-engine build` 后
  `pnpm exec tsx --test packages\task-engine\test\result-context.test.ts`：1/1，
  证明 checkpoint 复验不能借用仍活动的进度能力，损坏终结/恢复证据不能返回成功形状。
  未刷新构建时的失败如实保留在 `.cache\run-final-pure-verification.log`；
  Worker 使用编译产物，不能把旧产物的失败当作新实现已验证。
- 最终 `pnpm check`：退出码 0，日志 `.cache\run-complete-check-merged-4.log`；
  完整 layers/build、format、lint、typecheck、test 和真实 tarball 独立安装消费全部通过。
- `silvermoon check --worktree --audience agent` 在普通主线整合后退出码 0；
  此前另一 Idea 的并发历史前缀拒绝和合并保护均未绕过，也未手改其事件日志。

本候选只提交完整实现及证据；实施验收仍由父代理监督，未记录 acceptInner/acceptOuter，
未执行部署或 npm 发布。
