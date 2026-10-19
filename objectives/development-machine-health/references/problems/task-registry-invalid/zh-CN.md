---
title: 任务登记无效
description: JSON、记录字段、文件身份、时间或 scratch 路径违反合约。
references: []
---

查看 file/id/expected/actual。使用 `.json` 的自有普通文件；state 为 active/finished，
startedAt 为 Unix 毫秒，finished 必须有 finishedAt，pid 提供时为正整数。
不允许重复 id、未来开始/结束时间或未知字段。temporaryDirectory 只能为
scratchDirectory 的直属自有真实目录。修复登记前先确认实际任务，不删除未知文件。
