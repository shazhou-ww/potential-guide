---
title: 已结束任务仍有存活 pid
description: finished 记录对应的 pid 仍存在。
references: []
---

先排除 pid 复用，确认是否是任务未收尾的子进程或登记错误。
由任务管理者按受控流程修正记录或结束明确进程；不要按名字批量杀进程。
本检查仅使用 signal 0 探测，不会杀死登记任务。
