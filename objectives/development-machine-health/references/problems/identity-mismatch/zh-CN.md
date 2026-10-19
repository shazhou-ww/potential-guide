---
title: 开发身份不匹配
description: 当前 uid、用户名或 HOME 不符合受管账号。
references: []
---

检查 parameters.expected 与 actual。必须使用声明的非 root 账号；用户数据库 home、
HOME 环境变量和 subject.home 一致。Docker 应通过 --user 指定账号，不通过改 USER
变量隐藏 root。纠正启动方式与账号配置，不随意递归修改整个工作区所有权。
