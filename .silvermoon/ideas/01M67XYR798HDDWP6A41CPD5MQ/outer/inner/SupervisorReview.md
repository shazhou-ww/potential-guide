# 父代理实施审查

审查对象：实现提交 `181ffea7fa29fd0c5ffb7da5388e011aaf20f01c`，
已提交 implementationRevision `aea5cc373dfd35ae4afb6502bd754392d597218e`。
本轮未接受该候选；以下修正完成后须重新验证、同步并提交精确 revision。

## 已核对的证据

实施代理报告完整 pnpm check 通过，相关回归与独立 tarball 检查记录在
[BoundaryEvidence.md](./BoundaryEvidence.md)。父代理已读取核心 Run 协议、类型守护与 Worker、
Engine 的准入/共享/消息/恢复/结果/回收路径，以及 Check/Probe 适配器、
结构 Observer、关键回归和持久化投影；不将代理自报通过代替代码审查。

## 必须修正的问题

### R01: RunFailure 携带的结果绕过终结业务复验

[类型 Worker](../../../../../packages/task-engine/src/type-worker.ts) 的成功结果调用
verifyExportName 的 terminal 复验；RunFailure 分支只执行 resultSchema 结构校验，
随即向宿主发送失败结果。结构合法但业务证据无效的内容会成为当前可读取的 Run Result，
而在恢复时才被 verify 拒绝，导致运行中与恢复后的业务证据边界不一致。

父代理用独立本地类型复现：run 抛出 RunFailure，附带 `{forged:true}`；
verify 始终抛出业务证据拒绝。实际宿主仍收到：

```json
{"error":{"code":"business_failure","message":"failed"},"result":{"forged":true}}
```

要求失败结果与成功结果同样经隔离边界内的纯 terminal 业务复验，
拒绝时不能持久化无效 Result，保留显式错误且不错误确认清理。
添加失败证据拒绝与合法失败结果的回归，覆盖正常运行和恢复一致性。

### R02: 已确认物理回收时宿主资源动作仍在执行

[类型守护](../../../../../packages/task-engine/src/type-supervisor.ts) 收到 released 即删除 Run
上下文并调用 channel.released，但没有等待该 Run 已投递的宿主资源动作。
类型 run 可以启动 resources.invoke 而不等待，然后返回；Worker 的终结等待只覆盖
progress/checkpoint/消息确认队列，不覆盖宿主资源请求。

父代理使用有界本地复现：资源动作被门闩阻塞，类型不等待它便返回。
实际观测：

```json
{"resourceStarted":true,"resourceFinished":false,"releasedBeforeResourceFinished":true}
```

这使 Engine 可能记录 run.reclaimed / 放行 waitForTaskRelease，
但已知宿主动作尚未停止，违背物理回收证明。不能只靠类型实现自觉等待来修复。

要求宿主跟踪每个 Run/Worker 代际的在途资源动作，在确认回收前取得完成/清理证明；
不能确认时显式保持未知，不能无限等待或成功形状回退。
旧代际异步回调不得改变新代际的在途集合或释放状态。
添加未等待资源、指定取消、失联/代际更换及回收确认时序的针对性回归。

## 后续审查

上述两项是当前已复现的阻塞修正，不需要用户新增业务决策。
交原实施代理修正并更新证据；重跑覆盖变更的针对性验证及 pnpm check。
只有完整候选重新同步 primary、submitInner 生效且父代理审查通过后，
才能依据用户委托审批准确实施 revision，并进入外部验证。

## 实施代理本轮修正

保留以上父代理审查原文与复现；没有把此前 pnpm check 通过解释为已覆盖这两项问题。

- R01：统一 schema/纯 terminal 业务复验路径，失败结果不绕过验证；
  复验前固定 canonical 内容，拒绝返回值改写和原地改写。
  只拒绝无效失败 Result，合法失败 Result 仍持久化并可恢复复验；
  原 RunFailure code/message 和 reclamation_unknown 语义不替换为成功清理。
  checkpoint 同样检查复验不能改写，未删证据通道。
- R02：宿主保存唯一在途 token、Run/代际上下文及释放等待状态；
  released 关闭路由后等待全部已启动动作及可信适配器清理证明，不依赖插件 await。
  lose 不清空仍在执行的 token，新代际同数字 ID 不受旧 finally 影响。
  healthMs 内无法证明时记录未知，close 明确拒绝；迟到回调不复活旧 Run。
  Host 必须声明请求级 resourceLifetime，或提供 confirmResourceRelease；
  默认不把资源回调返回解释为跨请求 owner/句柄清理。
  Probe 的实际子需求桥按 Run/代际记录所有权并等待 cancel/release，不能凭句柄返回确认回收。

已执行定向回归：

- 构建 task-protocol/task-engine/check-task/probe-task 后，R01/R02 与 Probe 资源证明
  新回归 14/14 通过，输出 `.cache\run-review-targeted-2.log`。
- 本轮完整相关 suite：Engine 117/117、Check 20/20、Probe 18/18、SQLite 26/26，
  输出 `.cache\run-review-packages.log`。
- 本轮 `pnpm check` 完整通过，退出码 0，日志
  `.cache\run-review-complete-check-2.log`，包含 build/layers/format/lint/typecheck/test/pack:check
  及真实独立安装消费者；Engine 117/117、Probe 18/18、UI 48/48。
  首次本轮整仓运行因新负例显式 undefined 不满足 strict 可选类型而失败，
  日志 `.cache\run-review-complete-check.log` 保留；改为明确省略字段后完整复验通过，
  未放宽编译配置或实际资源声明要求。
- 修正提交及精确 submitInner 以 Git 和 events.jsonl 为准；
  未接受本轮候选，未记录 acceptInner/acceptOuter。
