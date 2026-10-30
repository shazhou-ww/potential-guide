# 交付 Check 与通用任务服务 MVP

## 问题

现有 Check 与专属 Host、任务状态机耦合，已交付的通用引擎也缺少可直接运行的服务进程，尚未形成最小可用闭环。

## 结果

交付 `@potential-guide/check-task` 和 `@potential-guide/task-engine-server`：
既可进程内运行 Check，也可启动通用服务，经 HTTP/SSE 执行准确 Checker 并查询任务。
本项是第一阶段 MVP，完成后依次推进 Probe、Regulate，不按包机械拆分验收。

## 边界

- 生命周期以已完成的 [generic-task-engine](../../../../01M63AFYJEDXZ8PFZQQVZC1W02/outer/inner/ideal/Idea.md) 及[引擎契约](../../../../../../docs/task-engine.md)为准；Server 通用且业务无关，CLI 不放入 HTTP 适配包，不复制调度、状态机或前置条件解锁。
- Check 复用[现行制品契约](../../../../../../docs/artifact-contracts.md)及既有制品包的唯一校验规则，提供与下载、解包、缓存分离的无网络和写盘副作用契约入口；manifest 合法、完整制品可信与 runtime 实际可用分别验证。仅支持现有 Node runtime，准确制品和实际环境参与执行兼容判定，不继承旧 Host 任务协议。
- [旧重构 idea](../../../../01M61G3GCGWGHGA8VHG16WCNZ5/outer/inner/ideal/Idea.md)仅为来源，不整体承接其草案；不实现 Probe、Regulate、全量旧入口迁移、制品查询服务或正式发布，不改写历史证据和验收。

## 验收标准

- 外部消费者通过程序化入口或 CLI 启动服务，可鉴权提交 Check、查询结果与历史、订阅和恢复 SSE；合法业务不通过正常返回，制品和执行故障显式区分。
- Server 可仅注册无制品依赖的测试 TaskType，Check 也可独立注册到进程内引擎；消费者可独立解析校验制品而不下载、写盘或启动执行。无业务包反向依赖，未经授权不能执行任务或读取结果。
- 真实取消、退出和重启证明共享隔离、物理回收及持久恢复成立；未知执行不自动重跑，准确内容不静默替换，清理失败不虚报成功关闭。
