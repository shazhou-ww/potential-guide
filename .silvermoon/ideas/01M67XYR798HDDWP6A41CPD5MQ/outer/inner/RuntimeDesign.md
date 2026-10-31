# 完整 Run 的内部设计

本文件细化已接受构想，不改变 `ideal` 树。以下是实施选择，不将草案中的未定接口冒充既有协议。

## 信任边界

注册项是可信宿主提供的静态契约、环境、容量、类型模块位置和可序列化配置。
Engine 不接收可执行 TaskType 对象，不导入类型模块；独立类型守护 Worker 在本地加载模块、
构造 RunContext 并调用 run。守护按类型、版本及环境分组，可同时管理多个 Run。
Checker Bundle 继续处于独立业务 Worker，不能搬到类型守护堆。
资源桥仅承载明确的实际资源动作及 Probe 子需求操作，不代理 TaskType 生命周期闭包，
不传 Engine 状态或任意函数，不默认共享可变内存。

## 事件与恢复

Run start 先持久化，随后投递完整入口；准备、等待业务容量和执行都在该 Run 内。
服务容量等待不是业务 allocation start，Progress 不驱动 Engine 状态机。
Run 终结与物理清理分别记录。Task 截止时间不改变匹配结果上界；
单独取消撤回该 Task，仍被共享需求持有的 Run 不受影响。
接收前已终结的 Run 不回溯匹配。输入兼容只比较原 Input、契约、版本、环境和 scope。

守护失联使其活动 Run 逻辑失败，保留资源清理和副作用未知状态；新需求可按需启动新代际，
但旧 Run 不自动重跑。旧代际消息拒绝。重启不把未知清理伪装成物理回收成功。
新持久化格式明确拒绝旧格式，不能迁移或覆盖用户数据库。

## 输出与输入消息

Progress 严格为 stage、可选有限 0–100 percent 和展示 message；不存在任意 data。
Promise 确认在校验及持久化后返回，不等待订阅消费；每 Run 采用有界在途请求。
结构化准备内容及因果证据进入类型 resultSchema 声明的 checkpoint/最终 Result 证据契约；
checkpoint 走独立 `run.evidence` 事实，不是 Progress，不恢复函数调用栈。
类型守护内完成业务校验，历史复验同样进入原类型隔离边界，不在 Engine 调用动态校验函数。
业务消息带本地 Task signal，取消/接纳期限撤回可通知对应需求，不改写原 Input 或 Run 匹配。

业务消息使用 taskId/messageId 和可信 Caller，服务权限使用独立 message 操作。
消息路由只选 Task 已绑定的当前 Run；terminated-policy 尚未绑定时显式拒绝无路由，
不伪造绑定、不广播、不自动启动。messageSchema 必选，false 拒绝一切载荷。
同消息身份重投返回已有状态，改写载荷是幂等冲突；入队、接纳、拒绝及未知可独立查询。
取出信封不等于接纳；类型必须明确确认。终结前等待已发确认落盘，
未确认的失联消息保持未知，不承诺跨 Crash exactly-once。

## 治理边界

通用消息通过可验证的类型消费者证明；当前未注册通用 Regulator TaskType。
此实现不添加 Regulate 记账系统、不拼接 Agent 授权、不延长 Task deadline，
不通过消息修改原 Input 或共享需求目标。业务消费者若需要目标修订，必须使用新 Task
或未来明确的需求修订协议；不能靠本通用通道静默绕过原 Input 兼容性。

## R01/R02 的证据与资源证明收敛

成功/失败 Result 和 checkpoint 采用同一纯复验函数，固定验证前的 canonical 内容；
拒绝返回不同对象内容或原地改写。无效失败结果不穿过隔离边界，合法失败结果仍保留，
RunFailure 原错误与清理 unknown 不被复验拒绝覆盖。

宿主资源上下文增加可信 workerGeneration。唯一 token 跟踪已启动请求，
lose 不清空尚未结束的动作；Run/代际上下文身份判断拒绝旧 finally/证明改变新状态。
released 先关闭新路由，等待动作结束及宿主确认，不依赖插件自觉 await。
仅明确声明 resourceLifetime=request 的 Host 动作能以请求结束证明其请求级资源释放；
否则必须提供 confirmResourceRelease，跨请求句柄/owner 的实际清理仍由适配器证明。
Probe 宿主桥按 Run/代际保存子需求所有权与 cancel/release 等待。
等待以 healthMs 为界，超时/拒绝/失联只报告未知；未结束动作和证明仍占有界容量，
close 明确拒绝，迟到完成不复活旧回收。
