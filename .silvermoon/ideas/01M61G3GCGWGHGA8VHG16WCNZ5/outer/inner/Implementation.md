# Implementation

实现说明与边界见[implementation-contract.md](./implementation-contract.md)，
旧候选运行证据见[verification.md](./verification.md)。
本次按用户要求修订 Ideal，以下为准备阶段的实施种子，不授权开始代码修改；
旧证据不证明[Request 生命周期修订](./ideal/request-lifecycle-revision.md)已实现。

## Steps

### I-S01: 演进制品契约与工具链

保留 YAML、统一结果、References、语言、runtime 与准确摘要契约；
由服务配置 Task 准备路径的提前选版预优化和显式 fallback，默认无预取/回退；
普通 Probe 不重复传根/静态 Checker bindings，服务记录动态依赖的准确选择，
不把调度属性写入制品或改变历史摘要。

### I-S02: 服务化 Objective 观察

在可挂载服务中落实统一 eligible、PENDING、递归规划与唯一 pending 仲裁，
恢复所有未完成 Task，保持独立需求、共享执行及资源清理边界。
落实幂等 Request/独立 Task 身份、eligible 后 PREPARING、eligible/terminated 递归、
失败超时续作及错过周期不补齐；恢复细节后续讨论，不以实现细节代替设计决定。

### I-S03: 对齐 SDK 与现有业务入口

对齐 Check/Probe HTTP、进程内接口、SDK 及现有 Regulation/Coordinator 的请求语义，
周期任务配置统一使用 `recurrence`，建立全新、不兼容的请求与任务协议；
Regulation 调用方改用与 Probe 相同的 Objective URL/digest 引用，由服务构造内部 PilotSpec；
实体必含 requestId，HTTP 从 header 还原并先于 body 解析识别；生成型身份采用 ULID。
提供 series 动态事件和可恢复身份，不以旧协议兼容要求约束新结构。

## Acceptance criteria

### I-AC01: 内容与协议准确

固定向量与 Git SHA-256 oracle 一致；schema、未知问题、目录语言与篡改反例证明无静默转换或内容替换。
通过准备/fallback 反例证明选中的是仍可用的准确版本，更新错误可观察，
显式 digest 不被替换，业务失败不触发回退。

### I-AC02: 任务时序与进展可靠

确定性时间与竞争测试证明 eligible、递归锚点、唯一 pending、取消/激活竞态及
freshness 归并成立；故障恢复测试证明不重复规划、不刷新期限、不复活终态。

### I-AC03: 调用面一致

Router、SDK、Pilot/regulator 与 Coordinator 的 series 订阅和持久恢复测试通过，
覆盖新轮次动态加入及授权边界；最终执行 pnpm check，不以旧 gate 或类型检查替代运行证据。
