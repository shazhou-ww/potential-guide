---
title: Agent 环境引用不可用
description: transport.env 中至少一个名称在本次环境没有非空值。
references: [pages/bootstrap]
---

Git probe 刻意裁剪环境。不要把令牌值放进 subject 或配置。
已有文件认证可使用 userHome 与 profile 的 HOME/USERPROFILE 名称引用；
环境认证需在原有 shell 中直接运行 helper，结果不能充当 Git probe 的 receipt。
