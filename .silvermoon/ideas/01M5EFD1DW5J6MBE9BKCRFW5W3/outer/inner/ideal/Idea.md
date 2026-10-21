# 将 level checks 改为达成条件并统一 initial

## 问题

当前 checks 表达离开所属 level 的晋级条件，全部通过后再进入隐式 terminal，导致层级名称不能直接表达已经达成的状态。

## 结果

统一提供无业务要求的 initial；每个业务 level 的 checks 表达达到该层级的条件，按顺序累计判定，取消隐式 terminal。

## 边界

- 优先于 command 简化推进；本 idea 不改变 command 集合或 Regulation 生命周期。
- initial 不表示未知、pending 或回滚；检查异常不能伪装成 initial。
- 旧层级、目标和证据必须显式迁移或拒绝不兼容输入，不静默重解释。

## 验收标准

- 首层未通过时报告 initial；后续层未通过时报告前一已达层级，并保留未达层级的问题归属。
- 全部通过时报告最后一个业务 level；initial 无需执行检查即可满足，不再自动附加 terminal。
- manifest、观察、目标比较、依赖证据及仓库内 Objective 对新语义一致，且旧契约有明确迁移边界。
