---
title: apt 包索引缺失或陈旧
description: Packages 缺失、刷新证据陈旧或存在未来时间。
references: []
---

检查 actual、expected（seconds）与 source，确认目标包源和离线镜像维护策略。
存在 Packages 时，优先采用 root 拥有的普通 update-success-stamp 的 mtime，
否则采用最老 Packages mtime。仓库 Last-Modified 可能很旧，即使刚成功下载；
只有真实成功更新才能产生刷新成功标记。标记陈旧、未来、非普通文件或非 root 拥有也失败。
在明确授权、可达可信包源时刷新索引，离线镜像应由构建流程提供真实新鲜索引；
不要伪造索引内容或 touch 时间来掩盖陈旧。检查只读取 Packages 文件，不运行 update。
