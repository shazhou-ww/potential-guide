---
title: 第二层交付准备检查
description: 组合包角色，观察依赖方向、入口、运行时、任务图与交付配置。
references: [problems/delivery-incomplete]
---

优先修复 fail，补充 unverified 的独立验证；不支持的类型不回退为成功。
本观察器不执行仓库代码，因此静态证据无法闭合的必需验证会保持未验证。
相对 `.js` 导入支持映射到同名 `.ts` 或 `.tsx` 源文件；映射后仍检查传递依赖的运行时边界，不把缺失文件视为已解析。
