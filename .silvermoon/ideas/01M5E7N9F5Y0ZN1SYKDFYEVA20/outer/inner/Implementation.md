# Regulation Coordinator 双意图与可恢复状态实施

本文件依据已接受的 [简化设计](./ideal/Design.md) 渐进细化实施契约。参考目录中的旧类型、查询和事件不构成实施要求。[Verification.md](./Verification.md) 仅记录旧版交付，不证明修订设计已经完成。

构想 `3b28786c179ac731856a6bb12dd9426d3c6d8982` 已获明确验收，本轮先实现请求事实基础层，不将整个运行时重写合入一个未经验证的改动。现有包根入口增加 `RequestModel` 命名空间，旧五命令调度器与既有服务保持原接线。该增量不构成 I-S01 或任何实现验收项全部完成。

### 首批实施边界

- Request 使用调用方提供的稳定 requestRef，不依赖执行 Host；同引用同规范化内容视为重投，同引用异内容显式拒绝。同值新引用保留新请求。跨 Host 身份分配及协调协议不在纯归约器内假定。
- 复用已验证的精确 PilotSpec 作为当前接入格式。Objective 的身份来自 repository/directory，Target 加 subject，Revision 加完整 commit；以带类型前缀的 SHA-256 与不依赖 locale 的 JSON 属性顺序编码。不同 Git 地址不自动合并，不宣称新 source 字符串协议已实现。
- 纯 request reducer 追加不可变实体和请求；依赖派生请求引用已存在的 consumer。解析准确 Request 得到固定 Target、Objective 与 Revision，不读取“最新请求”。
- schemaVersion 1 的完整请求前缀可 JSON 往返、验证重建；本地 revision 仅计新接收请求，不是全局请求顺序、Coordinator 执行版本或存储位置。旧事实、输入对象不被修改，输出深度冻结。
- subject、level 和 Git 来源沿用现有验证；terminal 解析到最高业务层，initial 不执行业务检查。所有非法输入和恢复冲突显式抛错，由未来服务边界转换为反馈，不静默忽略。
- 本批不实现资源 Behavior、Run、五层完整视图、外部恢复及新调度器；后续继续 I-S01 的事件/执行契约，再进入 I-S02，不以基础层测试冒充完整交付。

### 首批验证结果（2026-10-23）

- `pnpm --filter @potential-guide/regulation-coordinator typecheck` 与 `pnpm exec tsc -p tsconfig.test.json --pretty false` 通过。
- `pnpm --filter @potential-guide/regulation-coordinator test`：42/42 通过，包含原有 34 条调度器测试及 8 条新请求模型测试。覆盖稳定身份与版本升级、共享请求重投/冲突、同值新请求、依赖来源、initial/terminal、确定性回放、快照篡改和引用破坏。
- 变更文件 Biome 检查通过；`pnpm pack:check` 通过，隔离 consumer 验证 `RequestModel` 的 ESM 导出、声明类型和空快照往返。未发布 npm。
- `pnpm check` 仍在此前已复现的两条 setup 集成测试失败：`Git subdirectory snapshot coordinates long local budgets and existing file-auth ACP to terminal` 和 `self-check committed snapshots coordinate default and explicit long budgets with one prompt`，均为实际 `installed`、预期 `verified`。不是本批完整通过的证据，未修改该套测试或运行代码掩盖问题。
- 本批证明请求事实层可用及旧入口兼容，不证明完整双 Behavior 运行时、跨 Host 协调、执行恢复或所有观察视图完成；ledger 仍保持未完成，不提交 submitInner。

## Steps

### I-S01 — 收敛实体、观察需求与函数契约

依据统一 ER、Objective/Host 双主视角及下钻需求，确定必要的状态转换、请求身份与 Command/Event；保留资源第一参数的双 Behavior 变换及两个纯 reducer，不提前采用旧 SQL、旧 Host 内请求身份或旧状态包装。

### I-S02 — 实现执行、可重算状态与恢复

按被接受的具体契约组织调度、runner 和持久化副作用，保持实体引用、实际资源与观察来源一致；明确共享 Request 下的本地执行边界、错误反馈和恢复核实，不迁移既有服务。

### I-S03 — 验证行为与兼容性

验证公开契约、归约纯度、视图可重算性及已收敛的执行/恢复反例；运行相关测试与 pnpm check，区分本次问题和基线限制，更新直接相关文档与产物。

## Acceptance criteria

### I-AC01 — 实体与函数契约一致

类型与测试证明实体关系、准确版本和 Request/Run/Host 归属成立；双输入、资源第一参数、纯 reducer 与副作用分离符合接受的设计，不以旧草案填补未讨论协议。

### I-AC02 — 执行、状态与恢复正确

行为测试证明状态可追溯且视图能由同版本事实重建；请求意图不冒充执行、Run 结果不冒充共享 Request 的满足、未核实退出不释放占用，恢复不重做副作用，错误不静默。

### I-AC03 — 交付与兼容可复查

构建、类型、测试、打包消费及 pnpm check 有本次证据；既有 Supervisor/Planner/Portfolio 保持原接线与行为，文档和直接相关生成物一致，历史证据不替代新验证。
