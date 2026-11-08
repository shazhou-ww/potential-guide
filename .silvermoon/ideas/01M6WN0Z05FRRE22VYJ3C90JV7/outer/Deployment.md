# Deployment

## Steps

### D-S01: 验证 Windows 独立服务使用

按交付文档启动持久化 Task Engine，提供可读取预构建 Probe DAG 的内容来源，再以独立调用方提交 Monorepo 和设备整备 Probe。

### D-S02: 验证配置变更与故障处理

换服务端口复用相同 Probe CAR/CID；在受控运行中验证取消、服务重启和资源释放，不改变共享服务或公共内容。

## Acceptance criteria

### D-AC01: 正常运行流程可复现

保留 Windows 命令、服务配置及父/子 Task 结果作为证据；执行阶段不构建包、不隐式启动第二个 Engine，结果包含真实 Level 与文档引用。

### D-AC02: 同一产物可迁移且可清理

以相同 CID 的换端口运行和受控故障记录证明部署配置不影响 Bundle 身份，取消与重启后不会把未确认子任务报告为已释放。
