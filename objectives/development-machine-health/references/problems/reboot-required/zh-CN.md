---
title: 原生系统需要重启
description: native-linux 目标存在 reboot-required 标记。
references: []
---

在保存工作、确认任务与维护窗口后由管理员安排原生机器重启。检查不会重启。
容器和 WSL 的宿主内核不属于本目标控制范围，不应通过容器命令尝试重启宿主。
