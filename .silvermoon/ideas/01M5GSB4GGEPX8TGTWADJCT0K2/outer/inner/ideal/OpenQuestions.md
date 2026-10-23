# MVP 决定与待定细节

本 Idea 的唯一设计稿为 [Design.md](./Design.md)，不另维护 session 临时版本。
已明确：内核 `executeCheck :: WorkerDirectory -> Revision -> Subject -> IO (Behavior CheckState)`；
Host 负责共享调度和 Web 封装，公开操作只有开始、取消、观察。
观察既支持单个 check，也支持服务当前活动 check 集合，不是 registration 或任务管理平台。

| 编号 | 当前决定 |
| --- | --- |
| Q01 生命周期 | 同用户共享 Host；开始建立执行，不由某次观察连接拥有执行寿命 |
| Q02 迁移 | 6 个 Objective、16 个 check 全量 worker 化，旧协议明确拒绝，历史契约不改写 |
| Q03 业务依赖 | 内置 check 的 CheckResult 表达依赖要求，上层处理；Host 不编码依赖回调 |
| Q04 取消 | 明确发起取消，协作停止/必要时终止线程，确认清理后才能复用；观察断开不是取消 |
| Q05 信任 | 本机同用户、loopback、鉴权和路径边界；worker 不是安全沙箱，列表不能泄露 Subject |
| Q06 池策略 | 有界复用、一线程一任务、任务数退役/异常隔离、容量允许时同版本替补预热 |
| Q07 身份 | 规范目录为 key，完整产物 hash 为 revision；首次按需加载，同版复用，排空后顺序更新 |
| Q08 重复请求 | 一个 checkId 对应一次执行；丢响应先观察，不能盲目重跑；无跨重启任务恢复 |
| Q09 状态与资源 | 活动任务和有界保留的终态可观察；终态过期释放引用，未知 ID 不重新执行 |
| Q10 HTTP | POST /checks、POST /checks/{checkId}/cancel、GET /checks/{checkId}、GET /checks |
| Q11 内核 | Behavior 有当前值和变化，订阅不重复执行；worker 信号由内核形成状态，HTTP 只投影 |
| Q12 回收 | 请求级清理、有界缓存、线程退役与预热都受限；失败/取消后的长期复用纳入验证 |

## 仍需定稿

1. 目录规范化、完整产物 hash、worker 模块和 CheckState 的具体字段。
2. 线程/队列/负载/观察连接容量、执行截止、终态保留期和退役数值。
3. Host 启动/发现、跨平台文件与外部工具清理、调用能力及集合可见范围。
4. 业务层的依赖要求与已观察事实如何区分、如何消费后重查；不借 Host 控制协议补回调。

文档达到共识后直接更新，未决建议与正式生命周期验收分开。
