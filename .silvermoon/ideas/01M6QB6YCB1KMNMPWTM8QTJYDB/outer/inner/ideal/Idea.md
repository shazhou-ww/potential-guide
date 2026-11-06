# 诊断 Task 启动与物理回收失败

父 IDEA：[check-delivery-acceptance-followups](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Idea.md)；来源建议：[R-09](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/recommendations/R-09-engine-lifecycle.md)。完整内容已复制至[修改建议](./Recommendation.md)。

## 问题

并发启动超时、Windows 观察窗口耗尽和 Node 24 清理未确认曾出现，但重试通过仍缺少可复验根因。

## 结果

提供有界的生命周期因果诊断和可控复现，按证据区分夹具时限、执行预算与真实回收问题。

## 边界

- 仅改本仓库 Engine、Probe 及测试诊断；不先假定三类故障同根，不通过放宽超时、清除 ownership 或循环重试冒充修复。
- 本次仅创建与整理独立子 IDEA，不代表已批准实施或验收；与父 IDEA 分别维护生命周期。

## 验收标准

- 失败快照展示最后已知阶段、关联身份、预算与缺少的退出或回收证据。
- 受控时序案例可定位责任组件，未复现的原因保持待查。
- CI 重试保留首轮诊断，任何修复均保持未知 cleanup 时的安全约束。

## 下一步

核对本子 IDEA 的范围和验收标准，再提交构想验收。
