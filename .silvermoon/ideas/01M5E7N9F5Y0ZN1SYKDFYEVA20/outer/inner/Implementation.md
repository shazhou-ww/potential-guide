# Regulation Coordinator 实施

依据已接受的 [Idea.md](./ideal/Idea.md) 与 [Design.md](./ideal/Design.md)，新增独立 `@potential-guide/regulation-coordinator`。本合同仅覆盖仓库实现；不修改 accepted ideal，不迁移或重接既有服务，不执行 Deployment。可复查的实现决策、命令结果及历史失败边界见 [Verification.md](./Verification.md)。

## Steps

### I-S01 — 新增独立包与 FRP 生命周期

新增包的唯一公共构造函数为 `regulationCoordinator(resources, commands, options)`，返回 scoped Effect 与事实 Stream。资源为第一参数 `SubscriptionRef`；每次 acquisition 拥有一个 mailbox、一个 priority queue/依赖图和两个输入订阅。多个输出消费者不创建调度器。空闲及命令正常结束均不结束实例。

采用 bounded Queue/PubSub：订阅期间有序背压、无历史重放；关闭前 drain 已发布事实。输入故障被监督，scope 关闭停止输入、终止执行并释放自有来源句柄。根 spec 由宿主拥有；所有根及精确 resolver 返回值要求合法 Git source。API、Runner 第三参数 execution context、严格命令字段和宿主用法见新包 README。

### I-S02 — 实现单队列与运行时依赖调度

实现 add/replace/cancel/priority/retry；区分 commandId、业务 ID、generation、runId 与 sequence。仅 dependency-required 反馈创建 consumer-owned 等待边。精确解析在事务外 await，前后检查取消/generation；候选图全量检环通过后才原子安装。按完整 Objective/version/source/subject/language 身份共享兼容 provider，聚合最强 level、最高 priority 与能力并集，以 roots 可达性回收整链。

动态资源校验 binding/capacity/capabilities；无效快照暂停分配并撤销运行，合法快照恢复。P0 最少受害者抢占；running 与 stopping 都占槽，只有 result 实际终止或 kill 确认后释放，abort/kill/release 失败明确发事件。provider 达标只唤醒 consumer 重新 Regulation，不生成消费者成功。

可信 options 固定权限及总预算；每次 start（包括抛错）保守预留完整 quota，replace/retry/派生/抢占不补充预算，stall history 单调携带。失败默认零自动重试；显式 retry 亦受剩余总预算约束，可重试仍存活的 blocked 派生 provider。runner 请求通过 execution context 串行关联到 runId，只产生请求事实，不授权、不自动新增能力。

### I-S03 — 固化反例与兼容回归

新增 25 个有界、可重复的状态机/流/资源/依赖/清理反例及 README；接入现有 test typecheck、Turborepo、package-layers、workspace Objective、release/pack inventory 与 ESM/types tarball consumer 检查。只调整这些验证必需的登记与包数量断言，不修改旧服务实现、接线或测试。

运行定向构建/类型/测试、旧 Portfolio Supervisor 38 项回归、仓库标准 21 个包的真实检查、完整 `pnpm check` 与正常 `pack:check`。另独立执行旧 CLI 的 capability-feedback 反例，保留其既有失败及缓存日志异常，不把它说成新包已修复；详见 Verification 的基线说明。

## Acceptance criteria

### I-AC01 — 公共包接口与驻留可用

`src/types.ts`、`src/index.ts`、新包测试及 tarball consumer 类型检查证明资源第一参数、请求/事实分离、单实例、空闲/输入结束后的驻留和 scoped 清理；公开接口没有外部 queue snapshot 或 dependency graph。多订阅、无重放、背压及关闭 drain 均有运行断言。

### I-AC02 — 调度与安全反例通过

25 项测试通过：覆盖动态容量/能力/binding/无效快照恢复、P0/停止占槽、abort/kill 失败和迟到终止、共享 provider 与 root provider 保留、整链回收、聚合约束、provider 仅唤醒、候选环原子拒绝、await 中取消/替换、旧版本/来源/subject/level/问题证据隔离、权限注入/总预算、派生显式重试、输入失败、execution feedback 与来源释放失败。完整测试分组与关键代码证据见 Verification。

### I-AC03 — 仓库与既有服务保持兼容

`pnpm check` 退出 0；旧 Portfolio Supervisor 定向测试 38/38 通过，真实 workspace 检查 21 包及其 Supervisor handoff 子例通过，pack 检查包含新包 ESM/types consumer。相对实施基线 `aa59c3b8520030722e624a785b1d401cfcd1463b`，旧 Supervisor/Planner/Portfolio 及 pguide/pguide-regulate/pguide-supervise 整包 diff 为空。完整检查使用既有 Turbo 缓存，不声称历史 CLI 的独立失败通过或已修复；该失败与缓存输出的准确限制单列供主 Agent 审查。
