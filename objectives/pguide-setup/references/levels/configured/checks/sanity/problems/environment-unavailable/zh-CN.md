---
title: sanity 无法访问已声明环境
description: 当前入口中缺少 Agent 所需的环境变量引用。
references: [pages/bootstrap]
---

不要复制秘密。文件认证需显式 userHome 及 transport.env 名称选择；
环境认证仅在原有 shell 直接运行。直接成功不能替代 Git probe 的独立结果。
