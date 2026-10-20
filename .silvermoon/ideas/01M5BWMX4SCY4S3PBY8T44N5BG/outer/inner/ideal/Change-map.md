# 修改范围与验证矩阵

本文服务于 [Idea](./Idea.md)，目标协议见 [依赖设计](./Dependency-design.md)。以下均为后续待实施修改，不是本轮已完成清单。

## 1. 当前实现依据

- [Pilot 类型](../../../../../../packages/objective-pilot/src/types.ts)：Problem 必须带 ref，CheckResult 仅含预声明问题 ID，Manifest/PilotSpec 各自有 prerequisite。
- [Pilot 实现](../../../../../../packages/objective-pilot/src/pilot.ts)：加载递归前置链，拼接等级，未满足时返回外部 observation。
- [Regulator](../../../../../../packages/objective-regulator/src/index.ts)：通过外部 current 及已知直接 prerequisite 产生 prerequisite-unmet。
- [Planner](../../../../../../packages/objective-portfolio-supervisor/src/planner.ts)：每个消费者只有一个 child，按共享 goal 是否完成解除等待。
- [来源绑定](../../../../../../packages/pguide/src/pilot-source.ts) 与 [Supervisor 命令](../../../../../../packages/pguide/src/commands/supervisor.ts)：遍历预加载 prerequisite，动态依赖运行时不会因修改类型自动存在。

## 2. 包级修改

| 范围 | 具体修改 | 保留行为 |
| --- | --- | --- |
| objective-pilot 类型/导出 | 增加两种 Problem 与 CheckProblem；移除 Manifest/PilotSpec prerequisite | 内部问题仍使用 ProblemRef、parameters |
| Manifest/资源校验 | 删除 prerequisite；内部 ID 与 Wiki 约束不变，dependency 不登记 ID | 未知字段拒绝、多语言、规范化 URI |
| loadPilotSpec/describeLevels | 只加载和描述当前 Objective，移除链与等级拼接 | 固定版本、资源不可变、level 数组顺序 |
| parseCheckEnvelope/observe | 校验新联合；仅内部问题补 ref；聚合同层依赖；current 固定本目标 | 全层聚合、并发顺序、错误 envelope |
| 摘要/引用页消费 | 内部问题沿用页面；依赖使用统一本地化描述 | 内部 Wiki 与 scoped refs |
| probes/外部观察 | memory、HTTP、process 贯通新格式、外部观察及版本证据，校验目标与层级 | envelope、process stdin 仅 subject、退出清理与取消 |
| objective-regulator | 删除递归规范验证与旧 prerequisite API；增加 dependency-required 联合分支 | target、quota、授权和非依赖 stall |
| 进度比较 | 只比较本目标层级及内部问题；依赖在内部 stall 更新前交接 | 不将等待计作 Agent 无进展 |
| Portfolio 类型/Planner | 多等待项、注入动态解析、独立阈值恢复、版本冲突与实际等待环检测 | 合并、优先级、周期观察 |
| 派生目标生命周期 | 根所有权追踪、配方替换、共享引用与不可达目标回收 | revision 隔离、显式注册目标保留 |
| Coordinator | 新交接原因正常结束，本 revision 不自动重跑，待 Planner 更新 | 退出确认、P0、资源和权限边界 |
| pguide 来源/worker | 删除链式 prepareChecks、collect，支持动态来源及 probe 生命周期 | Git 快照、隔离、缓存清理 |
| pguide regulator | 机器输出改用新原因；人类输出显示外部实例、预期和当前层级；退出码保留 3 | 输出模式、原有错误区分 |
| pguide supervisor | 动态绑定取代静态树 runtime 注册，配置重载清除旧绑定 | 信号、bindings 关闭与迟到运行隔离 |
| 直接相关文档/fixture | 更新包 README、API 示例和测试用新协议样例 | 不批量改写历史 idea/决策记录 |

