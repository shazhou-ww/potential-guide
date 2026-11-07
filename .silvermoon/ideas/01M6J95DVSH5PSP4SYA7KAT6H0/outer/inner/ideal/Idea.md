# 精简 Task Worker，由 Engine 统一执行业务契约校验

## 问题

Engine 统一业务校验和轻量 Worker 已有实现及历史证明，但 Axis 仍有 SDK 校验返回值、
生成入口职责等旧措辞，当前合约、实际产物与剩余独立消费证明需要重新对齐。

## 结果

以 Engine 统一验证 input/result/message、Worker 仅承担业务执行与有界协议作为唯一
当前边界；对齐规范、公开 SDK 和构建产物，并补齐当前候选的独立消费证明。

## 边界

- 这是用户明确授权的责任调整，不是取消完整校验：Engine 在投递前检查 input/message，
  在任何接纳或持久化前检查 checkpoint、complete 和 RunFailure 的 result 证据。
  拒绝输出不能变成成功、悬挂或假回收。
- Engine 同时负责接收到的业务/日志/进度载荷的 JSON、结构和字节限制。SDK 保留
  发送失败处理、队列预算、generation/Run 身份、声明绑定、ACK/NACK、取消和资源流。
  CID 解析与内容验证属于宿主，Worker 只回显有界 opaque identity。
- 保持显式入口、旧 callback/exportName 兼容和自定义封装可替换性；不引入外置代码、
  新 Schema 方言、远程引用、未来 runCheck/runProbe API 或未经授权的发布。

现行来源为 [SDK 职责说明](../../../../../../packages/task-sdk/README.md)及本世界的
[实施证据](../Engine-Validation-Evidence.md)。[Axis](../../../../../../docs/axis/task-engine-contracts/task-bundle.md)
中的残留措辞须在实施阶段一致修正，不以旧草稿反向恢复 Worker 业务 validator。
历史样本和已接受旧 revision 保留，不自动代表本候选已实现、接受或独立交付。

## 验收标准

- 默认 Worker 的依赖图没有 schema-runtime、自动 validators、Ajv 或 multiformats；
  作者主动导入 validator 的依赖单独归因，完整 Bundle 自包含。
- 真实 Engine 对非法 input/message 在回调/投递前拒绝，对非法输出不接纳不持久化，
  并形成明确失败及物理退出回收；有效结果、日志、取消、资源流继续有效。
- 用真实 init Echo 固定环境复测 Worker 和全部 Bundle 文件字节、依赖贡献及独立目录
  的字节/CID 一致性，并在同环境下小于对应旧重复校验基线。20784/21547 和
  11196/11959 字节仅是历史对照，不外推当前工具版本、binary 清单或构建结果。
