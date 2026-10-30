# Check + Server MVP 实现证据

本文件仅服务 Inner World 实现门禁，不是独立契约或部署验收。
Ideal World 未修改；Probe、Regulate、旧重构 idea 生命周期及 npm 发布均不在本次范围。

## 实现门禁反馈修订

父代理审阅复现了 CLI 启动回滚超时后仍被配置保留的 interval 阻止退出：
顶层 catch 仅设置 exitCode，不等于有界进程退出。现已将该 CLI fatal startup
路径改为明确输出 `Startup failed; physical cleanup unconfirmed.` 并 `process.exit(1)`。
既有 shutdown failure 分支已使用非零终止，不需改变。程序化 `startTaskServer`、
借用资源与 Store ownership 语义保持完全不变，不将终止进程误称为清理成功。

新增 `packages/task-engine-server/test/cli.test.ts` 与独立本地配置 fixture，
实际启动构建后的 `dist/main.js`，覆盖四种保留 interval 的故障：
25 ms rollback 超时、rollback 抛错、配置 import 抛错、异步配置 factory 拒绝。
每项都断言退出码 1、没有信号终止、明确失败诊断、没有 `ready` / `closed` 成功记录，
并断言测试保护计时器**没有**执行 kill。保护计时器为 3 秒，只用于在回归失败时清理
测试拥有的子进程，不作为成功退出的手段。

修复前用以下命令真实复现 **4 项失败**，全部需要测试保护终止：

```powershell
pnpm --filter @potential-guide/task-engine-server exec tsx --test test\cli.test.ts
```

修复后 `pnpm --filter @potential-guide/task-engine-server build`、
`pnpm --filter @potential-guide/task-engine-server test` 和
`pnpm exec tsc -p tsconfig.test.json --pretty false` 均通过。
Server **10/10**（含原有程序化语义 6 项）通过，无 skip；
四个新增真实进程测试分别约 **183 / 138 / 137 / 133 ms**，均无需保护 kill。
随后再次完整执行下文 `pnpm check`，退出码 **0**，包括全部独立 packed consumer，
并重新保存实际安装图。相关 I 项据此恢复完成；仍需父代理对新 revision 作实现门禁决定。

## 已验证交付物指纹

完整检查通过后由待提交 Git index 提取，后续仅补充本 Inner World 证据及事件：

| Git tree | 完整 OID |
| --- | --- |
| `packages` | `b7b9ad4ff41ef3421676cfe8cd61b658f0a1c977` |
| `scripts` | `729d96eee1632f9c58f7df38e50fdc4a8fb0d23a` |
| `docs` | `b7b5f26bc25a207decf44978df0d2a2681c985cd` |
| `examples` | `8c73f786d29beece7f0101e1514f91bca4fbefb5` |

可用 `git rev-parse <实现提交>:packages`（及其余目录）复核。

## 结构与审阅入口

