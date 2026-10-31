# 当前链路清理分析

## 目标、范围与授权

分析基于当前工作树，而非改造前的 TaskType/authorize 形状。开始时工作树干净，当前工作位于独立的“通用 Engine 新链路清理：移除旧版本支持”subsession，不是 subagent。

用户授权先分析并开独立 Idea，不直接实施。本阶段仅写 Idea 文档与生命周期记录，不改业务代码、不删除实际数据。补充确认：

- 每种 type 只注册一个当前版本，移除 currentVersions 选择表和旧版本执行支持，保留 version/revision 身份。
- “我们还是开发阶段，就数据全都删掉”：旧开发数据可丢弃，后续按明确文件清单清空，不迁移。
- 收藏适配已有另一 session 负责，本次不重复实施。

已确认的 8 个 workspace：

1. [task-protocol](../../../../../../packages/task-protocol)
2. [task-engine](../../../../../../packages/task-engine)
3. [task-engine-storage](../../../../../../packages/task-engine-storage)
4. [task-engine-http](../../../../../../packages/task-engine-http)
5. [task-engine-server](../../../../../../packages/task-engine-server)
6. [check-task](../../../../../../packages/check-task)
7. [probe-task](../../../../../../packages/probe-task)
8. [task-engine-web-ui](../../../../../../apps/task-engine-web-ui)

包括直接相关测试、文档、验证脚本。排除旧 check-host/objective-host、独立 objective-pilot/objective-regulator/regulation-coordinator；共享依赖只在新链路必须联动时修改。不复用或修改已有 authorize 过度设计 Idea。

## 清理目标与当前证据

行号为分析时快照，实施时重新定位。

| 目标 | 当前证据 | 联动与结果 |
| --- | --- | --- |
| 删除历史 updatedAt 回补 | task-protocol/src/types.ts:54-57 声明可选并说明历史 v2；projection.ts:49-64 的 restoreTaskUpdates 从事件回补缺失值 | 当前 updatedAt 必填，缺失记录明确拒绝；删除 helper/export，联动 Engine 构造/commit/start、SQLite readInside 及 catalog.test.ts 的 v2 回补测试。不得改成 receivedAt 或当前时间兜底 |
| 删除投影旧阶段例外 | types.ts:5 的 Stage 已只有 initial/running/completed/run_failed，projection.ts:242 仍容许没有最终 Run 的 preparation_failed/allocation_failed | 当前 task.terminated 须对应合法最终 Run；旧阶段不能绕过验证。保留合法无 Run 取消，不机械要求所有 Task 都有 Run |
| 删除 UI 旧阶段双集合 | UI src/model.ts:23-31 的 validSnapshot 仍接受 preparing/queued/preparation_failed/allocation_failed，lifecycle.ts:3-8 已用当前四阶段 | 回执、观察及模型测试统一当前 Stage；消息 queued 和 RunProgress.stage 不属于旧 Task 状态 |
| 同 type 单版本注册 | engine.ts:182-183 用 type+version 建 key，337 检查跨版本容量，343-350 通过 currentVersions 构建 discovery；484-494 接受私有 version 选择，1450-1453 为 successor 固定旧版本 | 重复 type 注册失败；删除选择表及多版本通道，联动 supervisors 查找、recurrence、server 配置、fixture 和文档。保留绑定身份检查，不将旧记录重绑定当前 schema |
| 收紧旧 direct adapter 可选性 | types.ts:177-181 明示 context 可选仅为 older direct adapters；Check implementation.ts:443-448、Probe implementation.ts:612-617 实际拒绝缺少 context | 可信 context 必填，联动当前 pool/实现/测试调用。类型收紧不代替运行时不可信输入的拒绝 |
| 清理重构残留和身份兜底 | engine.ts:846/866 有 true &&；Check/Probe index.ts:31/36 默认 version 为 2，implementation.ts 的内部绑定兜底为 3，configuration 实际显式传 version | 删除恒真语法但保留物理 barrier；统一当前注册与内部绑定身份，不批量删除数字或合法配置默认值 |
| 收藏交界，另一 session 负责 | UI server.ts:32/223 的 source 可选、340-447 双创建路径；browser.ts:1386-1388、presentation.tsx:497 的 legacy templates；integration/workbench 测试覆盖旧模板 | 不重复改造。实施前核对其合入结果，若影响当前 Stage/fixture/新链路验证，仅做必要联动 |

