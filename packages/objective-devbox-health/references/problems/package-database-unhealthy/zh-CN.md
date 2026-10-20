---
title: 系统包数据库不一致
description: dpkg audit 或 apt 只读依赖模拟发现已安装包状态不一致。
references: []
---

读取 tool、actual 与 code，确认半安装、待配置或包数据库异常。
dpkg audit 通过仍可能存在未满足的版本依赖，因此继续用禁止磁盘缓存输出和锁的
apt-get 模拟 check 验证。依赖问题的 actual 提供 code=100 及各最多 4096 字符的
stdout/stderr，expected 明确要求已安装包依赖一致。
保留诊断，由管理员评估
修复命令及影响后执行；不要直接删除 dpkg 锁或数据库。修复后重新运行整个 Pilot。
