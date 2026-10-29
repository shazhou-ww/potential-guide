# 实施接口与边界

本文落实 Implementation 的工程选择，不修改已验收 Ideal。验证结果另见 evidence.md。

## 类型与启动协议

四个包分别交付纯协议、运行协调、Web handler、SQLite Store。Request 业务字段保持同层；
准入绑定记录 type/version/environment/scope，旧版本目录独立于当前默认版本。
Prepared 经类型 validatePrepared 校验，完整规范 JSON 是准确准备身份；可变引用的类型
必须把解析出的不可变版本或内容放入 Prepared，不能只返回浮动 URL。
输入、准备、结果及进展均只接受有限 JSON；冻结后传入纯函数。类型还提供
validateResult/validateProgress，不要求 Schema 库。

execute(prepared, options) 中 options.signal 仅撤销尚未开始的需求集合。
options.context 由 Engine 提供只读 type/version/environment/scope，不能由 Request 字段覆盖；
Pool 将同一可信上下文作为 run 的第三参数传给执行工厂。
options.start() 是同步持久启动握手：引擎再次检查 owner 和时间，在同一提交中记录
execution.started 与各 Task 的绑定，返回新 executionId、可信 startedAt 和 report 端口。
Pool 必须先取得该凭据再调用业务代码。report 的时间由引擎时钟产生，不接受执行器回填。
tracking 在实际启动后返回，最终完成单独报告；迟到 tracking 仍被接管。
通用 Pool 放在 task-engine/pool 独立入口，不导入 Engine 类，TaskType 可封装它或自行实现
同一协议。资源工厂返回 result、cooperate、force、exited、cleanup：
exited 必须代表物理退出，cleanup 成功之前槽位不复用。不可强杀的同线程工作必须
显式拒绝 force，不允许 Promise.race 超时后把计数器当物理回收。

replaceExecutionId 只由 Engine 注入；Pool 先找空闲匹配槽位，再确认候选的资源 key 能
满足要求，最后调用 options.authorizeReplacement(id, generation) 原子复核并封口。
独立墙钟上限、最后 owner 取消和宿主 close 也走同一回收路径；Task 超时本身不停止运行。
执行上限使用 Clock.schedule 的独立相对计时器，不依赖业务 UTC 时钟回拨后的差值；
虚拟时钟分别维护业务时间与等待经过时间。
资源清理失败使槽位隔离，并把错误暴露给宿主，禁止继续复用。

## 持久性与一致性

Store 提供同步短原子 append(expectedWatermark, events)，不把异步业务放入事务。
SQLite 使用 Node 内置 node:sqlite，Node 最低 22.13；无需第三方/native 安装脚本。
主库 WAL/FK ON/synchronous FULL；独立 owner 锁库的 EXCLUSIVE 事务持有 OS SQLite
文件锁，崩溃由 OS 释放，不通过 PID 猜测或租期过期抢占仍活跃进程。
该锁库只用于所有权，不阻塞主库短事务。一个 Store 对象只能授予一个 Engine owner。
主库持久保存锁文件位置，规范化路径及同文件别名不会分别创建两个主动写入域；
禁止宿主在运行中复制、移动或删除数据库/锁文件。
事件、requestId 唯一索引、前后继唯一关联与 checkpoint 在同一主库事务提交。
checkpoint 记录投影版本和确切水位；恢复先读 checkpoint 加后缀，不运行 reducer 副作用。
启动时未知 started 记录 execution_interrupted，不透明重跑；已提交最终事实先补齐 Task。
旧资源的物理退出不由中断事实证明：外部执行器必须在宿主恢复时隔离旧资源；
参考 Worker 执行夹具随父进程退出，故不会复用未知存活容量。

## 时间、规划、保留与观察

时间为规范 UTC 毫秒字符串，所有时间算术检查安全范围。执行匹配“after”使用严格 >；
相等 eligible 的启动不会满足该策略，协调器等到下一个毫秒，不伪造 startedAt。
deadline 相等按时。prepare/queued 到期撤销；既有兼容完成即使晚处理也先被采用。
每轮 successor 关联与后继准入原子提交，容量不足不消费规划权，稍后重试同一轮。
唯一 Pending 在同一提交边界判定，不限制已 eligible Active 数量。

默认上限：10,000 个 Task、100,000 条保留事实、每个 JSON 载荷 64 KiB、
64 个并行准备/排队组、每页 100 条、128 个订阅、每订阅每次最多 100 条；
Pool 显式配置槽位和最多 128 个排队项。执行墙钟 60 秒，协作宽限 100 毫秒，
回收确认上限 5 秒，调度器唤醒 10 毫秒。宿主可调低/调高正整数限额；
这些是防止无界资源的默认值，不是性能 SLA。
保留窗口由宿主显式指定，默认 24 小时；清理只删除已实际结束且整个引用闭包
不再需要恢复/后继规划、幂等窗口已过的记录。不能删的容量耗尽明确背压。
历史固定 watermark；游标绑定 storeId/filter/watermark/position，不是凭据。
新订阅返回快照和边界，之后从持久事件源拉取，不注册无界内存事件缓存。
Series 观察每帧最多返回 pageSize 个最近 Task 快照；事实按页全部续读，不无限聚合快照。
expired cursor 返回 history_expired/410；断开只释放订阅。task.updated 不作 reducer 输入。

## 权限与错误

宿主注入 authorize(caller, operation, scope)，核心每次命令/查询/流拉取重新授权。
caller.scope 是可信参数，HTTP 必须用 resolveCaller 而不是 body 建立身份。
跨 scope 的关联和共享禁止；内部 Prepared 在公开历史中省略。
非法准入 invalid_request/unknown_type，历史原版缺失 unsupported_version，
幂等冲突 idempotency_conflict，终态取消 task_finished，资源不足 capacity_exceeded，
游标错误 invalid_cursor/history_expired，存储失败 storage_failure；不成功形降级。

## 保守边界

父代理评审修复：Pool 的活动 pump 在等待回收时保留后续唤醒请求；本轮结束后补做一次
扫描，不要求已有 idle 槽位。没有新增唤醒、释放或可用资源时不继续自旋。
纯投影对未取消且已绑定的 Execution 立即采用一致水位内可靠的完成/失败时间，
正常完成仍检查本 Task 的 executionMatch；不能借用未绑定的结果。Task 裁决尚未持久化时
不伪造 task.terminated、不发布 Task result，仍保留原 stage，但期限判定不再使用读取时间。
取消已生效则整个 Task 事实边界保持冻结；先有可靠结束再取消仍由核心先补齐裁决并拒绝取消。

当前回收采用整个不活跃引用闭包到期后统一压缩。持续活动 Series 可能先触发准入背压，
不会为腾空间丢失未处理后继或恢复引用。该选择牺牲细粒度回收率，不扩展无限保留承诺。
HTTP 限制在途解析请求、连接数与字节；跨时间的调用配额由宿主网关负责。
执行器代码是可信宿主适配器；无隔离的 Promise 只支持合作式退出，不能声明强杀。
close 等待已发起的 tracking 交接，不能确认时拒绝并保留 Store owner，不静默关闭。
业务失败保留独立 code/message，非法或超限结果转为明确 execution_failed。
