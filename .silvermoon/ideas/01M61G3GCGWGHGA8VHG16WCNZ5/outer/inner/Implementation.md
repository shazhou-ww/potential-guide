# Implementation

实现说明与边界见[implementation-contract.md](./implementation-contract.md)，
运行证据见[verification.md](./verification.md)。接受的 Ideal 文件不作修改。

## Steps

### I-S01: 演进制品契约与工具链

实现 YAML、统一结果、目录 References、语言选择、Git SHA-256 树摘要和准确引用；适配作者工具、Check 消费者及历史格式边界。
落实 entry 和 runtime.type/minVersion，v1 仅支持 Node；Objective 的内部引用固定版本
URL 与 digest，不引入同 runtime 限制。
新 Checker 服务使用 v3 HTTP/SDK；历史 v2 与旧摘要继续按原规则读取。
作者 API 产出新格式，不在消费者中自动构建或安装依赖。

### I-S02: 服务化 Objective 观察

提取可挂载 Router 与进程内服务接口，落实 Probe Task、共享 Observation Execution、依赖绑定及分层进展，不改变 Coordinator 的调节职责。
同进程装配使用直接服务接口；listener 是可选装配，Router 接受调用方明确的挂载前缀与授权作用域。

### I-S03: 对齐 SDK 与现有业务入口

提供与 Check SDK 对称的 client.probe 和任务对象，接入现有观察/调节消费链，覆盖身份、时序、取消、恢复和语言反例。
业务兼容桥保留既有 Pilot 数据形状，但使用来源 URL 身份、独立新 source kind、准确
Git 树摘要和实际运行环境；Coordinator 请求 schema 3、CLI Regulation schema 7
明确区分新证据，不覆盖历史 schema。

## Acceptance criteria

### I-AC01: 内容与协议准确

固定向量与 Git SHA-256 oracle 一致；schema、未知问题、目录语言、旧格式与篡改反例证明无静默转换或内容替换。
覆盖未知 runtime、低于最低版本、非法入口、准确来源不匹配和实际运行环境证据，
以可移植向量约束 JSONata 与 JSON 规范化，不把 SDK 实现当成协议定义。

### I-AC02: 任务时序与进展可靠

确定性竞争及真实 Check Host 测试证明两种 freshness、晚解析匹配、独立取消/期限和进展快照不改变最终业务语义。

### I-AC03: 调用面一致

Router 挂载、SDK、Pilot/regulator 消费与恢复测试通过，执行仓库要求的 pnpm check，不以类型检查替代运行证据。
