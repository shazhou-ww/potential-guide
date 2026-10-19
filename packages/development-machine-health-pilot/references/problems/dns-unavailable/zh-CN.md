---
title: 声明的 DNS 不可解析
description: 显式 network.dns 端点未能通过系统解析器解析。
references: []
---

检查 host、网络命名空间、解析器与离线策略。只修复已声明且必要的端点；
离线开发环境应明确不声明不需要的公共端点，而不是用无关站点代替。
检查不修改 resolv.conf 或 DNS 配置。
