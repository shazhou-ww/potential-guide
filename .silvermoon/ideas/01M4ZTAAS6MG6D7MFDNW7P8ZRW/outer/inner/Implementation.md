# Implementation

## Steps

### I-S01: 扩展 manifest 类型与解析

将 advancement 中的 check 扩展为带 ID 和 problem ID 列表的节点，并验证
ID、父子唯一归属、重复项及未声明引用，同时保持 schema 版本为 1。空
problem 列表继续表示只会通过、不报告业务问题的 check。

### I-S02: 收紧 Reference 与运行时校验

按 manifest 精确生成 level、check、problem 三类 Reference 的必需集合并拒绝
缺失、多语言覆盖不全或多余页面；执行 check 时只接受该 check 节点声明的
problem，不能借用同一 manifest 内其他 check 的 problem。

### I-S03: 更新生成面与契约测试

同步脚手架、仓库内 manifest 字面量、fixture、README 与测试，覆盖有效三层树
及缺失、多余、重复、错配场景，并证明原有并发、结果顺序和错误语义不变。

## Acceptance criteria

### I-AC01: 三层 manifest 可加载

包含 level、check、problem 关系的 manifest 可通过 loader 加载，并由单元测试
证明探测结果与声明归属一致；旧的字符串 check 数组会被显式拒绝。

### I-AC02: ID 与 Reference 精确对应

自动化测试证明三类 Reference 任一缺失、多余、多语言覆盖不全或 ID 不匹配时
加载失败，并证明 check 返回其他节点所属 problem 时 probe 显式失败。

### I-AC03: 仓库检查通过

objective-guide 最小构建与测试以及根目录 `pnpm check` 成功，证明类型检查、
lint、构建、测试和打包检查均通过。
