# 周期后继的实施边界与证据

本文支撑 [Implementation](./Implementation.md)，不修改已接受的 Ideal World。

## 持久化与版本兼容

- [RequestModel](../../../../../packages/regulation-coordinator/src/requests.ts)扩展不可变时间、重复规则、后继来源和显式替代引用。intervalMs 使用现有正整数时限边界，最大 2,147,483,647；initial 与依赖派生请求不支持 recurrence。
- 既有 version-1 记录可以没有 eligibleAt，保留其立即可执行和旧外部请求局部替代行为；新调用者通过固定 eligibleAt 选择新语义。旧请求不能隐式覆盖带时间的新请求，不给旧事实补造时间、原因或消耗。
- [状态归约](../../../../../packages/regulation-coordinator/src/state.ts)将 run-start 同时作为初始派发事实；首个周期 Run 的同一事实必须携带完整后继，后继时间由事件的实际派发时刻计算。纯 replay 验证前驱、时间、目标、版本及唯一后继，不读取时钟。
- 后继引用从 Host 与前驱引用确定，持久化发生在 runner.start 之前；未知恢复仍占用 Target 和资源。成功恢复、取消或重投不生成新的后继。

## 调度、停止及追加投入

- [运行时](../../../../../packages/regulation-coordinator/src/coordinator.ts)在 eligibleAt 到期时唤醒，容量不足时保留待调度意图，不循环空转或积累历史补跑。每次后继重新加入 admission 队尾，保留同优先级公平性。
- 已启动或尚在等待依赖推进的请求阻止同 Target 的其他请求同时推进。依赖解除后的额外 Run 通过 continuedFromRunId 关联，不重新初始派发；每个 occurrence 的有限尝试边界仍由 maxAttemptsPerRequest 控制。
- replacesRequestRef 显式撤销旧请求的整个周期链，在接纳新请求时生效。cancel(ref) 默认停止该链，cancel(ref, "request") 只撤销该 occurrence；两者均请求终止被撤销的活动执行，但实际占用要等确认退出。
- 周期后继在初始派发时已经确定。exhausted 不提前后继、不重试本请求；监听者可以用耗尽事件身份构造幂等的一次性新请求，原周期链仍在。
- 单次限额来自可信 Host options，调用者不能通过请求注入 quota。没有新增共享 Budget、动态预算调账、Planner、MCP 传输或跨 Host 唯一调度。

## 事件与视图

- 沿用持久化 run-end exhausted 事实，不增加一套重复结果存储。带 eligibleAt 的请求要求 reason 为 timeout、agent-runs 或 stall-runs；可选 usage 只记录已知的实际测量，旧原因保留 null。
- Host 执行超时在实际确认终止后报告 timeout 耗尽；异常、观察失败和资源拒绝保持不同语义。停滞原因保留在事实中，额外投入仍由外部决定。
- eventsSince 校验 Host 内游标；exhaustionEvents 提供稳定 hostId:revision、准确版本、执行限额、观察及最新 Probe 失败信息、原后继及时间。至少一次读取由消费方去重，不承诺 exactly-once。
- [coordinatorViews](../../../../../packages/regulation-coordinator/src/views.ts)新增本地派发、后继、取消及耗尽投影。到期判断必须传入显式 now；缺省保持 undetermined，不在投影中偷读时钟。
- 现有 legacy 五命令调度器和 Portfolio 的纯 helper / runner 类型依赖不变；没有把旧 Supervisor / Planner 自动重接到新 Coordinator。

## 验证范围

- [请求测试](../../../../../packages/regulation-coordinator/test/requests.test.ts)：时间与重复规则校验、后继来源、幂等、冲突、版本固定及 JSON restore。
- [运行时测试](../../../../../packages/regulation-coordinator/test/behavior.test.ts)：受控时钟、派发前持久化、周期与一次性追加共存、耗尽重读、同 Target 串行、长 Run、依赖续接、重启及唯一后继、取消与显式替代、无资源等待、同优先级队尾和宿主超时。
- [公共出口消费者](../../../../../packages/regulation-coordinator/test/public-api.test.ts)：通过包名而非源码路径读取构建出口，校验调度类型、服务方法和结构化结果的声明与运行时能力。

## 已完成验证

| 验证 | 结果与对应标准 |
| --- | --- |
| pnpm --filter @potential-guide/regulation-coordinator typecheck | 退出 0；公共声明可构建，覆盖 I-AC03 |
| pnpm --filter @potential-guide/regulation-coordinator test | 77 项通过；覆盖 I-AC01、I-AC02，并保留 legacy 回归 |
| pnpm exec tsc -p tsconfig.test.json --pretty false | 退出 0；根测试类型检查通过，覆盖 I-AC03 |
| pnpm exec biome check packages/regulation-coordinator | 16 个文件通过，无自动修正 |
| pnpm check | 最终代码退出 0；层级、格式、lint、typecheck、test 与 pack 检查均通过，Coordinator 77 项全通过 |
| 文档链接检查 | 19 个 Idea 内本地链接存在；下游 Deployment 初版保持不变 |

时钟测试覆盖实际派发后生成后继、到期但资源不足、长 Run 超过间隔、离线后只启动一个逾期后继、额外投入共存及停止后重投。崩溃窗口通过恢复仅含原子 run-start 的快照验证，未知执行保留占用；不将这种单元级恢复证据冒充真实外部进程崩溃演练。

独立安装及跨进程现实验证留在 Deployment 阶段，当前只申请实现验收，不声称已部署或发布 npm。
