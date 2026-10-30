# 事件时点绑定与破坏升级准备说明

服务于 [Implementation.md](Implementation.md)，不是第四份契约。
准备期以 `6ffc3cb959ac58d355856fbbc210bf50758b3150` 的源码与测试形成以下方案；
实施期从父代理已同步并接受 Ideal 的 `8b10945d7600b25529d7b21e63a43c6810c03f2a`
开始。本文保留方案与实施约束，实际验证见 [实施验证](Verification.md)，
不替代精确 revision 的 submitInner/acceptInner 或外部验收。

## 实际入口与必须改变的旧行为

以下路径均相对仓库根目录：

- `packages/task-protocol/src/types.ts`、`projection.ts`：旧枚举、严格 `>`、
  `Facts.projectionVersion: 1`；reducer 仅允许 queued Task 绑定，不能接纳尚未 prepare 完成的需求。
- `packages/task-engine/src/engine.ts`：`parse` 直接采用请求时间；
  `compatible` 额外比较 Prepared；`allocate` 运行中补绑；`startGroup` 将所有 owner 提前绑定；
  `settle` 搜索历史完成执行。必须一起改，不能只更名或修正时间 helper。
- 同文件 `active`/`protectedOwners`、`hasUncanceledOwners`/`reclaimUnowned`、
  `waitForTaskRelease` 和压力替换重检目前依赖结果绑定，需识别终结策略尚未绑定的需求。
  `start` 的中断恢复、准备异步回调、投影、历史 watermark 与订阅亦受事件原子性约束。
- `packages/task-engine-storage/src/index.ts` 当前 SQLite `user_version=1`、
  checkpoint `projection_version=1`，且版本检查前已设置 WAL；不能只改一个常量。
  `packages/task-engine/src/testing.ts` 的 MemoryStore 与注入式 Store 也必须守住投影版本边界。
- `packages/task-engine-server/src/index.ts` 使用显式 database 或默认 `tasks.sqlite`；
  HTTP 把引擎 `invalid_request` 映射为 400。服务启动不得发现旧库后自动覆盖或换名假装成功。
  `src/main.ts` 输出的 `schemaVersion: 1` 是 CLI 描述，不是持久事实版本，不能盲目替换。

## 统一语义矩阵

前提：Task 尚未取消、尚未绑定其他执行或终结；type、version、environment、scope
隔离和授权满足；保留 subject 身份事实及 caller 授权，不以 Input 相同授予权限。
Input 相等调用原 TaskType 的 `equals`，不改成 JSON 相等或以 Prepared/digest 比较替代。
候选必须在目标事件前已被接收；使用持久事件顺序，不用相等时间戳推断接收顺序。

| 场景 | 候选规则与可观察结果 |
| --- | --- |
| started 策略 | 仅在 `execution.started` 时选择并绑定当时合格 Task；以后接受该执行的成功或失败，不在运行中或完成后补绑。 |
| terminated 策略 | start 不绑定结果；在 `execution.completed` 或 `execution.failed` 时选择并绑定，成功与失败保持各自结果。运行中的旧执行可服务后接收需求，但只在终结事件当时绑定。 |
| prepare 未开始、未完成或 Prepared 不同 | 均不阻挡上述事件匹配；真正发起新执行仍需某个代表完成 prepare。绑定后取消本 Task 多余准备/排队；迟到准备回调不能覆盖 running/终结状态、重复启动或把成功改成准备失败。已发生准备/分配失败而终结的 Task 不复活。 |
| 时间下界 | `effectiveEligibleAt = max(requestedEligibleAt ?? receivedAt, receivedAt)`，`deadlineAt = effectiveEligibleAt + timeoutMs`；事件时间 `>= effectiveEligibleAt`，等号有效。未来锚点前不匹配，回拨造成事件时间低于锚点也不匹配。 |
| 同毫秒先后 | `task.created` 在目标事件之前可匹配；之后创建即使时间完全相等也不得回查绑定。多个合格执行以先提交的适用事件胜出，Task 只绑定一次。 |
| timeout | 有效结束时间（未结束则观察时间）严格 `> deadlineAt` 才超时；deadline 相等不超时，且不是匹配上界。两策略都可接纳迟到事件，成功且超时、失败且超时均合法。 |
| cancel 与结果竞争 | 取消先提交则冻结本 Task、排除其后结果；可靠结果及绑定先提交则取消不能抹去结果。取消不等同 timeout，不取消其他 owner。 |
| 多 owner | 结果绑定与共享需求分开；未绑定的 terminated 需求也参与保护及最后需求回收检查。个别取消/超时不误杀仍有有效需求的执行；逻辑终结不等于已确认物理回收。 |
| 原始请求与幂等 | `getRequest` 原样保留请求时间及省略字段；snapshot 现有 `eligibleAt` 表示生效时间，不新增同义字段。相同 requestId/意图返回首次 Task/锚点，修改意图仍冲突，不因晚到重试重设 deadline。 |
| 重放与重启 | 重放已经持久化的事件绑定，不用当前 Task 集合重新匹配历史执行。已知成功/失败沿用其事实时间；无可靠终结事实的执行维持“不自动重跑”政策，以恢复时新写的 `execution_interrupted` 失败事件结算当时合格需求，不伪造停机期间结果。 |
| 旧契约 | 显式 `completed-after-eligible` 直接拒绝，无别名。旧 SQLite、旧 checkpoint 或旧 Facts 明确拒绝并提示使用新存储；保留旧数据，不迁移、不覆盖、不自动删除。 |

