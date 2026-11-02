# Implementation

本轮已进入实施。前置 Idea `task-engine-contract-refactor` 已完成：
完成事件提交 `275ac6d84eb66b885a69c57e50d8833698ab5c61` 是 `origin/main` 的祖先，
其 `acceptInner` 与 `acceptOuter` 分别对应
`b101e88a5a2d45c874dc037a684a90864a4d1f63`、
`8170c0294e909effcac041427c08d41e07e6b1a8`。
不改变前置 Idea 的生命周期或已接受文档。

范围和验收场景见 [Axis 变更影响](ideal/Axis-deltas.md)，
当前实现和验证边界见 [实施验证记录](Verification.md)。
已贯通 v5 持久受理、直接 SDK Worker、HTTP/client/UI 与 Check/Probe 自包含回调，
并完成 fixtures/examples/scripts 的新协议切换。独立生产安装、真实 Chrome、
相关九 workspace 与完整 `pnpm check` 均通过，V01–V10 证据见验证记录。
主独立验证发现的 Windows SDK consumer EPERM 已改为独立作者进程真实退出后隔离依赖，
并增加可见/缺包 Worker 正负对照与两项回归；四轮定向及修复后完整 `pnpm check` 均退出 0。
完整 Inner 候选重新就绪，等待主独立复验；不将此前失败当作环境暂态忽略。
尚未提交/接受，Git 同步与生命周期交由主协调代理执行。

## Steps

### I-S01: 核对前置交付并落实标准制品与 SDK

核对前置完成事件与提交。新增 `@potential-guide/task-sdk`，将运行库根入口与 `/build`
分离；手写 YAML 是唯一声明来源，构建器收录精确锁定的共享 Schema 闭包，
生成单个自包含 CommonJS 入口，并复用通用 Git tree、YAML、tar 和文件读取机制。
落实标准 Schema、公开路径、层次清单和真实打包消费校验。
Engine 侧内容缓存必须在下载、解包和缓存读取时执行宿主容量与完整性策略，
并接入直接启动 Bundle Worker 的每 Run 生命周期；不以缓存类本身代替完整接线。

### I-S02: 贯通异步受理与匹配增量

落实 preparation 共享、持久恢复、requestId 跟踪、幂等和独立保留边界；
到达时资格与创建时 Task 时间分开，accepted 与 Task 创建原子一致。
保持不可变原 Request 查询与结果查询分离，并提供有界 waitMs 观察，不以观察超时取消处理。

额外合法 Input 字段纳入现有 Equals 编译路径；按源前缀重放匹配，
实际 Worker 提前退出时使 terminates 匹配失效，之后不得借用失效前的旧见证改选 Run。
纯 now 回拨及 recovery stopped 不触发该例外。验证失效源 revision、
后续资格源 revision、updatedAt、历史、集合和重放的一致性。
适配 HTTP/client/UI、Check/Probe 直接消费者及脚本，不改业务描述契约。

### I-S03: 验证边界与切换方案

补足影响文档 V01–V10 的定向测试，运行相关构建、打包验证和 `pnpm check`，
明确旧格式拒绝/数据保留与消费端切换方式，不自动迁移或重跑。

## Acceptance criteria

### I-AC01: 标准制品独立可执行

以 V01–V02 的构建与消费测试证明无作者依赖安装、完整 Digest 校验及离线 Schema 解析，
并记录前置交付核对结果。

### I-AC02: 受理与匹配事实一致

以 V03–V09 的并发、重启、窗口、回拨、清理及补读场景证明不重复创建、不伪造结果、
不越过 eligible/取消约束；前置轮反例按本轮明确增量更新。

### I-AC03: 直接链路与质量检查通过

以 V10 及相关测试证明 HTTP/client/UI/直接适配器行为一致，
通过 `pnpm check` 并保存验证结果；旧数据不被静默改写或替换。
