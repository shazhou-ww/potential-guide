# 统一制品、服务化观察与可持续恢复的请求

## 问题

原方向统一 Checker/Objective 制品及服务化观察；当前候选仍缺少跨 Check、Probe、
Regulation 的统一资格时间、递归系列与未完成任务恢复，持续需求难以一致调度和追踪。

## 结果

保留简洁 YAML、准确摘要及可挂载服务，在 Request 层统一 eligible、递归、系列身份、
准备与回退策略，使任务可持续观察和恢复。新增设计按对象的 Before / After 见
[请求生命周期修订](./request-lifecycle-revision.md)，完整结构示例见
[数据结构 Before / After](./request-data-examples.md)；制品细节仍见
[制品契约](./artifact-contracts.md)、[摘要与引用](./identity-and-digests.md)及[服务设计](./objective-service.md)。

## 边界

- 调度属性属于 Request 而非 Artifact；保留准确制品/来源语义，不恢复静态 prerequisite，不重解释历史协议或证据。
- 服务核心与 Router 分离；仅 Node Checker，Objective 不限制同 runtime；统一 Regulation 请求语义但不新建 Regulation 服务，不搬移 Coordinator 治理职责。
- 恢复所有未完成 Task，不承诺 Execution exactly-once 或跨重启透明延续；不增加 raw resources，不承担正式发布或内置全量迁移。

## 验收标准

- 两类制品、目录文档与准确摘要保持可验证；准备选版/回退显式固定版本并保留失败证据，不掩盖业务不通过。
- eligible 锚定执行资格、freshness 与 timeout；系列唯一 pending、递归触发及 pending 取消在竞争下成立，不破坏执行共享与所有权。
- HTTP/SDK/Coordinator 的系列事件和未完成 Task 恢复一致，独立消费者证明重启不重置期限、不重复规划、不悄悄换版；旧协议显式兼容。

## 当前准备步骤

确认[修订稿的评审焦点](./request-lifecycle-revision.md#当前评审焦点)，尤其 recursive 的
eligible/completed 双锚点及其 pending/失败边界。本次为未提交验收的新 Ideal 修订；
原候选通过的测试不构成本修订的实现或部署证据。