实现时搜索 prerequisite、prerequisite-unmet、regulationPrerequisite、describeLevels，以及所有无条件访问 problem.ref / parameters / id 的消费代码。业务文字中的 build prerequisites 不属于旧协议，不做无关替换。

## 3. 不兼容更新与手动迁移边界

1. 新运行时不读取旧 prerequisite，不提供别名、兼容结果或静默转换。Manifest schemaVersion 提升为 2，新运行时明确拒绝旧版。
2. 新内部 check result 必须显式 kind: internal；依赖采用统一结构，旧输出明确报错。
3. 更新实现测试所需的 fixture 和新增示例，以验证新版协议；这不等于迁移真实工程的 Objective 定义。
4. 当前工程与 Silvermoon 工程已有 Objective 定义，全部留待之后单独手动迁移。本次设计及后续核心协议实施不自动重写这些定义、其探针或派生生成物。
5. 手动迁移时，将入口依赖改为入口层 check，中间依赖放在真正需要的层级，删除旧 prerequisite；两个工程分别验证。这是后续操作指引，不是本 idea 批量执行任务。
6. 旧定义尚未迁移时，相应自检或真实接入可以明确受阻；记录失败来源，不加入兼容层、不跳过测试后宣称全绿。
7. 新旧运行时和定义需协调切换；实际包发布单独遵循 [发布说明](../../../../../../docs/npm-publishing.md)，本轮不发布。

## 4. 验证矩阵

| 场景 | 必须证明的结果 |
| --- | --- |
| 普通内部问题 | ID 声明/ref 补齐不变，Agent 正常运行 |
| 纯依赖 | 无 ref/ID 合法；摘要不查问题 Wiki；current 属于消费者 |
| 中间层级依赖 | 前层正常通过，到对应 check 才阻塞 |
| 动态 subject/依赖消失 | 外部实例正确；重新观察可不再产生问题 |
| 混合问题/多个依赖 | 聚合全部问题，零 Agent 调用交接全部依赖 |
| 本次 target 已达成 | 不因更高阶段的依赖扩大目标 |
| 外部观察失败 | 没有可信 current 时是调用错误，不伪造低层级 |
| 严格新协议 | 旧 manifest/problem/stop reason、额外字段明确拒绝 |
| 层级合法性 | 未知 level、current 不低于 expected 的依赖声明不被错误接纳 |
| 跨仓库/版本 | 精确提交证据完整；冲突明确失败；解析不改用 HEAD |
| 动态绑定 | 无预加载 prerequisite 也能加载、观察、治理、清理外部目标 |
| 共享不同阈值 | B 达 L1 即恢复要求 L1 的 A，不等待另一目标要求的 L3 |
| 多依赖全部满足 | 一个未满足不恢复；全部满足重新观察，不直接判消费者成功 |
| 外部自行达标/退化 | 观察可唤醒；不沿用过期满足结论 |
| 根删除/配方替换 | 清理旧等待与孤立派生工作，保留共享和显式目标 |
| 迟到结果 | 旧 revision 不创建依赖或唤醒新版消费者 |
| 自依赖/循环 | 观察递归与实际等待环都可诊断，不无限递归/派生 |
| 解析失败/预算耗尽 | 错误显式可见，不静默放行、不忙重试 |
| 权限/执行资源 | 不自动扩权；确认退出后释放槽；P0/取消行为不变 |

## 5. 验证与交付范围

实施时先运行 Pilot、Regulator、Portfolio 和 pguide 对应定向测试，再执行 `pnpm check`。若因尚未手动迁移的真实 Objective 定义失败，单独报告该集成阻塞；核心协议的定向测试仍必须通过，真实工程接入不能宣称完成。

本轮仅设计文档：检查相对引用、Silvermoon worktree/staged 快照和契约/ledger 镜像。所有下游实施与部署项保持未完成，不将设计写作当作实现或迁移证据。
