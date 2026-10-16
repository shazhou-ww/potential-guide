# 函数式 Pilot / Regulator 迁移指导

本文面向 Silvermoon 等消费方，说明破坏性迁移的入口与行为变化；不表示 Silvermoon 仓库已经迁移。本轮产品以 0.x RC 发布，安装时显式指定已发布的 RC，不使用仍指向旧版或 placeholder 的 latest。

## 1. 包与导出

| 旧入口 | 新入口 |
| --- | --- |
| `@potential-guide/objective-guide` | `@potential-guide/objective-pilot`；旧包退出 workspace 和产品发布清单，不提供兼容包装。 |
| `createObjectiveLoader` 返回有状态 Guide 实例 | `loadPilotSpec(uri, resources)` 加载规格；`observe(input, runtime)` 构造单次观测 Effect。 |
| 实例上的文档访问 | `readPage(spec, id, language)`、`searchPages(spec, query, language)`、`describeLevels(spec)`。 |
| 旧 check runner | `createProcessCheckProbe`、`createHttpCheckProbe`、`createMemoryCheckProbe` 或直接实现 CheckProbe。 |
| 旧有界 Regulator 入口 | `makeRegulatorSpec` 纯构造；`regulate(input, runtime)` 构造完整调节 Effect。 |
| 各领域自行管理运行取消 | `@potential-guide/effects` 的 `startEffect` / RunningEffect；复用原生 Effect / Fiber / Scope。 |
| CLI 的 Objective 目录摘要作为版本 | `@potential-guide/git-source` 的确切 commit 快照；内容摘要不再冒充 Git 版本。 |

Supervisor 包名不变，只适配新的领域执行接口；CLI Core 不依赖 Objective 领域包。Git 来源不依赖 Pilot：它只提供不可变仓库快照，内容解释在资源适配层完成。

## 2. 规格、身份与版本

- PilotSpec 是可序列化的已解析定义，包含 Objective 身份、manifest、Wiki 与来源版本；不是带订阅或进程的实例。`loadPilotSpec` 使用 ResourceResolver 的确切版本；多仓库前置通过 versionFor 按 Objective 获取各自 commit，不把未提交文件标成 HEAD，也不将根仓库版本复制给其他来源。
- RegulatorSpec 由 Pilot 规格、Strategy 与 AgentBinding 组成；subject 单独放进 RegulationInput。目标 LevelId 和 Agent 单次执行限制属于 Strategy，不能在外层再维护另一份配置。
- 本地类型的字段名称以各包导出的 TypeScript 类型为准：当前配方字段为 `pilot`、`strategy`、`binding`；输入字段为 `spec`、`subject` 和可选 `language`。
- Objective URI 标识 Git 仓库及定义路径，例如 `git+https://github.com/owner/repo.git#objectives/project/pilot.yaml`。commit 与该稳定身份分开。测试可使用明确的 git+file 来源，不以裸文件路径充当全局身份。
- LevelId 是规格内的身份，不能按数字或字符串大小推断层级。跨上下文使用 LevelRef / CheckRef / ProblemRef；ProblemId 表示问题类型，不表示修复任务。
- GitSnapshot 带本地读取能力，不能序列化。所有读取与消费者运行必须发生在快照所属 Scope 关闭之前；不要从已经关闭的 scoped effect 中返回快照供以后读取。

## 3. 单次观测与运行包装

以下函数可放进消费方的 TypeScript 模块，资源和检查实现由消费方注入：

```ts
import { startEffect } from "@potential-guide/effects";
import {
  observe,
  type PilotInput,
  type PilotRuntime,
} from "@potential-guide/objective-pilot";

export async function inspect(
  input: PilotInput,
  runtime: PilotRuntime,
  signal: AbortSignal,
) {
  const running = startEffect(observe(input, runtime), signal);
  const envelope = await running.await();
  if (envelope.status !== 200 || envelope.payload === null) {
    throw new Error(envelope.message);
  }
  return envelope.payload;
}
```

构造 observe 的 Effect 不会启动检查；startEffect 才启动。RunningEffect 的 cancel 发出取消，await / exit 等待最终结束和清理；取消不是业务 Outcome。已取消的父 Signal 不执行用户计算。

完成的 PilotObservation 包含当前 LevelRef、完整晋级障碍、时间和来源版本，不含顶层业务 ok。首次异步结果前用 initial，不伪造“最低层级成功”。业务是否通过只在每个 CheckResult 的 ok / problems 中表达。

## 4. Probe 协议

旧进程 check 的 stdin 包装和 `{ pass: ... }` 输出不能直接沿用：

| 边界 | 新协议 |
| --- | --- |
| stdin / HTTP POST | subject JSON 本身，不是 `request.subject` 包装。 |
| 正常完成 | `{ "status": 200, "payload": CheckResult, "message": "..." }`。 |
| 业务缺陷 | status 仍为 200；payload 为 `{ "ok": false, "problems": [...] }`；进程 exit code 仍为 0。 |
| 调用故障 | 4xx / 5xx、payload 为 null、message 提供明确诊断；不伪造可信层级或空问题成功结果。 |
| 日志 | 进程 stderr 或 HTTP 服务自己的日志；不放进 stdout 主信封或主观测流。 |

