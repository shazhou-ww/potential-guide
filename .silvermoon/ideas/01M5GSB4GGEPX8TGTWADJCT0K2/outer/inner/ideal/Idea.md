# 以共享 Check Host 复用 Node 检查器

## 问题

每次 check 启动进程并加载重依赖，仍使完整 probe 超过默认观察预算。需要统一执行宿主，让不同 CLI 和 Objective 的检查请求复用执行资源。

## 结果

检查器统一采用 Node worker 模块，由单用户级共享 Check Host 进程注册、排队和调度。CLI 通过本地 HTTP RPC 调用 Host，Host 通过 Worker Threads 消息通信执行 check；subject 与 regulation object 属于独立请求。

## 边界

- 用户级发现只定位一个 Host；Pilot ID 在 Host 内注册 worker 入口，同一 ID 不允许不同执行版本并存，版本冲突不得静默重绑。
- check 是最小并发单元；进程/线程复用不复用过期输入或证据，保留层级顺序、来源、预算和取消边界。Worker Threads 不作为不可信代码的安全沙箱。
- 全量迁移内置检查器与直接消费面，不保留旧运行协议兼容；历史 schema、源码和固定证据不改写。不在本次默认扩展远程部署。

## 验收标准

- 多个独立 CLI、多个 Pilot 及不同 subject 的请求共用一个 Host，线程复用减少初始化，结果及证据归属正确。
- 竞争启动、版本冲突、依赖等待、取消、崩溃和回收有可验证行为；客户端退出不误杀其他任务，不将 HTTP 断开视为执行停止。
- 固定输入的真实消费比较报告进程/线程启动、重初始化和冷/热耗时；旧输入明确拒绝，不以跳检查或延长预算冒充收益。

## 下一步

沿 [Research.md](./Research.md) 的唯一架构方向，收敛 [OpenQuestions.md](./OpenQuestions.md) 中的发现、worker 契约、依赖与资源边界，再提交构想验收。
