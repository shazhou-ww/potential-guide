# 标准化 Task Bundle 与按需受理

## 问题

本轮 Axis 已明确内容寻址 Bundle、可恢复的异步受理及新的匹配边界；
这些变化不属于上一轮 Task Engine 契约改造的既定交付，需在其完成后单独实施。

## 结果

使作者以 YAML 和回调构建自包含 Task Bundle，调用方以 URL 与 Digest 提交并按 requestId 跟踪，
Engine 按需准备、恢复和执行。需调整的契约与消费者见[Axis 变更影响](Axis-deltas.md)。

## 边界

1. 以[上一轮 Idea](../../../../01M6DMXBMQF8RTVM6Z00M1GPD1/outer/inner/ideal/Idea.md)完成为实施前置条件；现在只准备，不接管其实施、验收或状态。
2. 以现行 Axis 为规范，保留上一轮的事实、观察与独立 Run Worker 基础；只落实明确增量，不以旧实现反推需求。
3. 不设计 Check/Probe 专用 API，不引入权限、类型目录或历史业务复验，不自动迁移旧数据或发布 npm。

## 验收标准

1. 标准 Bundle 可由 SDK 构建并按 Digest 验证；运行不依赖宿主安装作者的包。
2. preparing、accepted、rejected 与 requestId 查询贯通，准备共享、重启恢复及保留边界可重复验证。
3. 输入判等、eligible 资格和终结回拨巡检在协议、持久事实、查询订阅及直接消费者中保持一致。
