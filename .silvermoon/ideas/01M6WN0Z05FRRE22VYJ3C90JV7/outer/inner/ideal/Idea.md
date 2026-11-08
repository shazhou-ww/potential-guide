# 为 Task Context 提供通用任务组合能力

## 问题

当前 Task Context 不能调用其他 Task，Probe 只能自行配置 HTTP 客户端，导致服务地址和演示身份写入不可变 Bundle。用户不能直接把同一份 Probe 提交给独立启动的 Engine。

## 结果

Task 通过 Context 调用独立子 Task，由宿主提供授权、内容访问和生命周期管理。Probe 包只固定业务定义与 Check CID，可在不同本机 Engine 配置下运行而无需重新构建。

## 边界

- 能力属于通用 Task 协议与 Context，不新增 Probe 专用 Engine 分支。
- 子 Task 保持独立身份、输入/结果校验和权限边界；不加载子 Worker 到父 Worker。
- 本轮不扩展跨 Engine 路由、远程多租户或自动发布；设计约束见[任务组合边界](./task-composition.md)。

## 验收标准

- Worker 无需知道 Engine/Gateway 地址或凭据即可调用已授权的子 Task。
- 父任务取消、超时或退出不会留下未确认的子任务；有限执行容量不会因父任务等待而死锁。
- Windows 上先启动 Engine、再提交预构建 Probe 的正常流程可复现，既有非组合 Task 行为不变。
