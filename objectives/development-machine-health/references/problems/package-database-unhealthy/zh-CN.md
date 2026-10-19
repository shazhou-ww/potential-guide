---
title: 系统包数据库不一致
description: dpkg --audit 报告非完整安装状态或执行失败。
references: []
---

读取 actual 与 code，确认半安装、待配置或包数据库异常。保留诊断，由管理员评估
修复命令及影响后执行；不要直接删除 dpkg 锁或数据库。修复后重新运行整个 Pilot。
