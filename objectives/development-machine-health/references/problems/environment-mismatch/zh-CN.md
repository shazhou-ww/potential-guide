---
title: 环境分类不匹配
description: 实测 container、wsl 或 native-linux 与声明不同。
references: []
---

对照 expected 与 actual，确认目标确实是所选容器或机器。修正 subject.environment
或目标连接，不通过伪造容器标志绕过检查。容器不能宣称管理宿主内核重启。
