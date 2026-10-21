---
title: 必需扩展命令不可用
description: config、probe 或 regulate 缺失、不兼容或存在冲突。
references: [pages/bootstrap]
---

核对 pguide help 的 command protocol、PATH 和 commandDirectories。
源码构建需要有效的扩展 shim，单独的 dist/bin.js 不自动提供命令发现目录。
