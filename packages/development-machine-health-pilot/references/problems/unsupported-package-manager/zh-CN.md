---
title: 包管理平台不受支持
description: 初始可靠实现只支持 Debian/Ubuntu 的 dpkg 与 apt-get。
references: []
---

核对发行版 ID、dpkg 和 apt-get 的可用性。其他 Linux 发行版不被静默视为健康，
也不通过模拟包管理器输出绕过。使用受支持目标，或先为该发行版实现真实检查和测试。
本检查不安装或更换系统包管理器。
