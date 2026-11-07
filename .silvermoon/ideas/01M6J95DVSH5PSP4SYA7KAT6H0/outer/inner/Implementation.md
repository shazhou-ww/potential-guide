# Implementation

用户已明确授权 Engine 独占完整业务契约校验。此前预编译/Worker 校验契约及
[Evidence.md](Evidence.md) 中的数据是保留的历史，不作为本边界的验收证明。
本轮实际结果见 [Engine-Validation-Evidence.md](Engine-Validation-Evidence.md)。

2026-11-07 本候选刷新规范与证明边界，不重新声称执行下列工作。历史实现可以复用，
但 Axis/SDK 的职责一致性和当前包复验是新要求，ledger 的 I-* 重新保持未完成；
本次仅更新合约，不修改产品规范、运行时代码或历史接受事件。

## Steps

### I-S01: 明确宿主与显式入口边界

先核对 Axis、SDK、Worker 协议和构建工具的当前职责：移除 SDK 自动业务 Result
校验、旧生成入口等残留规范措辞，以宿主完整校验、显式入口和可替换封装为同一边界。
不把“Schema 同源”误写成 Worker 必须携带 validator。

保留 init 入口的公开 SDK runTask 值导入、contract 类型导入、依赖版本/包字段保留，
以及 callback/exportName 兼容、自定义委托封装、独立 SDK 副本。构建/制品/发布工具
属于 pguide-task-bundle；SDK 只提供 Worker 运行时。

构建期仍检查 Schema 合法性、闭包、引用、预算及受管理输出安全；仅绑定声明，
不生成或绑定三份 standalone validator，不执行业务入口，不替显式入口再启动。
保留其他宿主消费者仍使用的普通/standalone 协议能力；移除的是 Worker 对
schema-runtime 的依赖，不是无关公共 API。

### I-S02: 接入 Engine 统一校验与拒绝 ACK 生命周期

Engine 在 run/message 投递前验证 input/message，在 checkpoint/complete/failed.result
接纳和持久化前验证 result。宿主确认 CID、codec/hash、DAG 及完整声明握手；
Worker 仅检查有界 opaque CID 配置、声明一致性及原有消息身份/队列预算。

Worker 不做业务 Schema 校验，也不遍历或规范化业务/日志/进度载荷；Engine 统一
检查收到的 JSON、结构深度/节点、字节限制及日志/进度形状。无法通过 structured
clone 的值在发送端明确失败，且不消耗消息序号或在途额度；Engine 的限制是接纳
限制，不是 IPC 分配内存前的保护。启动声明的 canonical JSON 比较仍保留。
complete 拒绝必须转成失败报告；checkpoint 拒绝即使被回调捕获也不能成功；
非法 RunFailure 证据的拒绝须以宿主错误重新报告且不携带被拒证据。
Engine 记住拒绝状态，不能被随后的合法 complete 覆盖；即使自定义 Worker 忽略
NACK 后退出，也不能丢失明确失败。成功回收必须在物理退出及既有资源证明之后。
自定义宿主须承担同样的验证与确认职责，不能用全 ACK mock 证明任务合格。

### I-S03: 补齐真实 Engine 回归及体积证据

真实 Engine/TypeSupervisor、持久事实和真实 Worker 联合验证数据与 ACK 生命周期；
覆盖高级 JSON Schema、Never、引用/siblings、原型字段和既有资源/日志/取消。
使用实际 init、正式构建参数及 metafile 复测，不把失败、负控制或代理测试当通过。
复核已有实现而非重做旧预编译方案；保留历史证据来源，记录当前候选的实际结果，
不以历史全绿或文档刷新冒充复验，不自动发布或记录接受事件。

## Acceptance criteria

### I-AC01: 显式入口与轻量依赖成立

真实 init 的 SDK 依赖、类型检查、单次启动、自定义委托、旧 callback 和 SDK 副本有效；
默认及共享引用/组合任务的 Worker 图没有 schema-runtime、task-validator、任何 Ajv
或 multiformats。类型导入不引入 contract 运行时；作者主动 validator 确实执行并单独
归因。构建不执行入口，错误契约/引用/预算失败不破坏旧输出，产物不 external 非内置代码。
Axis、SDK 及 Worker 说明通过逐项对照，不再同时要求 SDK 自动校验业务结果；
此规范对齐未完成前不能仅凭已有实现勾选。

### I-AC02: 宿主校验、拒绝及物理回收有效

同一明确有效/无效数据集经过普通宿主校验及真实 Engine/Worker；非法 input/message
不调用/投递回调，不持久化消息。非法结果、checkpoint（包括被回调捕获的拒绝）、
RunFailure 证据不持久化，最终 Run 失败而非成功或悬挂，exit 和 reclaimed 事实可观察。
自定义 Worker 忽略 NACK 不能绕过宿主。有效证据、opaque CID/声明握手、投影/revision、
错误代码、字节与 Schema 预算、日志、取消和资源流保持有效。定向测试及 pnpm check
须记录实际结果，未通过不勾选、不伪造验收。

### I-AC03: 可复现真实交付体积下降

固定 Node/esbuild/lock 和构建参数，记录真实 init 的原始 Worker 与全部文件字节、
逐依赖贡献、分析/正式构建一致性及独立目录 Worker/CID 一致性。使用同环境可复现的
旧重复校验候选为直接对照，20784/21547、11196/11959 及更早数据仅作历史；
新 Worker 与总量均下降且不转移至旁路文件。声明与引用文件仍完整交付。
