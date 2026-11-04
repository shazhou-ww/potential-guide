# 以官方 IPFS 能力简化 Bundle 与 Engine

## 问题

当前独立的 ipfs-content 包主要封装官方库与传输策略，增加了发布和维护成本；Bundle 工具还承担了不应替用户决定的上传与 pin 职责。

## 结果

Bundle 只离线构建、检查并输出 CAR 与 CID；Engine 通过官方能力从指定 Gateway 读取内容，将入口及 Bundle 相对路径资源交给 Worker。

## 边界

- 优先直接使用官方包；只有明确、可复用的通用业务逻辑才考虑独立发包，不为薄封装保留 ipfs-content。
- 上传目标、上传工具及 pin 均由用户选择，不属于 Bundle 工具；本改造不执行 npm 发布。
- CID 校验、Bundle 路径边界及 Worker 生命周期仍须明确保障；全量预取改为按需读取的行为变化须明确验证。

## 验收标准

- Bundle 可离线产出可供外部工具导入的 CAR，不再提供上传或 pin 入口。
- Engine 仅经配置的 Gateway 获取并验证内容，能通过官方路径解析将正确资源返回 Worker。
- 独立适配包不再成为发布依赖；确有必要保留的本地逻辑有清晰归属、理由及验证。
