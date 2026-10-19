---
title: 系统基础能力
description: 实测必要目录、容量、包数据库与显式网络。
references: []
---

在六个声明目录内创建、读取并删除唯一自有探针文件；读取 statfs 的 bavail*bsize
和 ffree，低于策略才失败。确认 Debian/Ubuntu、dpkg、apt-get，再运行 dpkg --audit。
若 audit 干净，再运行 `apt-get -s -o Debug::NoLocking=1 -o Dir::Cache::pkgcache= -o Dir::Cache::srcpkgcache= check`，
补充验证已安装包的实际依赖一致性。模拟不安装或修复，关闭锁及两种磁盘包缓存输出，
不写包缓存或配置。exit 100 且含未满足/损坏依赖诊断时报告 package-database-unhealthy；
缺失命令、超时或其他未知执行失败仍是非 200 调用故障。
只检查 network 中声明的 DNS 与 HTTP(S)，空集合明确不适用；不访问任意公共站点。
网络失败给出端点与诊断，不通过假成功掩盖离线状态。
