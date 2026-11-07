# 准备旧包废弃清单

## Steps

### I-S01: 复核包身份和迁移边界

检查当前 workspace、退役文档和公开发布状态，核实第一批包没有仓库消费者。刷新手册中已退役的 pguide-pilot/check-task/probe-task 等入口说明；这些事实不自动扩展第一批三包范围，也不将仍被使用的 Check 文件层或新 Task Engine 系列混入。

### I-S02: 审核跨设备执行方案

复核[外部执行手册](../Deprecation-runbook.md)中的逐包文案、config 前置和回执要求；只准备文档，不在实现阶段执行 npm 管理操作。

## Acceptance criteria

### I-AC01: 范围有可追溯依据

清单可对应现有退役文档与 manifest 扫描结果，迁移说明不再推荐已退役入口；明确缺失页面不是权威未发布证明，旧 registry/登录观察不是当前授权或管理回执。

### I-AC02: 方案不含隐式破坏性动作

命令只修改指定包的 deprecation 元数据，不执行 unpublish、publish 或 dist-tag 更新；另一台设备可以按手册逐包核对并暂停。