## 已拒绝旧输入，不是兼容层

- engine.ts:486-487 已明确拒绝 executionMatch；Stage/MatchPolicy 公共枚举已收敛。保留拒绝行为，不能清理后让旧字段被当作可忽略输入。
- SQLite src/index.ts:43-55 检查当前 user_version/checkpoint/facts；projection.ts:25-45 检查当前 facts/messages/matchPolicy。不存在旧数据库迁移器或 v1/v2 双格式读取器。
- storage/test/format.test.ts 的旧数据库/WAL 拒绝测试证明不擅改文件，应保留。第 77 行 initialize v2 标题与实际 v3 断言不符，可直接更新说明。
- engine.ts:371-398 的 historicalType/checkHistory/checkExecutionHistory 验证 revision、环境和当前可用类型；可随单版本化简化查找命名，不删除校验或偷换历史解释。

## 必须保留

1. version 是 TaskType 身份；contractRevision/moduleDigest 固定代码和契约；projectionVersion/SQLite user_version 是当前格式防线；If-Match/discovery revision 防止过期表单误提交。字段或数字本身不是兼容逻辑。
2. historical 复验不是执行旧版本。engine.ts:876-905 在当前数据重启时复验 Result/checkpoint/late evidence，未可靠终结的 Run 变为 interrupted/cleanup unknown，不重跑。type-worker.ts:124-133/165-170 和 Check/Probe verifyIsolated* 仍保障当前证据完整性。
3. Check/Probe 内部 prepare/execute/validatePrepared 和 engine 的 pool 子入口承载真实业务 Worker 调度。不能因形状类似旧生命周期而删除 PreparationOptions/ExecuteOptions/StartPermit/RunTracking 或整个 pool，只清理不再需要的兼容可选性。
4. preparation/allocation/execution 为当前 Run 的 Progress；消息 queued/unknown、late evidence、旧 Worker generation、重复事件跳过服务并发/幂等/故障语义，不删除。
5. 合法 Input 的 context?/language?、timeout/matchPolicy 默认值、空资源 request lifetime、moduleDigest 可信计算、可选 verifyExportName 有当前用途；无旧版本专用证据时不删除。
6. 保留共享身份、持久化接收/匹配顺序、recurrence successor 唯一性、最后需求撤回、逻辑终结与物理回收分离、Probe 子需求所有权和 barrier；恒真条件简化不授权删除等待逻辑。

## 依赖影响与验证标准

- 通用包保持 protocol -> engine/storage/http -> server 组合，不引入业务依赖，由 [task-engine-contracts.test.mjs](../../../../../../scripts/task-engine-contracts.test.mjs) 继续验证。
- context 收紧影响 Check/Probe 与 task-engine/test/driver.ts。RunTracking 等仍有 pool 消费者，不删除公共入口。
- currentVersions 移除影响 EngineOptions、ServerOptions 验证、8 个 workspace 测试配置、UI fixture/main.ts/browser-smoke.ts、Check/Probe/storage 的 restart/crash 子进程夹具。catalog.test.ts:273 的“历史 v1 + 当前 v2 同时注册并重做”应改为当前单版本行为测试。
- 对齐 [task-engine.md](../../../../../../docs/task-engine.md)、[task-engine-web-ui.md](../../../../../../docs/task-engine-web-ui.md)、workspace README 与受影响 package consumer/层约束/打包/worker 脚本，只改直接关联内容。
- 旧 Host 没有 task-protocol/task-engine 生产包依赖。其同名阶段和调度器、独立 observation/checker 契约版本不在此次替换范围。
- 测试须证明重复 type 失败，发现/提交/消息/successor 使用唯一当前身份；错 version/revision/environment 的存量记录不重绑定；缺失 updatedAt、旧阶段和非法终结不回补或成功通过。
- 保留当前数据重启、HTTP revision/idempotency、授权目录、结果/失败/checkpoint 复验、共享取消、消息 unknown 和实际回收回归。
- 先运行受影响 workspace build/typecheck/test 与直接脚本，再运行 pnpm check，沿用 Biome/Turborepo/tsx + Node runner。此阶段无业务改动，不宣称实现验证已通过。
- 后续开发切换按明确的数据库/sidecar/owner 文件清单、收藏负责方确认的数据路径及占用进程清空，再验证真实 HTTP + SQLite + Worker + UI。本阶段不扫描或删除实际数据，不发布 npm。