start/terminate 事件与该事件选中的 binding 在同一原子提交内持久化；
终结时同时持久化对应 Task 结算，避免回调、取消、tick 或重启改变该事件的候选集合。
纯投影及读取只解释事实，不生成新匹配。结果仍按执行自身 Prepared 验证，
而非要求每个接收者拥有相同 Prepared。

## 最小调度与保护方案

保留现有分层：超过 deadline 停止新准备、撤掉未启动排队及防压力替换保障；
已经运行的执行不因 timeout 自动取消。仍有未取消需求时可以继续并接纳结果，
但独立 wall limit、shutdown 和合法压力替换仍可终止它，因此不保证超时后结果。
匹配本身不调用“未超时”谓词；超时 Task 不能独自触发新工作，但可以匹配其他有效需求触发的事件。

用已有 Task/Execution 事实推导兼容的 terminated 需求，不引入公开 join API 或众筹模型：
当前已生效且未超时的需求防止压力替换；未取消、未终结需求用于判断是否无人需要，
不能仅看 `snapshot.execution`。未来生效需求尚不获得防替换保障。
新需求在替换授权时重新检查，以免旧候选判断误伤新 owner。
沿用 sealed 禁止新增需求的边界：seal 时记录当时已有需求集合，使这些需求（包括尚未绑定的
terminated Task）仍可接收随后适用的终结；seal 后不得借历史查询加入。
这只是持久化回收边界，不是提前结果绑定。物理 release 等待也要采用同一需求口径。
取消时以取消事件保存释放关联，重启也不能丢失未绑定需求的物理退出证据要求；
该关联不是结果 binding，不让取消 Task 接收后续结果。

## 最小版本边界

一次性把 SQLite `user_version`、checkpoint `projection_version` 和
`Facts.projectionVersion` 升为 2，并在引擎接收 StoreView、reducer 与存储读取处一致检查。
无须额外维护协议协商、旧路由或兼容解析器；旧枚举即便被塞进新版本记录也必须拒绝，
不能靠 TypeScript 类型断言让旧 Binding 继续进入结果投影。

只初始化真正的新库/空白库；version 0 但已有应用表或数据不能当作空库接管。
已有文件先只读检查格式，再进行任何 WAL、建表、metadata/checkpoint 写入或 owner 锁创建。
version 1、未知版本、旧 checkpoint/Facts 明确报错，提示指定新的 database 路径；
不执行版本升级 SQL，不改写旧数据或切换旧库 journal mode，不删除或迁移其既有 sidecar。
验证需比较旧数据与数据库文件，
不能只断言异常抛出。默认路径存在旧库也失败，不暗中选备用库。

