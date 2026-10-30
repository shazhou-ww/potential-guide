# Implementation

实施范围严格遵循已接受的[构想](ideal/Idea.md)与[调研](ideal/Research.md)；
本文件与[实施证据](Evidence.md)记录主体世界实现，不代表 inner gate 审批。
接口及资源契约见[公开指南](../../../../../docs/task-engine.md#task-directory)。

## Steps

### I-S01: 收敛查询与兼容契约

已整合 primary `a816432af4b19a159400d88b215565771ef0e43e` 的 Input Schema/discovery
生产实现：TaskType 声明 inputSchema，Engine 编译不可变校验/结构等价契约，
Task/Execution binding 包含 contractRevision；Facts 仍为 v2。复用现有终结、取消、
超时投影，保留 `discoverTypes`/`GET /task-types` 的 submit 权限与提交 revision precondition。
目录采用独立 `list` 操作，不继承其他 idea 的 gate 授权；
`TaskQuery` 的类型、创建与最近更新时间范围取 AND，明确时区、左闭右开，
默认创建降序、可选更新降序、同刻 taskId 升序。摘要只含身份、类型、绑定版本、
双时间和独立通用状态；原请求与详情仍独立鉴权，原请求不注入版本。

更新时间按最后接受的归属事实顺序取事件时间，允许时钟回拨，不取历史最大值。
创建初始化、Task 可见事实改变及关联活跃 Execution 的进度/终结更新；
取消或终结 Task 不跟随共享 Execution 的后续进度。读取、时间流逝和纯加载不更新；
重启产生的真实 interruption 失败仍是事实变化。

### I-S02: 接入只读目录能力

实现 `TaskService.listTasks`、Engine 目录与 HTTP `GET /tasks`，Server 直接复用既有
组装，无新执行器、索引、数据库格式或自动清理。固定首次查询成员、顺序及摘要；
续页对完整成员重新鉴权，任一成员删除明确失效。游标以进程私钥认证并绑定
scope、subject、规范化查询及视图位置；与事件游标隔离，重启/过期须重查。

页条数与完整响应 UTF-8 bytes、初始扫描总记录数、缓存视图总数量/计费内存及双时钟
有效期均受 EngineLimits 控制，容量不足显式失败且不截断、不静默驱逐有效视图。
默认值与计费方式见公开指南。5000 条记录探针验证有界线性扫描可用，未增加派生索引。

`TaskRecord.updatedAt` 与原事件事务一并持久化。当前支持的合法 v2 无此字段时从受保护事件
精确重放恢复，不改写旧输入或猜时间；缺历史明确失败。旧记录仍须保有原版本及
contractRevision：上游对缺失身份或同版本 Schema 变化的 `unsupported_contract`
拒绝不被时间回填绕过，也不从事件/当前注册类型猜补 binding。既有 compact 在任何记录仍保留
时拒绝压缩，因此合法旧数据不会丢失所需进度；全图 forgotten/compact 后按 floor
之后的新历史恢复。保持原版本校验与格式拒绝，不承担旧格式迁移。

### I-S03: 验证边界并更新文档

补充 Engine、HTTP、SQLite 和实际 Server 入口测试，覆盖过滤交集/边界/时区、
同刻/回拨、共享进度/取消、固定摘要、并发新增、清理、权限变化、跨 caller/scope、
篡改/混用/过期/重启游标、扫描/内存/数量/响应上限与合法旧 v2 恢复。
更新直接相关公开指南与包 README；先运行 targeted tests，再运行完整 `pnpm check`。
所有运行证据与局限保存在同世界 Evidence.md；不修改 ideal、事件或部署种子。

## Acceptance criteria

### I-AC01: 查询与详情对应

Engine 目录测试证明跨客户端发现、类型与双时间交集、同刻/回拨和归属进度正确；
摘要只含白名单字段，原请求不锁版本，查询不追加事实。同轮固定，重查纳入更新。
证据：`packages/task-engine/test/catalog.test.ts` 与 HTTP/存储目录测试。

### I-AC02: 权限与资源边界有效

跨 scope/subject、独立 request 权限、翻页撤权、已交付成员删除、实际 collect、
非法/篡改/混用/过期/重启游标均有明确失败测试。完整 wire bytes、扫描、总计费内存、
缓存数量和过期回收有可复核测试；5000 条目录初页与续页验证有界遍历，
不以 limit 掩盖无限扫描。证据及预算计算见 Evidence.md 与公开指南。

### I-AC03: 原有协议与恢复保持正确

Memory/SQLite 验证重启、compact、受支持 v2 精确进度恢复、原版本/contractRevision
匹配及不强制转换校验；验证目录旧绑定版本不随当前 discovery 改变，原参数重做新提交
使用当前契约而不自动附加旧版 precondition。
已有 Task/Request/事件、幂等、终结与 Server 回归保持正确，查询无执行/清理副作用。
以 targeted tests 与完整 `pnpm check` 的成功结果为完成证据；具体结果见 Evidence.md。