| 要求 | 实现 / 证明 |
| --- | --- |
| 唯一纯契约规则与无 IO | `packages/check-artifacts/src/pure.ts`、`paths.ts`；`test/pure.test.ts` 的独立进程禁用网络、写盘、worker/process API，以及 esbuild 实际导入图 |
| manifest / 全量制品 / runtime 三层 | `pure.test.ts` 分别构造合法 manifest 缺文件、References 缺页、内容变更摘要不同、全量合法而 Node 最低版本不满足 |
| 授权与准确缓存 | `packages/check-task/src/prepare.ts`、`test/source.test.ts`：每次命中重授权，source/scope 绑定，错误 digest 不命中正确缓存，篡改与来源拒绝显式失败 |
| Prepared / 结果 | `check-task/src/index.ts` 保存全量文件的 base64、准确 reference、subject、语言、entry bytes 的独立 SHA-256 workerRevision、实际 runtime 与已安装 adapter/worker 实现摘要；旧数据不会通过下载更新替换。结果规则复用 `parseCheckerResult`，声明的问题同时在 worker 和 Prepared-bound hook 中校验 |
| 通用引擎扩展兼容 | `task-protocol/src/types.ts`、`task-engine/src/engine.ts`、`test/result-context.test.ts`；不更改原 `validateResult` 的参数语义，新增可选 hook，冻结受信任上下文 |
| 实际 worker 与生命周期 | `check-runtime-files/src/worker.ts` 从旧 Host 提取；旧 `check-host/src/worker.ts` 保留公开构建路径。新 `check-task/src/worker.ts` 直接使用该机制，通过现有通用 Pool 处理执行、退出、cleanup |
| 实际 HTTP/SSE | `task-engine-server/src/index.ts`、`test/server.test.ts`、`check-task/test/check.test.ts`：鉴权、scope、共享取消、分页、Last-Event-ID 重连、活动流关闭 |
| 默认 Store 与重启 | `check-task/test/restart.test.ts` + `restart-child.mjs`：真实独立进程 + Node worker + SQLite，杀死 owned 进程后恢复 queued 精确内容；started 未知执行 interrupted，身份与 deadline 保留，marker 证明没有重跑 |
| 失败不虚报关闭 | Server occupied-port、无效 TaskType/handler、重复 SQLite owner、超时关闭、物理 cleanup 抛错；拒绝关闭时 lease 仍被持有 |
| 打包消费者 | `scripts/check-mvp-consumer.mjs`；纯契约单包、无业务 Server、Check + Server 三个独立安装图，程序化与真实 CLI、HTTP/SSE 都使用包导出，不使用源码或旧 Host |
| 示例与边界 | `examples/task-server`；`docs/task-server.md`、`docs/task-engine.md`、`docs/artifact-contracts.md` |
| 仓库声明与动态配置边界 | 新增两个 package-owned `objectives.yaml`，更新 root coverage / CLI delivery；原静态 observer 将必需的本地配置 import 判为未验证，因此新增显式 `localConfigurationImports` 声明。仅 Node CLI 的已声明 entry 且 AST 为实际 Node imports 组成的 `pathToFileURL(resolve(...)).href` 可识别；HTTP 文件、任意动态 URL、未声明动态 import 仍未验证。未把源文件伪装成 generated，也未降低既有未声明导入规则 |

## 运行与资源约束

- Check 每次执行有独立 worker 及私有快照；business `ok:false` 正常完成，
  未声明 problem、异常、非法 envelope、timer/defer/dispose 清理故障则失败。
  Pool 只在退出与 cleanup 均成功后复用容量，不能靠计数或取消快照伪造回收。
- Worker 的 Node builtin 能力不构成恶意代码 sandbox；只执行经过来源授权的受信任制品。
  配置只注入明确的环境变量，不默认继承凭据；环境标识可持久化，因此不得含秘密。
  不允许把 detached/unmanaged 外部服务的生存期解释为受控 worker 清理。
- Prepared 采用可恢复全量内容而非可变缓存路径。默认 Engine 64 KiB 适用于小制品；
  示例显式设为 8 MiB，需要按实际制品和存储预算配置。下载层另有文件集和并发上限。
- 进程内调用方拥有注入的 source；Server `closeResources` 在 Engine 回收之后、
  实际 Store lease release 之前关闭 source/pool。借用 Store 不会被 Server 关闭。
  无法确认清理时 API 拒绝，CLI 非零退出，绝不输出成功 `closed`。

## 验证命令与结果

从本 worktree 根目录执行，使用仓库 pnpm catalog 和 Node 原生 test runner through tsx。
无需新增测试框架或发布令牌。

已通过的开发检查：

```powershell
pnpm --filter @potential-guide/check-task... --filter @potential-guide/task-engine-server... build
pnpm exec tsc -p tsconfig.test.json --pretty false
pnpm --filter @potential-guide/task-engine --filter @potential-guide/task-engine-server --filter @potential-guide/check-task test
pnpm --filter @potential-guide/check-artifacts test
```

新增 Check 测试 11 项、Server 测试 10 项均通过；制品测试 22 项通过。
Check 还实际验证超过默认 64 KiB 的制品与结果：显式 Engine payload 预算生效，
不因内部便利 object helper 的默认值而错误限制完整 Prepared，也不移除配置上限。
纯契约规则测试包括旧格式回归，非只测试新增入口。
开发中发现直接扩展 `validateResult` 的第二参数会破坏已有 `json` validator，
已改为可选独立 hook 并重新执行引擎回归和全仓测试类型检查。
完整检查的一次运行遇到旧 Host discovery 的 Windows `EPRIVATE read/` 一过性失败（未归因）；
未修改或降低私有文件验证。原命令隔离重跑
`pnpm --filter @potential-guide/checker-host exec tsx --test test\discovery.test.ts`
两项均通过（含 early/claimed/published crash，四并发 caller），随后原样重跑全套。

