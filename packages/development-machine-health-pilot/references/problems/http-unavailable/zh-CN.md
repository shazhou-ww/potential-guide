---
title: 声明的 HTTP 端点不可用
description: 显式 URL 未直接返回成功的 2xx 状态。
references: []
---

检查 url 与诊断中的连接、TLS、超时或 HTTP 状态。重定向不自动跟随；
在 subject 中声明实际健康端点。URL 不得包含凭据，日志和参数不应承载秘密。
检查不要求任意公网可达，不会改变代理或关闭证书校验。
