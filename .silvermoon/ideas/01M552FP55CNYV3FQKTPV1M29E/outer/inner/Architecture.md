# 职责与 MVP 决策

## 已确认的边界

用户授权主会话指挥子会话并裁决 ideal、implementation、deployment 三个门禁；验收仍须对应已同步的准确 revision 和可验证证据。

planner 维护 objective portfolio，感知用户输入、PilotSpec 变化、周期观测、执行结果及能力需求。它决定需要推进哪些目标及业务优先级，输出优先队列的 Behavior，而不是把完整 portfolio 当成执行队列。

coordinator 只消费队列并感知资源容量、能力、负载和已分配状态。它选择 Agent binding 和每次 quota，不创造业务目标、不重写业务优先级。regulator 使用指定 Agent、Pilot 和 subject，在单次 quota 内反复观测与修复。

## 正常结果、异常和终止

正常结果限定为 target-reached、exhausted、prerequisite-unmet。前置未满足时返回前置 spec、投影 subject 与最低等级，不替根任务修复前置；执行中途前置退化也停止继续修复，不谎称此前没有执行。

4xx 表示可识别的输入或操作拒绝，5xx 表示执行故障，不混入正常完成结果。Agent 明确无法继续但尚未耗尽 quota 时，返回可识别错误，不伪称 exhausted。外部取消是生命周期事件。进程退出不证明业务状态未改变；恢复必须重新观测。

每次 quota 包含有限时长、Agent 调用次数及停滞轮次限制，并可携带此前停滞计数。已有 Agent 单次 timeout 保留。旧 mode、effectTtlMs 拒绝而非静默重解释。

regulator 的 maxStallRuns 是累计停滞阈值；coordinator 为续跑分配新额度时使用“历史停滞计数 + 本次允许的新增停滞数”，避免因携带历史而连续零工作耗尽。CLI 的显式 continue 同样授予一份新额度，历史仍保留用于反馈。

## 队列与资源

exhausted 结束一次 run，不撤销需求；coordinator 在下一次分配时使用最新队列和资源快照。completed 不自动重新执行；planner 按目标特性再次观测，退化后形成新的需求 revision。

planner 发现并归并共享前置，目标身份使用 Objective URI 与规范化 JSON subject。同一身份不可并行修复；同一 spec 内不同最低等级可取较高需求。不同版本不能误判成两个互不冲突的资源。

普通优先级只排序、不抢占正在执行的 run。P0 按需抢占低优先级以释放必要名额，不互相抢占；同级 FIFO，资源阻塞或 P0 排队发出可识别升级通知。先 abort，等待宽限期后 kill，确认执行退出后才释放名额。不能把已拒绝的 Promise 等同于进程已消失。

## 规划能力与宿主

planner 是可替换策略边界；MVP 通过 ACP 接入规划 Agent。规划输出必须是受约束的结构化数据，不能自带可执行命令、Agent binding 或任意未登记目标。规划 Agent 由 supervisor 启动配置提供，不经自己管理的队列分配。

执行 Agent 可通过事件申请能力建设；planner 可以把经过授权的能力建设当成另一项目标。MVP 只传递此类需求并调度已登记目标，不自动安装软件、购买服务或申请凭据。supported agents 的变化由 coordinator 作为资源变化感知。

领域包不依赖 ACP、Git、CLI 或进程实现。pguide 组合这些边界，真实 run 使用独立进程承载，提供 abort/kill，并保持整条 Pilot 源版本固定。CLI 支持一次规划和有界监督执行，取消时清理自己拥有的进程及目录。

## 验证职责

子会话分别负责 regulator、supervisor 领域及 ACP/CLI 集成，主会话负责进程宿主、配置迁移、跨包集成、完整检查与门禁裁决。验收以测试和实际安装产物为证，不以代码存在或子会话完成声明代替验证。
