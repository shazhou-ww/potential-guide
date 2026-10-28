# 统一 Checker 与 Objective 制品并服务化观察

## 问题

现有制品重复声明身份、结果协议与文档索引，Objective 观察仍由各调用方组装，难以统一版本、生命周期与进展。

## 结果

以简洁 YAML、目录文档和准确内容摘要交付 Checker/Objective；通过可挂载的 Objective 服务及对称 SDK 提供独立、可共享执行的 Probe Task。细节见[制品契约](./artifact-contracts.md)、[摘要与引用](./identity-and-digests.md)及[服务设计](./objective-service.md)。

## 边界

- 演进已完成的 Check Host v2，不重做其调度；不恢复静态 prerequisite，不改写历史契约或证据。
- 服务核心与 Router 分离，可同进程挂载；v1 仅交付 Node Checker，Objective 不限制引用使用同一 runtime；不实现其他运行时或 Regulation 服务。
- 新制品不支持额外资源或 raw resource API；不承担正式发布、内置全量迁移或跨重启透明执行恢复。

## 验收标准

- 两类制品按新 schema 校验、组合与固定恢复；Git SHA-256 内容树、统一检查结果和目录文档有可复核反例。
- HTTP/SDK 的双 freshness、独立 Task、共享 Execution、期限及取消一致，等级、检查与依赖进展可观察。
- 同进程 Router 挂载与独立消费者均可验证，旧格式显式迁移或兼容，不把新摘要冒充旧运行证据。
