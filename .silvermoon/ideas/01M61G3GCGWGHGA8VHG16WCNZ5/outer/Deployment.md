# Deployment

旧候选的仓库外验证见[deployment-verification.md](./deployment-verification.md)；
该证据不覆盖新增 Request 生命周期，亦不代表验收或正式发布。
以下为本次 Ideal 修订后的部署种子，设计确认与新实施 gate 前不启动部署。

## Steps

### D-S01: 准备独立消费者

在源码仓库外安装准确构建的工具包，以作者交付的两类制品启动统一服务；通过真实鉴权 HTTP 检查就绪，不使用源码导入替代交付。

### D-S02: 验证观察与固定恢复

使用公开 SDK 验证资格时间、递归锚点、系列事件、唯一 pending 及取消，
覆盖提前选版/fallback、准确绑定和未完成 Task 的真实进程重启恢复；
验证 Task 前置 Check 独立运行、结构化依赖治理与治理后重新判断，
区分 pending 时间等待、preparing 制品准备、blocked 条件阻塞和 queued 资源排队；
记录脱敏证据并清理操作拥有的资源。

## Acceptance criteria

### D-AC01: 独立消费无需客户端物化

外部消费者只提供 URL、subject 和请求调度条件，实际获得等级与 References；
记录工具来源、模块定位、准确摘要及选版/回退证据，不依赖作者目录。
snapshot 不内嵌完整 Artifact，外部消费者按准确 artifactRef 查询定义，
来源更新后也不把 latest 当作原任务使用的版本。

### D-AC02: 生命周期与证据可复核

真实系列事件和故障重启实验表明 eligible/freshness/timeout 一致，
重复规划不会多留 pending，取消计划不会复活，恢复不重复生后继或悄悄换版；
语言与进展一致，退出后无操作遗留进程，不宣称正式发布。
制品就绪但条件未通过为 blocked，治理结束后仍须通过重查才推进，等待不改写 eligible/deadline；
未授权治理不能由条件检查结果自动获得许可。
