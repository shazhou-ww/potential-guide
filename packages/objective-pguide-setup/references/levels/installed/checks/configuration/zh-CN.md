---
title: 配置与 ACP 检查
description: 验证显式配置、必需命令、Agent 选择、环境引用及 initialize/session/new。
references: [pages/bootstrap]
---

启动 ACP 进程但绝不发送 session/prompt。目标 configPath 必须存在；
有效配置依 pguide 标准合并规则读取。缺少环境引用不能从秘密文件中补取。
