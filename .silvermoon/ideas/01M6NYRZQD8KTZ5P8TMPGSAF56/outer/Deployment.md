# 在授权设备废弃旧 npm 包

## Steps

### D-S01: 确认授权与外部前置

在另一台设备读取已批准的 registry 配置并确认管理身份；按[执行手册](./Deprecation-runbook.md)记录逐版本基线，验证 config 新名称的功能版本。不要通过更换 registry 绕过设备网络策略。

### D-S02: 逐包设置退役提示

仅对已确认拥有权限的第一批包执行 npm deprecate；失败立即暂停对应包，保留已完成操作的回执。config 前置不满足时只执行另外两包并明确待办。

### D-S03: 核验元数据与历史可用性

记录执行后逐版本 deprecated 字段、版本集合、dist-tag 和 integrity，核对无新增发布、删除或标签移动，将外部证据放在本世界中。

## Acceptance criteria

### D-AC01: 已执行版本提示准确

所有已执行包的既有版本均可查询到审核文案；提示不把旧 Guide／Supervisor 说成可自动或一对一迁移。

### D-AC02: config 前置真实满足

新名称的指定功能版本可独立安装且提供预期 binary，再废弃旧名；否则保留 config 阻塞，整个部署不标完成。

### D-AC03: 历史产物未被改变

前后版本集合、dist-tag 与 integrity 对比一致；失败和部分完成明确记录，其他包没有收到 deprecation。
