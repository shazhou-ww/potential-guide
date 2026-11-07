# Check 与 Probe Task Bundle 的两阶段同构

本文服务于 [Idea](Idea.md)。用户明确要求方案对齐，而非只统一命名：
Probe Task 与 Check Task 同样先进行业务准备，再由同一个通用 Task 编译器构建。
此前“不含 Worker 的独立 Objective 数据 Bundle”方向已被本候选替代，不再保留为并行路线。

## 已核实的基线

- [Check 作者工具](../../../../../../packages/check-sdk/src/authoring.ts)：
  `prepareCheck` 验证 YAML/Reference，快照源，生成 definitions、
  `resources/check.json` 与 `task.build.yaml`；不调用编译器或发布。
- [Check SDK](../../../../../../packages/check-sdk/README.md)：
  作者随后调用 `buildTask(prepared.buildFile)`，读取 CAR 并调用
  `verifyCheckResources`，成功后才接受输出。
- [tools 作者配置](../../../../../../packages/check-environment/tools.check.build.yaml)：
  `name/kind/source/languages/problemCodes/referenceRoot/references` 平铺，
  当前仍显式列 Reference 并校验约定路径；这是本 idea 将移除的作者冗余，
  不把目标格式误称为现有实现已支持的配置。
- [tools contract](../../../../../../packages/check-environment/src/tasks/tools/contract.ts)：
  TypeBox input 是 `{checkTimeoutMs,tools}`；共享工厂生成 result/message。
- [通用作者工具](../../../../../../packages/pguide-task-bundle/README.md)及
  [编译器](../../../../../../packages/pguide-task-bundle/src/build.ts)：
  生成 Task 声明、Worker、Schema、精确清单并输出 CAR；
  当前资源接口接收 `resources/` 文件，不能假设已支持任意 UnixFS 子树接枝。
- [Task SDK](../../../../../../packages/task-sdk/README.md)：
  `runTask` 执行回调；`context.bundle.cid` 是已验证的当前根，
  `context.bundle.read` 读取自己的资源，不自动提供嵌套业务调度。
- [Check 结果](../../../../../../packages/check-sdk/src/contracts.ts)：
  使用 `documentation` 与 `target/code/actual`，每个节点可独立读文档。

## 对齐矩阵

下表描述对齐后的目标；Check 作者 `references` 的移除也属于实施范围。

| 维度 | Check Task Bundle | Probe Task Bundle |
| --- | --- | --- |
| 业务动作 | Check | Probe |
| 作者 YAML | `<kind>.check.build.yaml` | `<kind>.probe.build.yaml` |
| 业务准备 | `prepareCheck` | `prepareProbe`（候选） |
| 通用编译 | `buildTask(prepared.buildFile)` | 同一个入口，不新增专用编译器 |
| 生成配置 | `task.build.yaml` | 相同 |
| 作者源 | `source.root/entry/contract` | 相同，entry 启动 Probe |
| TypeBox contract | input + Check 工厂生成 result/message | input + Probe 工厂生成 result/message |
| definitions | problemCodes、languages | 实际 levelIds、languages、按引用归属的子 Problem 元数据 |
| 暂存 | `dist/staging/<kind>/` | 相同，额外包含固定子树 |
| 根声明/入口 | `task.yaml` / `worker.cjs` | 相同 |
| 业务资源 | `resources/check.json` | `resources/objective.json` |
| 输入 Schema | 通用编译器生成 `inputSchema` | 相同，不新增 subjectSchema |
| 文档 | `resources/references/<language>/…` | 相同外层目录，新增 Level/Override 子路径 |
| 必需页推导 | languages + problemCodes + referenceRoot | languages + levels + referenceRoot，另含 terminal |
| 可选页发现 | 无业务 Override | 只发现合法 checks/ref/code 对应的 Override |
| 作者清单 | 不手写 references/include | 相同，不手写嵌入子文件清单 |
| 资源/二进制 | 精确 resources + final-path binary | 相同，自有选择与自动派生子内容清单分离 |
| 输出接受 | 通用制品验证 + verifyCheckResources | 通用制品验证 + verifyProbeResources（候选） |
| 内容身份 | 完整 Task 根 CID | 完整 Task 根 CID，包括 Probe Worker 与 Check 闭包 |
| Engine 调用 | 通用 Task | 通用 Task，不新增 Objective 专用 Engine 分支 |

`prepareProbe`、`verifyProbeResources`、`createProbeContract` 与
`createProbeTask` 是对称的候选名称，不意味着这些 API 已存在。
业务准备 API 负责返回固定输入，不把 build/publish 隐藏在一次 prepare 调用中。

## 同名必须同义

- `name` 是展示名，`kind` 是作者定义与业务元数据标记，不是全局身份或版本。
- Objective 是定义，Probe 是动作，执行制品只称 Probe Task Bundle；
  业务描述 objective.json、概述 objective.md 不改名为动作。
- `source` 是本 Task 的源/入口/contract；子依赖的 `bundles.*.source`
  是来源描述，层级明确，不能借 `source.entry` 加载子 Worker。
- `inputSchema/resultSchema/messageSchema` 属于生成的通用 Task 声明；
  `levels/checks/bundles/references` 属于生成的 Objective 业务资源。
- 成品 `references` 使用生成的逐语言相对路径；作者不再维护同名字段。
  输出 `documentation` 使用逐语言完整 URI。
