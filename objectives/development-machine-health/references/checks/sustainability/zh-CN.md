---
title: 跨时间持续性
description: 校验历史、增长率、包索引、更新和原生重启提示。
references: []
---

历史至少三点、跨度至少一秒、末样本最多五分钟前，匹配当前 hostname/user/home，
严格递增且不接受未来时间。缓存和日志首尾差值按真实秒数计算，等于阈值通过；
短暂增长不是自动删除数据的依据。容量由本轮更早的 system 层重新实测。

apt 索引要求 `/var/lib/apt/lists` 存在 Packages 普通文件（含常见压缩后缀）；
缺失或未来 mtime 均报告 package-index-stale。Packages 往往保留仓库 Last-Modified，
因此优先使用 root 拥有的普通文件 `/var/lib/apt/periodic/update-success-stamp` 的 mtime
作为本机最近成功刷新证据；它只能由实际成功更新的维护流程记录，不能伪造。
没有此标记时保守使用最老 Packages mtime。证据陈旧、未来或标记无效均失败。
运行只读的
`apt-get -s -o Debug::NoLocking=1 upgrade`，待升级、安装、删除或保留包均报告
updates-pending。这只反映本地索引，不是实时安全状态证明；检查不访问线上包源。
意外模拟错误是非 200 故障；绝不自动升级。
仅 native-linux 检查 `/var/run/reboot-required`；container 与 wsl 明确不适用，
不尝试控制宿主内核。