最终完整检查通过，退出码 **0**；完成日期 **2026-10-30**，
环境 **Windows x64 / Node 24.11.1 / pnpm 11.22.0**。准确命令：

```powershell
$env:PGUIDE_MVP_EVIDENCE_DIRECTORY='.silvermoon\ideas\01M65ABHR94EQ14NYTGZAWRRV3\outer\inner\dependencies'
pnpm check
```

该环境变量仅保存已经实际检查的安装图，不关闭或替换任何断言。
`pnpm check` 完整执行 layers/build、format、lint、typecheck、test、pack:check；
包括原有 Host/制品消费者回归。打包记录为 Check **15 files**、Server **11 files**；
独立安装消费者全部通过，含原有 main、pilot、regulation、coordinator、artifact-hosts 等。
新的 CLI 同时实际验证 `--help`、`--help --format json` 和启动配置，不借用旧 CLI 核心。
本次未发布任何 npm 包，也未增加可发布 tag inventory。

三个新增独立消费者的真实安装遍历图随本文件持久保存：

- [artifact-contracts.json](dependencies/artifact-contracts.json)：1 个直接选择，
  16 个实际安装包（2 个内部包）。
- [mvp-server.json](dependencies/mvp-server.json)：3 个直接选择，
  5 个实际安装包，只有通用 task 五包，无制品、Check 或旧 Host。
- [mvp-check.json](dependencies/mvp-check.json)：5 个直接选择，
  22 个实际安装包（8 个内部包），没有旧 Host。

记录保留每个实际实例的版本与首次到达的父依赖，重复到达的边去重；
不是根据 package.json 猜测的列表。包管理器实际目录均验证位于独立 consumer 内，
不能借用工作区 node_modules。fixture 在测试结束清理，以上证据不依赖保留缓存目录。

## 安装依赖决策

保留 `check-artifacts` 的 `/build` 和根 API，不额外拆作者构建包。
当前独立契约消费者的需求是可独立调用并无下载/写盘/执行副作用，
并非本 MVP 必须达到零安装构建依赖。仅新增 subpath 不会减少 package dependencies；
拆新包但保留兼容 re-export 也不能消除旧包对构建包的安装依赖。
因此选择明确记录真实成本而不破坏旧消费者：
`esbuild`（含本机 optional binary）、`tar`、`check-runtime-files` 仍会安装，
但不会从纯契约入口导入。最终实际 production 安装图由打包测试枚举，而非静态推断。
实际观测版本包括 `esbuild@0.28.2`、`@esbuild/win32-x64@0.28.2`、
`tar@7.5.22`、`ajv@8.20.0`、`yaml@2.9.1`。纯入口在真实安装中完成
Checker/Objective 全量校验且禁用写盘、网络、worker/process API 后仍通过。

## 平台边界

本机为 Windows。库程序化关闭与活动 SSE 的正常结束均实际验证。
Windows `ChildProcess.kill("SIGTERM")` 是强制进程终止，不会声称验证了可捕获 POSIX
SIGTERM 回调；真实 CLI readiness/业务调用/进程退出仍测试，POSIX 上另断言退出码 0。
Node SQLite 的 experimental warning 不等于测试跳过。
新增 Check 11 项、Server 10 项均无 skip。完整仓库保留 6 个已有条件 skip：
POSIX private-file reopen、POSIX executable permissions、POSIX mutation lock、
平台大小写敏感 real-path、native Linux dispatch，以及直接发现时未设置
`V2_BUSINESS_DIRECTORY` 的旧 CLI-runtime 独立 case。没有取消这些条件或宣称在 Windows
实测了 POSIX 行为。实际跨进程 SQLite/worker 重启与 Server 程序化正常关闭均非 skip。
所有本次创建的 helper 子进程按精确 PID/child handle 清理；测试数据位于仓库 `.cache`，
正常测试结束删除所属目录；不触碰其他工作区或无关进程。
中断开发测试留下的 9 个已识别所属 fixture 目录已单独删除；
最终按本 worktree 命令行标记检查进程，无本次遗留 helper/server。
