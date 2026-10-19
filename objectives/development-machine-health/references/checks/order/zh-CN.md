---
title: 布局与登记任务
description: 只检查显式任务登记，不干扰用户工作。
references: []
---

workspace、scratchDirectory、cacheDirectory、logDirectory、tasksDirectory 必须彼此
分离；可以位于 home 内，不能覆盖 home。只读取 tasksDirectory 直属 `.json` 文件；
其余未知文件不解释、不删除。JSON 文件必须是当前账号拥有的普通文件且不超过 64KiB，
文件名只需以 `.json` 结尾，身份由记录内唯一 id 确定。记录格式：

```json
{"id":"build-1","state":"active","pid":1234,"startedAt":1700000000000,"deadlineAt":1700000060000,"temporaryDirectory":"/home/agent/tmp/build-1"}
```

id 为不含控制换行的非空字符串。state 为 active 或 finished；
startedAt 必填，finished 必须提供 finishedAt；时间为非负 Unix 毫秒。
pid 可省略但提供时为正整数；无 pid 的 active 被视作孤儿。
deadlineAt 可选且不得早于 startedAt；没有 deadline 的长任务不是超时。
finishedAt 不早于 startedAt，active 不得声明 finishedAt；开始/结束时间不可在未来。
temporaryDirectory 只能是 scratchDirectory 的绝对直属子目录；若存在必须是当前用户
拥有的真实目录。检查进程存活仅使用 signal 0，EPERM 表示仍存活；PID 可能复用，
应由任务管理者确认身份，检查本身绝不发终止信号。

finished 保留目录超过 retentionSeconds 才报告残留；保留期边界通过。
记录无效、孤儿、超时或残留时先确认实际任务和未提交数据，再人工修复登记或生命周期。