- `problemCodes` 来自子 Check；Override 的 `problems` 是 code 到页面的稀疏映射，
  不定义另一套可以报告的问题类型。
- `include` 仍是完整成品文件清单，不能改成只列父的自有文件。
  子 include/binary 保留原文，以子根解释；父清单覆盖它们的完整带前缀路径。

## 两阶段中的新增组合能力

Probe 第一阶段额外解析 Check publication/CID、取得完整闭包、验证子业务契约，
生成 `bundles` 的内部路径/精确 CID 和 `checks` 的输入映射。
第二阶段不再联网选版本，使用固定内容构建父 Task。

`resources/checks/<binding>` 必须在最终 DAG 中仍是那个原始 Check 根，
而不是仅保留一样的文件名或代码。接受验证要比较真实子树 CID，
并保证父文本规范化或作者 binary glob 不改写子内容。
若当前文件导入模式不能保持某个已支持 Check 的 CID，须明确失败并补齐
通用内容组合能力；不能新建独立 Probe CAR 编译器来绕过共同管线。

子 Check 由 Probe 的业务执行装配作为独立 Task 调用，保持子 CID、
独立输入/结果契约、取消与失败边界。不将子 worker.cjs 动态 require 进父回调；
也不要求 Engine 解释 Level、Problem 或 Override。
该调度能力需要实施证明，当前 SDK 的 bundle.read 不能被描述成已提供嵌套执行。

## 文档与结果同构

两者都在准备阶段校验页面/frontmatter，执行阶段装配完整 URI，
读取失败不改写已经保存的业务事实。
Probe 额外给出 Objective/当前阶段文档，并对失败 Check/Problem 应用局部 Override。

Probe 有 currentLevel 与 terminal，不能直接别名为 CheckResult；
但不改名 Problem 的 `target/code/actual`，不改写子 Check 原始结果，
也不强加与阶段状态重复的独立 pass 字段。
原始 Check URI 使用子 CID，Objective/Override URI 使用正在执行的 Probe 根 CID。

## 资源推导的共同边界

必需文档由业务 ID、语言和规范目录推导；合法可选 Override 的存在由受限目录发现，
生成精确索引。未知/拼错的页面报错，已发现但无效的页面不能当作不存在。
Check/Probe 的第一阶段都生成全量资源快照，第二阶段与消费者不重新猜测。

附加图片/数据不能由 Levels 或 Problem codes 推导，仍可用显式 resources 选择；
binary 只规定选中文件的字节处理，不自动收集整个目录。没有这些可选字段时，
必需文档、生成元数据与子 Check 闭包仍自动收录。

Check 作者格式迁移需要同步 Schema、仓库所有相关作者例子、验证测试与作者文档，
新格式拒绝冗余 references，保持成品索引/结果和历史不可变 Bundle 的语义。
范围是统一准备规则，不是重做 Check 的执行协议。

## 验证要求

1. 配对作者例子证明无需逐页列表，且有相同路径基准、文档目录、资源/binary 规则，
   两者都产出可供同一 buildTask 消费的配置。
2. 生成的定义、业务 JSON 和输入/结果 Schema 同源且一致，
   不需要作者维护第二份 objective.yaml 或 task.yaml。
3. 最终父/子文件集合与 binary 归属准确，实际子根 CID 保持，
   不把 stage 文件可用当成最终 CAR 完整的证明。
4. 标准 Engine 能启动父 Task 执行 Probe；业务装配能独立调用子 Check，
   并传播取消、错误与已验证执行身份。
5. 已讨论的目标阶段、initial/terminal 和 Override 规则保持不变；
   历史不可变制品不被隐式迁移。

## 实施准备度

结论：目标语义、作者格式、命名和两阶段责任已足够明确，可在本版构想验收后
开始实施，不需要继续等待另一轮总体方案设计。但这不是实现已验证或可以直接发布的结论。

首个实施步骤优先证明两个核心机制：

| 验证点 | 已知边界 | 通过条件 |
| --- | --- | --- |
| 子 Check 身份保持 | 通用编译器当前主要重构文件树，不应假设支持任意 DAG 接枝。 | 经同一 buildTask 得到的父 CAR 完整可达、子 CID 与原根一致、父子 include/binary 一致。 |
| Probe 调用子 Check | SDK 的 bundle.read 不是嵌套 Task 调度 API。 | 标准 Engine 启动 Probe，业务装配按已验证子 CID 独立调用 Check，正确传播取消、截止与调用错误，无 Objective 专用 Engine 分支。 |

这两项是实现中的首要证明，不要求在构想阶段把未写的原型当作完成证据；
若无法在约定边界内实现，必须报告问题并修订方案，不能换成直接 require 子 Worker 的捷径。

其他待细化项可以在实施中收敛：业务资源 Schema/API 签名、资源预算、lock 编码及
publication 解析接口。publication 必须按真实接口验证；精确 CID 可用于最早的端到端证明，
但不能以此宣称 publication 来源支持已完成。
基于有限 JSON/路径选择复用既有输入映射 profile，不额外引入动态表达式能力。

当前环境另有独立验证前提：此前 `pnpm check` 在自动安装依赖时因共享 pnpm store 的
SQLite 损坏而未能进入代码检查。这不推翻文档设计，但实施验收前必须安全恢复可用依赖
并完成标准检查，不能将这次环境失败视为测试已通过，也不授权清理共享存储。
