---
title: 非交互完整管理员权限不可用
description: sudo -n -l 未显示完整 NOPASSWD ALL 授权。
references: []
---

此受管开发机合约需要可信账号具有对所有用户执行所有命令的无密码 sudo。
仅加入 sudo 组、有密码授权或限定命令授权不满足。由管理员通过安全 sudoers 流程
审核并配置 `(ALL : ALL) NOPASSWD: ALL`，或选择不要求此权限的其他目标；
检查本身不提权、不修改 sudoers、不收集密码。
