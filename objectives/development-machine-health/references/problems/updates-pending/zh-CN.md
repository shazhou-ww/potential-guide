---
title: 系统有待处理更新
description: apt-get 只读模拟显示升级、安装、删除或保留包。
references: []
---

actual 提供 upgraded/installed/removed/held 数量。由管理员审核安全、兼容性及
维护窗口后显式处理；保留包也需确认原因。不在检查期间自动运行实际 upgrade，
不因命令退出成功就忽略仍待处理的更新。
