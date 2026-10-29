# 构建可扩展的任务调度与执行生命周期引擎

## 问题

任务生命周期与 Check、Probe、Regulate 业务语义混杂，扩展任务类型容易复制调度逻辑。
从[来源 idea](../../../../01M61G3GCGWGHGA8VHG16WCNZ5/outer/inner/ideal/Idea.md)派生本 idea，
作为其业务适配与集成的前置依赖；该关联是设计来源，不是 Silvermoon 的新增生命周期事件。

## 结果

交付可嵌入进程的通用引擎库及可选挂载的 HTTP 适配器，使业务类型共享一致的调度、取消、
事件与恢复语义。定义分见[系统边界与模块](./system-boundaries.md)、
[关键概念与生命周期](./concepts.md)、[接口与数据示例](./interfaces.md)。
TaskType 的纯判定、副作用操作及执行/资源/宿主关系见[执行与宿主组装](./execution-and-host-composition.md)。
以引擎、外界信号、时间三个推动力平行建模，内驱 stage 不包含 pending 或 timed_out，
允许迟到完成与期限失约同时成立。

## 边界

- 引擎无内置业务类型或前置条件解锁机制；宿主注入 TaskType、权限与存储，Executor 自行判断业务前提并快速返回。
- TaskType.execute 封装排队启动并返回 tracking；引擎管理共享与可替换执行授权，实际回收确认前不虚报可用资源。
- HTTP 适配不自行监听，恢复不承诺 exactly-once；来源 idea 保留业务适配，本项不含独立服务器产品、分布式集群、制品业务迁移或正式发布。

## 验收标准

- 无网络、无制品依赖的测试任务可完成调度与取消；纯 Validator/Equals 不强制 Schema 依赖，必需 prepare 可恒等返回，新增类型无需改内核。
- 事件重放与三维投影一致，取消冻结、时间等待、超时完成、原节拍递归和持久恢复可用确定性场景验证。
- 进程内与 HTTP 调用遵守同一契约，替换/启动竞态与真实强制回收可验证；错误显式可见，独立消费者可复核结果。
