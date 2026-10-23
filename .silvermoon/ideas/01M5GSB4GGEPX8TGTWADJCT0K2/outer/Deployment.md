# Deployment

## Steps

### D-S01: 固定版本隔离消费

通过独立安装的 CLI、Pilot executable 和最终选定的 probe 请求传输，验证一个 Pilot 进程内排队及不同 regulation object/subject 的 check 线程执行、独立 probe 与连续观察；记录版本、进程/线程及请求身份，不借用工作区模块或要求跨独立 CLI 共享。

### D-S02: 检验复用收益与故障回收

按顶层 CLI 调用范围比较首次与连续观察，证明 regulation 内 probe 复用已有服务，独立 probe 正常启停；验证目标变化、依赖交接、断开、取消、顶层回收及旧协议明确拒绝，不以跨独立 CLI 共享作为验收前提。

## Acceptance criteria

### D-AC01: 真实消费证明复用

固定版本公开入口证明 CLI 复用正确的 Pilot executable 进程，由 Pilot 管理内部排队和线程，处理不同对象/subject 的 check 请求，输入与证据不混淆、层级顺序不变；计数覆盖线程启动及初始化，连续观察减少重载并报告可复现延迟，不以源码测试替代。

### D-AC02: 失败与资源边界成立

外部操作记录证明变化后刷新、内层借用与顶层退出、依赖场景、超时及取消符合已确认契约，旧 executable/HTTP 契约不被静默执行；服务与来源/视图资源无误杀、提前释放、越界使用或失控残留，历史固定证据不被重绑。
