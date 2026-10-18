---
title: sanity ACP 尚未就绪
description: 无 prompt 的 ACP 初始化/会话建立没有成功。
references: [pages/bootstrap]
---

检查真实入口与已有认证。在会话建立前不会开始实际 repair prompt。
损坏 JSON 或超时作为 invocation fault 单独报告，不伪装成普通缺失。
