# 任务组合边界

## 已确认的问题

[TaskContext](../../../../../../packages/task-sdk/src/index.ts) 目前只提供 Bundle 读取和运行信号、消息、进度、checkpoint、日志，没有其他 Task 的调用接口。
[Probe](../../../../../../packages/probe-sdk/src/index.ts) 通过额外注入的 CheckInvoker 组合 Check；
[HTTP 适配器](../../../../../../packages/probe-sdk/src/execution.ts) 自行处理内容验证、提交、等待与清理。
现有真实 Probe 作者包为演示写死了 loopback 地址与身份，不满足用户先启动 Engine 再提交 Probe 的正常使用方式。

## 方向

- Context 暴露通用、宿主中介的 Task 调用能力，具体接口形状在实施阶段确定，不预先承诺不存在的 API。
- 宿主决定调用身份、scope、内容来源和授权；父任务请求不能自行扩大权限。凭据与服务地址留在部署侧。
- Check 仍是普通独立 Task，使用其真实 CID 和独立输入/结果校验。Probe 只负责 Level 顺序、输入映射和文档 Override。
- 使用父 Bundle 已验证的嵌入 DAG 验证 Check 身份，不因 Context 调用而绕过原有子树根校验。
- 所有调用有独立请求身份、截止时间与清理预算；父取消、退出及宿主恢复时保留可追踪关联，不能用成功形状掩盖清理不确定性。

## 实施前必须解决的风险

- **执行容量死锁**：父 Worker 等待子 Task 时可能占满同一执行池。需要明确调度策略及低容量证明，不能只在默认大容量下测试。
- **递归与配额**：通用能力不能形成无限深调用或无限子任务；明确深度、并发、总量及截止时间约束。
- **故障与重试**：提交响应丢失、父 Worker 被终止及服务重启不能导致重复子任务或孤儿任务。依赖持久化事实和显式恢复，不依赖 Worker 内存。
- **迁移边界**：已有 immutable Bundle 不重写；新 Probe 构建使用 Context，非组合 Task 不被迫配置额外地址或能力。

## 正常使用形态

构建作者包得到自包含 Probe CAR → 内容来源提供完整 DAG → 独立启动 Task Engine → 提交 Probe CID 与业务输入 → Probe 通过 Context 调用 Check Tasks → 返回当前目标 Level、失败 Checks/Problems 及有效文档引用。

Windows 是本轮交付验证环境；公共发布、自动 Pin、跨 Engine 路由和远程多租户不在本 Idea 范围内。
