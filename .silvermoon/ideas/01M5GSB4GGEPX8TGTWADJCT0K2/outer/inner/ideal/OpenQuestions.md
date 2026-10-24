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
| Q13 包边界 | 一包一个 Objective；名称取 package.json.name，拆出 package-standard 与 marker 独立包 |
| Q14 定义 | 唯一包根 objective.yaml，不内联 package.json，不定义包内多 Objective 导出 |
| Q15 版本 | ObjectiveRevision 使用完整包内容 digest；Host 单 check artifact revision 保持独立 |
| Q16 来源 | 复用 npm 标准 dependency spec 与包管理器；准备时固定，运行/恢复不静默升级 |
| Q17 动态性 | 不持续观察 Pilot 更新，保留检查/Subject/资源 Behavior；显式刷新重新取得证据 |
| Q18 构建 | 源码入 Git，生成物在 staging/dist 构建打包；安装/构建显式授权，check 不隐式准备 |

## 仍需定稿

1. 包 digest 的规范编码、格式版本、权限归一化及跨平台固定测试向量；不改变一包一身份原则。
2. 六个内置包的最终命名、构建/prepare/pack 接线及可信来源冲突报错。
3. 旧 Git 绑定与持久化证据的显式迁移界面；不重写历史或把旧 commit 当新 digest。
4. 既有默认冷初始化超时、启动中 shutdown 原生断言的定位与回归证据。

已实现的 Host 字段/额度以当前实现和原证据为基线，不再将它们列为全新待定设计。
本次补洞改变 Ideal revision，旧验收事件保留但不适用于新范围；重新提交审阅后才继续实施。
