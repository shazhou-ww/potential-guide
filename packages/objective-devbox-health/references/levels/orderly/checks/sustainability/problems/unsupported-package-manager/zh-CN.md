---
title: 持续性包管理平台不受支持
description: 持续性层无法使用受支持的 apt 索引与升级模拟。
references: [problems/unsupported-package-manager]
---

核对 Debian/Ubuntu 发行版与 dpkg、apt-get。其他包管理平台需要正式实现相应
索引新鲜度和只读更新检查，不通过伪造 apt 输出满足终态。
