# Regulation Coordinator 实施

依据已接受的 [Idea.md](./ideal/Idea.md) 与 [Design.md](./ideal/Design.md)，新增独立 `@potential-guide/regulation-coordinator`。本合同仅覆盖仓库实现；不修改 accepted ideal，不迁移或重接既有服务，不执行 Deployment。可复查的实现决策、命令结果及历史失败边界见 [Verification.md](./Verification.md)。

## Steps

### I-S01 — 新增独立包与 FRP 生命周期

新增包的唯一公共构造函数为 `regulationCoordinator(resources, commands, options)`，返回 scoped Effect 与事实 Stream。资源为第一参数 `SubscriptionRef`；每次 acquisition 拥有一个 mailbox、一个 priority queue/依赖图和两个输入订阅。多个输出消费者不创建调度器。空闲及命令正常结束均不结束实例。

采用 bounded Queue/PubSub：订阅期间有序背压、无历史重放；关闭前 drain 已发布事实。输入故障被监督，scope 关闭停止输入、终止执行并释放自有来源句柄。根 spec 由宿主拥有；所有根及精确 resolver 返回值要求合法 Git source。API、Runner 第三参数 execution context、严格命令字段和宿主用法见新包 README。

### I-S02 — 实现单队列与运行时依赖调度

实现 add/replace/cancel/priority/retry；区分 commandId、业务 ID、generation、runId 与 sequence。仅 dependency-required 反馈创建 consumer-owned 等待边。精确解析在事务外 await，前后检查取消/generation；候选图全量检环通过后才原子安装。按完整 Objective/version/source/subject/language 身份共享兼容 provider，聚合最强 level、最高 priority 与能力并集，以 roots 可达性回收整链。

动态资源校验 binding/capacity/capabilities；无效快照暂停分配并撤销运行，合法快照恢复。P0 最少受害者抢占；running 与 stopping 都占槽，只有 result 实际终止或 kill 确认后释放，abort/kill/release 失败明确发事件。每个 consumer 按自己的 minimum 独立唤醒：当前 run 的合法 observation/progress 及所有合法停止结果的 latestObservation 都更新真实 level，L1 consumer 不必等聚合 L3 目标。进展不代表 provider/consumer 成功，仍由各自 Regulation 判定。

progress 严格关联 runId、generation、当前节点及完整来源，检查 envelope/levels/problems/timestamp；同 run 旧时间证据拒绝。新观察可降级，queued 但尚未执行的 consumer 会重新等待；新 start 清空旧 run readiness，replacement 不复用旧证据。target-reached 单独对启动时捕获的目标检查，不能被 progress 或聚合目标变弱绕过。

可信 options 固定权限及总预算；每次 start（包括抛错）保守预留完整 quota，replace/retry/派生/抢占不补充预算，stall history 单调携带。失败默认零自动重试；显式 retry 亦受剩余总预算约束，可重试仍存活的 blocked 派生 provider。runner 请求通过 execution context 串行关联到 runId，只产生请求事实，不授权、不自动新增能力。

### I-S03 — 固化反例与兼容回归

新增 34 个有界、可重复的状态机/流/资源/依赖/清理反例及 README；接入现有 test typecheck、Turborepo、package-layers、workspace Objective、release/pack inventory 与 ESM/types tarball consumer 检查。只调整这些验证必需的登记与包数量断言，不修改旧服务实现、接线或测试。首次 25 项不能证明最低 level 分级唤醒，原完整 AC 声明已撤回；本修订另补 9 项，覆盖 progress、三类 partial outcome、授权/预算、降级/旧证据、handoff 降级时间顺序、启动目标校验与真正同 scope 的 LIFO 清理。

运行定向构建/类型/测试、旧 Portfolio Supervisor 38 项回归、仓库标准 21 个包的真实检查、完整 `pnpm check` 与正常 `pack:check`。另独立执行旧 CLI 的 capability-feedback 反例，保留其既有失败及缓存日志异常，不把它说成新包已修复；详见 Verification 的基线说明。

## Acceptance criteria

### I-AC01 — 公共包接口与驻留可用

`src/types.ts`、`src/index.ts`、新包测试及 tarball consumer 类型检查证明资源第一参数、请求/事实分离、单实例、空闲/输入结束后的驻留和 scoped 清理；公开接口没有外部 queue snapshot 或 dependency graph。多订阅、无重放、背压及关闭 drain 均有运行断言；实际 Effect.scoped 反例证明同 scope 的 interruptible 消费者在服务清理前取消，不等待自身订阅。外部消费者仍须 drain/取消，cancel/close 不是旁路。

### I-AC02 — 调度与安全反例通过

34 项测试通过：覆盖原调度、资源、终止、图与失败反例，并明确证明同一当前 L3 provider 的 L1 progress 只唤醒 L1、L3 未满足继续等待；exhausted/authorization-required/dependency-required 的合法 L1 observation 同样释放 L1，不能绕过消费者自身权限或预算；旧 run/错来源/非法进展不唤醒；降级不保留历史高水位，迟到 handoff 不覆盖更新的直接进展；target-reached 不绕过启动目标。完整增量断言与验证边界见 Verification。

### I-AC03 — 仓库与既有服务保持兼容

本次 build、Biome、test typecheck、34 项定向测试及独立 pack/ESM/types consumer 通过。集成 `5af38b4d2f069933b81a039b73b79d4378de7f6d` 后真实执行 `pnpm check`，退出 1，唯一失败为已披露的旧跨进程 capability-feedback/ack 单例；Turbo 为 41/42 successful，pguide 为 109 项中 107 pass、1 fail、1 skip。该项是明确交主 Agent 审查的 baseline 限制，不把集成前或缓存的退出 0 冒充当前全量通过，也不越界修复旧服务。旧 Portfolio Supervisor 38/38、真实 workspace 21 包与 handoff 子例的原独立证据保留。

首轮相对 `aa59c3b8520030722e624a785b1d401cfcd1463b` 的旧服务整包 diff 为空；补修普通快进保留并发 CLI/package-settings 历史，本任务相对已集成 primary 的旧 Supervisor/Planner/Portfolio、进程 runner 与 CLI 接线 diff 仍为空，不把上游 CLI 自有改动算作本任务实现。准确命令结果、归属证明与 baseline 限制见 Verification。
