# 精简 Task Worker，由 Engine 统一执行业务契约校验

## 问题

Worker 重复携带宿主已有的业务 Schema、输入投影和 CID 解释实现，增加默认 Echo
交付体积。仅去掉编译器仍保留了重复的校验与投影运行时。

## 结果

作者显式选择 SDK 封装；构建检查契约并绑定声明，Engine 统一验证 input、result、
message，Worker 只承担业务执行与有界协议，不携带 SDK 自动业务 validator。

## 边界

- 这是用户明确授权的责任调整，不是取消完整校验：Engine 在投递前检查 input/message，
  在任何接纳或持久化前检查 checkpoint、complete 和 RunFailure 的 result 证据。
  拒绝输出不能变成成功、悬挂或假回收。
- Engine 同时负责接收到的业务/日志/进度载荷的 JSON、结构和字节限制。SDK 保留
  发送失败处理、队列预算、generation/Run 身份、声明绑定、ACK/NACK、取消和资源流。
  CID 解析与内容验证属于宿主，Worker 只回显有界 opaque identity。
- 保持显式入口、旧 callback/exportName 兼容和自定义封装可替换性；不引入外置代码、
  新 Schema 方言、远程引用、未来 runCheck/runProbe API 或未经授权的发布。

## 验收标准

- 默认 Worker 的依赖图没有 schema-runtime、自动 validators、Ajv 或 multiformats；
  作者主动导入 validator 的依赖单独归因，完整 Bundle 自包含。
- 真实 Engine 对非法 input/message 在回调/投递前拒绝，对非法输出不接纳不持久化，
  并形成明确失败及物理退出回收；有效结果、日志、取消、资源流继续有效。
- 用真实 init Echo 固定环境复测 Worker 和全部 Bundle 文件字节、依赖贡献及独立目录
  的字节/CID 一致性；新的宿主职责版本必须小于本轮 CID 精简后的 20784/21547 字节。
