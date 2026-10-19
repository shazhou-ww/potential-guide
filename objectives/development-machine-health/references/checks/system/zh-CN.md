---
title: 系统基础能力
description: 实测必要目录、容量、包数据库与显式网络。
references: []
---

在六个声明目录内创建、读取并删除唯一自有探针文件；读取 statfs 的 bavail*bsize
和 ffree，低于策略才失败。确认 Debian/Ubuntu、dpkg、apt-get，再运行 dpkg --audit。
只检查 network 中声明的 DNS 与 HTTP(S)，空集合明确不适用；不访问任意公共站点。
网络失败给出端点与诊断，不通过假成功掩盖离线状态。
