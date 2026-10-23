# 以共享 Check Host 复用 Node 检查器

## 问题

每次 check 启动进程并加载重依赖，仍使完整 probe 超过默认观察预算。需要统一执行宿主，让不同 CLI 和 Objective 的检查请求复用执行资源。

## 结果

检查器统一为 Node worker 模块，由单用户级共享 Check Host 通过有界复用池、条件退役和受控预热执行。CLI 使用本地 HTTP RPC，Host 使用 Worker Threads 消息；subject 与 regulation object 属于独立请求。

## 边界

- 用户级发现只定位一个 Host；Pilot ID 在 Host 内注册 worker 入口，同一 ID 不允许不同执行版本并存，版本冲突不得静默重绑。
- check 是最小并发单元；进程/线程复用不复用过期输入或证据，保留层级顺序、来源、预算和取消边界。Worker Threads 不作为不可信代码的安全沙箱。
- 全部现有 Objective 的 check 从进程入口迁移为 worker 入口，消息上下文显式传递；可复用 worker 必须释放请求资源并限制缓存。旧运行协议不兼容，历史契约不改写，不默认扩展远程部署。

## 验收标准

- 多个独立 CLI、多个 Pilot 及不同 subject 的请求共用一个 Host，线程复用减少初始化，结果及证据归属正确。
- 成功、失败和取消后清理请求资源，持续复用的内存及存活资源有界；竞争启动、版本冲突、依赖和崩溃可诊断，客户端退出不误杀其他任务，断线不冒充停止。
- 固定输入的真实消费比较报告进程/线程启动、重初始化和冷/热耗时；旧输入明确拒绝，不以跳检查或延长预算冒充收益。

## 下一步

重点审阅 [Design.md](./Design.md) 的调整范围、worker 消息和 HTTP 接口，收敛 [OpenQuestions.md](./OpenQuestions.md) 的具体参数与边界，再提交构想验收。
