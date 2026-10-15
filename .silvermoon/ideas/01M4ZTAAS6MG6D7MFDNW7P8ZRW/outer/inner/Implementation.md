# Implementation

## Steps

### I-S01: 扩展 manifest 类型与解析

将 advancement 中的 check 扩展为带 ID 和 problem ID 列表的节点，并验证
ID、父子归属、重复项及未声明引用，同时保持 schema 版本为 1。

### I-S02: 收紧 Reference 与运行时校验

按 manifest 精确生成三类 Reference 的必需集合并拒绝多余页面；执行 check
时只接受该 check 声明的 problem。

### I-S03: 更新生成面与契约测试

同步脚手架、fixture、README 与测试，覆盖有效三层树及缺失、多余、错配场景。

## Acceptance criteria

### I-AC01: 三层 manifest 可加载

包含 level、check、problem 关系的 manifest 可通过 loader 加载，并由单元测试
证明探测结果与声明归属一致。

### I-AC02: ID 与 Reference 精确对应

自动化测试证明三类 Reference 任一缺失、多余或 ID 不匹配时加载失败。

### I-AC03: 仓库检查通过

`pnpm check` 成功，证明类型检查、lint、构建和测试均通过。
