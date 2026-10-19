---
title: 活动任务没有存活进程
description: active 记录缺少 pid，或其进程已不存在。
references: []
---

对照任务 id、pid、输出和管理者确认任务已结束还是异常退出。
正确收尾并记录 finishedAt，或由任务管理者显式重新启动。不要假造存活 pid；
检查不扫描未登记任务，也不自动重启任务。
