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
验证 Regulation 前置 Check 独立运行、结构化依赖治理与治理后重新判断，
以及外部条件不满足时 Check/Probe 仍执行并报告动态业务需求，而非被前置条件阻塞；
区分当前 Request 入口限制与全局 Task 模型：抽象 Task 都支持前置条件，
仅 Check/Probe 创建请求暂不允许携带，不因此维护两套状态机；
区分 pending 时间等待、preparing 制品准备、blocked 条件阻塞和 queued 资源排队；
通过历史事件查询验证错过 SSE 后仍可追溯执行、选版和子 Task 关联，
不依赖终态快照中的完整 evidence；
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
Regulation 制品就绪但条件未通过为 blocked，治理结束后仍须通过重查才推进，等待不改写 eligible/deadline；
未授权治理不能由条件检查结果自动获得许可。
Task/Execution/Series 历史查询有独立游标，分页及实时通知来自同一事实，
共享执行不复制或泄露其他 owner 的任务数据。
验证 Task 终结事件引用执行结果，completed snapshot 的业务结果由同一事实投影；
结果不重复根 Objective 身份，问题若指向其他 Objective 则仍保留准确业务引用。
服务端有序生成及 SSE 交接确认后的快照保留此前已知过程事实，叶子路径/值不变；
真实失败终态也保留既有准确引用、时间与执行关联，且不残留旧阶段进展。
验证原子失败状态与协议 isFailed/isTerminated 分类一致，准备与其他过程重叠时
仍按判定树投影，不用 Task 状态转移时间替代实际执行或过程时间。
验证无写入跨 eligible 的两份快照仅 timestamp/state 改变而不伪造准备事实；
公共快照无 revision/progress，详细进展由历史事件查，不能用同刻 timestamp 直接去重。
按[事件与快照投影](./inner/ideal/event-projection-model.md)对照公开历史及固定投影时间重建快照，
包含共享 Execution 的必要事实；验证查询/重放不会再次执行或创建递归后继。