实施发现：SQLite 的普通 read-only WAL 连接仍会写原 SHM read marks。
无 WAL 时使用 immutable 只读检查；有 WAL 时复制到操作自有的同目录检查副本，
校验源文件复制期间未变化，只在副本上打开 SQLite，最终清除副本及其 sidecar。
此副本只用于读取格式，不是迁移、旧数据重写或新运行库；原文件与 sidecar 字节对比覆盖该边界。

新格式的事件顺序、seal 需求与绑定必须足以从 checkpoint/事件后缀恢复；
事件边界前后故障测试验证整个提交有或没有，不留下“结果已提交、候选集合丢失”的半状态。

## 内部消费者与父代理审查风险

1. **权限原先藏在准备阶段。** check/probe 的 `ArtifactSource.authorize` 当前允许异步，
   新规则不能在其尚未授权时直接复用结果，也不能把完整 Prepared 偷换成授权门槛。
   准备候选选择独立于 prepare 的授权边界：对已知 Input 引用及共享执行所携带的资源引用，
   在接收/事件匹配路径执行可信、同步、无下载的授权判定；由可选
   `TaskType.authorize(input, binding, executionPrepared?, result?)` 承载。
   对内部 source 的异步授权契约一并做破坏升级，显式拒绝返回 Promise 的旧实现，
   不假装已经授权；保留 prepare/execute 的资源访问检查。
   probe 的执行资源引用取执行自身已固定的上下文，终结时额外检查结果中的动态引用，
   不要求接收 Task 重新 prepare。对固定字节的校验不执行网络或文件下载。
   授权拒绝不得产生 binding；权限变化与来源拒绝需要专门回归。这是待父代理重点审查的
   实现约束，不是允许删掉授权；若同步授权不能覆盖实际消费者，先向父代理报告阻塞，
   不以延期补绑或放宽权限绕过。
2. **可变引用的含义会改变。** 当前 check/probe `equals` 比较 Input；
   相同未 pin URL 不再因两次 resolve 的 Prepared 内容变化而隔离。
   这是本次指定 Input 语义的直接后果：返回所选执行实际使用的制品结果，
   需要固定内容的调用者在原 Input 中显式 pin digest，不修改 equals 或静默注入 digest。
   `check-task/test/check.test.ts` 的“changed content cannot share”断言必须改，
   但同一测试中的 source authorization 拒绝保障不能删掉。
3. **适配范围与恢复证明。** 当前实际 TaskType 位于 check-task、probe-task；
   `objective-regulator` 使用 objective-pilot，`regulation-coordinator` 有独立状态格式，
   未发现注册为通用 TaskType 的 regulator。仅回归现有依赖链，不虚构 regulate Task、
   不改其独立 schemaVersion、不修改 regulate-task Idea。以后若 primary 新增消费者，
   由父代理同步后重新核定适配范围。

现有测试还明确固定了旧 Prepared 共享、严格等号、运行中补绑和历史补查：
`task-engine/test/engine.test.ts`、`projection-races.test.ts`、`pool.test.ts`；
需替换相应旧预期而非机械全局更名。保留 `result-context.test.ts` 的原执行上下文、
storage `startup.test.ts`/`storage.test.ts` 的真实故障原子性、历史固定 watermark、
订阅重连、独立 wall cap 与单 owner 取消等保障。

## 后续最小验证入口

准备期文档只运行 `git diff --check`；实施期的实际结果见 Verification。
现有包脚本入口：

```powershell
pnpm exec turbo run build test --filter=@potential-guide/task-protocol --filter=@potential-guide/task-engine --filter=@potential-guide/task-engine-storage --filter=@potential-guide/task-engine-http --filter=@potential-guide/task-engine-server
pnpm exec turbo run build test --filter=@potential-guide/check-task --filter=@potential-guide/probe-task --filter=@potential-guide/objective-regulator --filter=@potential-guide/regulation-coordinator
pnpm check
```

后续独立制品验证归 Deployment 阶段；所有验证目录均位于本工作树拥有的目录内。
父代理负责 Silvermoon 校验、同步、submit 和对应 revision 的审批；本说明不记录任何通过结论。
