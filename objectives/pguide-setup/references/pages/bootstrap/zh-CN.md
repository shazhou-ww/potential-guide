---
title: 外部 Agent 引导与认证边界
description: 未安装时直接运行原生 Node helper；读取完整 README 后再按授权安装配置。
references: [system/overview]
---

运行 `node setup-check.mjs installation --subject-file <绝对路径>` 无需 pguide。
命令在已就绪的 A；subject 的 workingDirectory、configPath、scratchDirectory 和
pguide command/args 全部指向目标 B。target 省略/local 为本地；SSH 使用
`{type:"ssh",host:"user@alias",shell:"posix"}`，所有路径是 B 的 POSIX 绝对路径。
Node helper 自动有界传到 B；缺 Node 则先由 A 的控制 Agent 按授权安装。
已有 SSH 授权和主机信任是前置条件，禁止自动接受 host key、复制 A 的认证或回退 A。
完整 subject、版本来源、配置示例和 Git URI 在本目录 README.md。
当前源码未必发布：按准确 commit 构建或安装明确版本，不把 registry latest 当成源码。
优先使用在 B 上实际可用的 ACP 命令；没有就报告并选择用户已有入口。
不得复制秘密、自动申请付费资源或为测试调用真实模型。
直接 shell 入口继承已有环境；Git probe 不继承模型变量，不存在 receipt 绕过。
userHome 仅补 HOME/USERPROFILE，profile 必须通过 transport.env 选择名字，
Agent 自己访问已登录文件；setup 不读取认证文件。
SSH 禁止 userHome，使用 B 自身环境。真实 sanity 若超过默认 20 秒，须显式同意
直接 helper 的 timeoutMs（例如 180000，最大 300000）；Pilot 默认外层 30 秒不支持
长时限，返回 outer-timeout。本地 Git Pilot 可明确协调 subject 60000ms 与启动配置的
regulationStrategy.probe.timeoutMs 75000ms（retry 为零）；外层至少覆盖 subject 加
6000ms 启动/输出/清理余量，并通过 runtime-owned 元数据校验。仍实际执行 nonce 修复
和最终复查，不能用直接成功缓存或伪造 terminal；SSH cap 不扩大。详见 README。
