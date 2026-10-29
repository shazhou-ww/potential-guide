# 统一制品、服务化观察与可持续恢复的请求

## 问题

原方向统一 Checker/Objective 制品及服务化观察；当前候选仍缺少跨 Check、Probe、
Regulation 的统一资格时间、递归系列与未完成任务恢复，持续需求难以一致调度和追踪。

## 结果

保留简洁 YAML、准确摘要及可挂载服务，以幂等 Request 建立独立 Task，
统一 eligible、Task prerequisites 与递归系列，由服务配置准备/回退策略，使任务可持续观察和恢复。新增设计按对象的 Before / After 见
[请求生命周期修订](./request-lifecycle-revision.md)，完整结构示例见
[数据结构 Before / After](./request-data-examples.md)；制品细节仍见
[制品契约](./artifact-contracts.md)、[摘要与引用](./identity-and-digests.md)及[服务设计](./objective-service.md)。

## 边界

- Request 实体必含幂等 requestId，HTTP 通过 header 传递；Task 身份独立、series 默认取首个 Task ID，生成型身份用 ULID，作者语义名称和 digest/revision 不机械改名。
- 全新不兼容设计，Before 仅作对照；prerequisites 属于 Task 而非 Objective，条件 Check 可返回结构化治理需求；仅 Node Checker，不新建 Regulation 服务或搬移 Coordinator 治理职责。
- 恢复所有未完成 Task，不承诺 Execution exactly-once 或跨重启透明延续；不增加 raw resources，不承担正式发布或内置全量迁移。

## 验收标准

- 两类制品、目录文档与准确摘要保持可验证；准备选版/回退显式固定版本并保留失败证据，不掩盖业务不通过。
- 时间、制品、前置 Check、执行资源按优先级合取，分别投影 pending/preparing/blocked/queued/running；等待不重置 timeout，治理后重查，系列唯一 pending 且失败/超时续作。
- HTTP/SDK/事件采用按 state 区分的轻量快照，无 hostInstance、完整 Artifact 或 evidence；制品按 digest 查，证据按稳定游标查历史事件；审计/恢复身份一致且不悄悄换版。

## 当前准备步骤

确认[修订稿的评审焦点](./request-lifecycle-revision.md#当前评审焦点)，继续收敛递归默认值、
未来后继的时间选法、条件重查及积压/取消策略；崩溃恢复细节暂缓。本次为未提交验收的新 Ideal 修订；
原候选通过的测试不构成本修订的实现或部署证据。
