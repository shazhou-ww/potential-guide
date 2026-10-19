---
title: 可用 inode 不足
description: 文件系统剩余 inode 低于策略。
references: []
---

即使剩余字节很多，小文件过多仍可能耗尽 inode。比较 path 的 actual 和 expected，
等于阈值允许。先定位文件数量增长，按批准的保留策略处理明确可再生内容或扩容；
不要按文件年龄盲删项目、缓存和日志。
