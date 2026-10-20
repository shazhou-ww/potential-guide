---
title: 已结束任务遗留过期临时目录
description: 明确登记的 scratch 子目录超过 finishedAt 加保留周期仍存在。
references: []
---

根据 id、path 和 finishedAt 复核输出是否需归档、是否有未提交工作，再显式删除
已确认可丢弃内容或按真实保留需求调整策略。等于保留周期通过。
检查绝不按未知路径、文件年龄或目录名称自动清理。

parameters.expected.retentionSeconds 提供本次保留阈值，
parameters.actual.ageSeconds 提供检查时间距 finishedAt 的真实秒数，便于核验超期证据。
