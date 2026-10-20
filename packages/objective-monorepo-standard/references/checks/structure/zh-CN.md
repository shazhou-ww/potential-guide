---
title: 第一层结构检查
description: 发现 workspace、绑定包声明、验证共通政策并观察包结构依赖。
references: [problems/structure-incomplete]
---

规则来源为 `pnpm-default-v1`、根政策和包自有声明。关键映射或职责未确认时，
第二层被阻止；合法固定位置、生成内容和有理由的例外不是错放文件。
包结构通过公共 dependency API 观察，期望 structured；不直接重跑包业务检查。
