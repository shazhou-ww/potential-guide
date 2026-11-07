# Check 与 Objective Task 的两阶段同构

本文服务于 [Idea](Idea.md)。用户明确要求方案对齐，而非只统一命名：
Objective Task 与 Check Task 同样先进行业务准备，再由同一个通用 Task 编译器构建。
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
  Reference 映射包含 `referenceRoot` 前缀且以 YAML 所在目录为基准。
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

| 维度 | Check | Objective |
| --- | --- | --- |
| 业务动作 | Check | Probe |
| 作者 YAML | `<kind>.check.build.yaml` | `<kind>.objective.build.yaml` |
| 业务准备 | `prepareCheck` | `prepareObjective`（候选） |
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
| 资源/二进制 | 精确 resources + final-path binary | 相同，自有选择与自动派生子内容清单分离 |
| 输出接受 | 通用制品验证 + verifyCheckResources | 通用制品验证 + verifyObjectiveResources（候选） |
| 内容身份 | 完整 Task 根 CID | 完整 Task 根 CID，包括 Probe Worker 与 Check 闭包 |
| Engine 调用 | 通用 Task | 通用 Task，不新增 Objective 专用 Engine 分支 |

`prepareObjective`、`verifyObjectiveResources`、`createProbeContract` 与
`createProbeTask` 是对称的候选名称，不意味着这些 API 已存在。
业务准备 API 负责返回固定输入，不把 build/publish 隐藏在一次 prepare 调用中。

## 同名必须同义

- `name` 是展示名，`kind` 是作者定义与业务元数据标记，不是全局身份或版本。
- `source` 是本 Task 的源/入口/contract；子依赖的 `bundles.*.source`
  是来源描述，层级明确，不能借 `source.entry` 加载子 Worker。
- `inputSchema/resultSchema/messageSchema` 属于生成的通用 Task 声明；
  `levels/checks/bundles/references` 属于生成的 Objective 业务资源。
- 静态 `references` 使用逐语言相对路径；输出 `documentation` 使用逐语言完整 URI。
- `problemCodes` 来自子 Check；Override 的 `problems` 是 code 到页面的稀疏映射，
  不定义另一套可以报告的问题类型。
- `include` 仍是完整成品文件清单，不能改成只列父的自有文件。
  子 include/binary 保留原文，以子根解释；父清单覆盖它们的完整带前缀路径。

## 两阶段中的新增组合能力

Objective 第一阶段额外解析 Check publication/CID、取得完整闭包、验证子业务契约，
生成 `bundles` 的内部路径/精确 CID 和 `checks` 的输入映射。
第二阶段不再联网选版本，使用固定内容构建父 Task。

`resources/checks/<binding>` 必须在最终 DAG 中仍是那个原始 Check 根，
而不是仅保留一样的文件名或代码。接受验证要比较真实子树 CID，
并保证父文本规范化或作者 binary glob 不改写子内容。
若当前文件导入模式不能保持某个已支持 Check 的 CID，须明确失败并补齐
通用内容组合能力；不能新建独立 Objective CAR 编译器来绕过共同管线。

子 Check 由 Probe 的业务执行装配作为独立 Task 调用，保持子 CID、
独立输入/结果契约、取消与失败边界。不将子 worker.cjs 动态 require 进父回调；
也不要求 Engine 解释 Level、Problem 或 Override。
该调度能力需要实施证明，当前 SDK 的 bundle.read 不能被描述成已提供嵌套执行。

## 文档与结果同构

两者都在准备阶段校验页面/frontmatter，执行阶段装配完整 URI，
读取失败不改写已经保存的业务事实。
Objective 额外给出自身/当前阶段文档，并对失败 Check/Problem 应用局部 Override。

Probe 有 currentLevel 与 terminal，不能直接别名为 CheckResult；
但不改名 Problem 的 `target/code/actual`，不改写子 Check 原始结果，
也不强加与阶段状态重复的独立 pass 字段。
原始 Check URI 使用子 CID，Objective/Override URI 使用正在执行的父 CID。

## 验证要求

1. 配对作者例子证明相同路径基准、文档目录、资源/binary 规则，
   两者都产出可供同一 buildTask 消费的配置。
2. 生成的定义、业务 JSON 和输入/结果 Schema 同源且一致，
   不需要作者维护第二份 objective.yaml 或 task.yaml。
3. 最终父/子文件集合与 binary 归属准确，实际子根 CID 保持，
   不把 stage 文件可用当成最终 CAR 完整的证明。
4. 标准 Engine 能启动父 Task 执行 Probe；业务装配能独立调用子 Check，
   并传播取消、错误与已验证执行身份。
5. 已讨论的目标阶段、initial/terminal 和 Override 规则保持不变；
   历史不可变制品不被隐式迁移。
