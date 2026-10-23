# 以 Pilot 进程入口复用 Objective 检查器

## 问题

一次性 check 进程反复加载相同重依赖；此前优化已减少重复观察，但进程初始化仍是主要开销。当前模型缺少 Pilot 级统一 executable 及可复用的请求执行上下文。

## 结果

每个 Objective Pilot 定义独立的进程 executable，由 CLI 启停并复用；同一兼容 Pilot 实例对应同一进程，内部自行管理 check 队列和执行线程。check 是最小并发单元，regulation object 和 subject 属于请求；指令传输方式另行选择。

## 边界

- Pilot 进程按准确来源、版本及兼容策略隔离，不按 regulation object、subject 或 check 启动；执行请求上下文独立，不为每次 probe 再起一个进程。
- 复用进程不等于复用输入、结果或证据；保留层级顺序、依赖来源、每轮视图、截止及取消语义。
- CLI 管进程生命周期与路由，Pilot 管内部排队和线程；HTTP RPC 或其他传输尚未决定。保持顶层调用范围及全量迁移原则，旧运行协议不回退，历史契约与证据不改写。

## 验收标准

- 独立 probe 和 regulation 通过统一入口调度，同一调度上下文内相同 Pilot 不重复启动有效进程；不同对象和 subject 的 check 可按并发额度独立执行，结果与问题归属不变。
- 依赖回调、目标变化、请求混淆、崩溃、取消及回收有明确行为与可验证证据，不以断开 HTTP 连接冒充停止检查。
- 服务启动、就绪、路由与退出可观测；内置 Objective、脚手架及消费面全量迁移，旧输入明确拒绝，新契约不原地覆盖已发布 schema。

## 下一步

进程入口和排队所有权已明确；先讨论 [OpenQuestions.md](./OpenQuestions.md) 的 Q10 指令传输，再收敛 Q03 依赖回传及其他边界，不预先固定 HTTP。