成功示例：

```json
{"status":200,"payload":{"ok":true,"problems":[]},"message":""}
```

检出缺陷示例：

```json
{"status":200,"payload":{"ok":false,"problems":[{"id":"not-ready","parameters":{}}]},"message":""}
```

Probe 必须清理自己创建的临时资源，不负责回滚业务状态。进程版处理优雅终止与宽限期后的兜底清理；HTTP 取消只放弃本端等待，不承诺远端停止。临时仓库、物化代码和检查缓存均使用项目下的 `.cache` 或显式注入的项目缓存目录，不使用 OS 临时目录执行产物。

## 5. Agent 与完整调节

- 一次 regulate 可以反复执行 Pilot → Agent → Pilot，直到达到目标或返回明确停止原因；不是一次 Agent 调用，也不接收外部 PilotObservation 作为启动参数。
- AgentInput 带完整观测、目标、subject、绑定与单次执行限制，不再仅发送 `problems[0]`。Agent 自己组织修复，不要求消费方为每个 ProblemId 建任务。
- Agent 单次超时 / 限额不等于整个调节的最大轮数或停滞预算；旧跨轮 limits 配置不再支持。
- 探测模式通过 Strategy 的 `mode` 区分 adhoc / periodic；探测调用的 timeout / retry 与 Agent 单次 timeout 分开。4xx 不重试，5xx 按有限重试规则处理。`effectTtlMs` 约束运行效应的生命周期，不是跨轮迭代预算，也不能替代 Probe 的清理宽限期。
- 配置采用 schemaVersion 2；`agentExecutionLimits.timeoutMs` 作用于每次 Agent 调用。旧 schemaVersion 1、旧跨轮预算和旧持久化记录需显式迁移，不能直接按新类型读取。
- RegulatorOutcome 是完成结果，不能拿它取消已经运行的任务；取消使用外层 RunningEffect。

## 6. CLI 与恢复记录

仓库或已安装候选的命令示例：

```powershell
pguide scaffold pilot .\my-pilot
pguide validate pilot .\my-pilot\pilot.yaml
git add .\my-pilot
git commit -m "Add Pilot definition"
pguide probe --pilot .\my-pilot\pilot.yaml --subject-file .\subject.json
pguide regulate --pilot .\my-pilot\pilot.yaml --subject-file .\subject.json --target terminal --agent-timeout-ms 30000
```

先为仓库配置可解析的 origin，以便本地路径对应稳定的 Objective URI。对远程或明确 Git URI，可使用 `--revision` 指定 ref / commit。静态 scaffold / validate 可以在未提交时运行；probe / regulate 必须使用确切的已提交快照。本地脏定义不能无提示地被贴成 HEAD 版本。

`--guide`、`scaffold guide`、`validate guide`、旧的跨轮预算参数不保留兼容别名。Agent 仍通过用户配置中的命名 ACP profile 装配；凭据不持久化到调节规格或记录。

continue 读取新版本记录中的规格来源、确切 commit、subject 和单次执行限制，重新建立本地运行能力；不恢复旧内存对象。已经达到目标时不启动 Agent。Agent 会话恢复是 CLI / ACP 传输能力，不应污染纯领域配方。

ACP 会话 ID 在 prompt 前持久化；continue 在有 ID 时调用真实 session/resume。已要求会话恢复却没有可用 ID 时明确报错；可选恢复但缺少 ID 时，新建模式明确记为 new-without-session-id，不将恢复失败静默伪装成成功的新会话。

## 7. Behavior 与依赖更新

生产实现复用原生 SubscriptionRef 的当前值 / changes 和 Scope 生命周期，领域适配为 `pilotBehavior` / `regulatorBehavior`。纯映射与有 I/O 的领域加载必须分开；后者通过通用效应提升，不直接当成纯 fmap。

互相关联的输入应先提交为完整根快照。多个独立 ref 的 latest 组合不自动具有事务一致性。替换只影响变化的依赖：策略或绑定变更保留未变化的 Pilot；旧任务先收到 Abort，新任务无需等待旧清理结束，但旧结果不能覆盖当前状态。取消不等于业务回滚，也不保证外部副作用没有重叠。

## 8. 消费方验收

先用候选 tarball 验证 import、类型、CLI 与实际修复闭环；产品 RC 发布后，再从 npm 安装确切 RC 版本重复验证。检查内部依赖已从 workspace 范围转换为可解析的发布范围，不依赖源码路径。

仓库的 `pnpm deployment:verify` 检查独立打包消费者；`node scripts/verify-deployment.mjs --published` 检查独立 npm RC 消费者。后者在获准访问 registry 的 GitHub-hosted CI 执行，本地网络策略受限时不绕过访问限制。具体发布规则见[npm 发布说明](./npm-publishing.md)。
