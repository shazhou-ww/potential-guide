---
title: 外部 Agent 引导与认证边界
description: 未安装时直接运行原生 Node helper；读取完整 README 后再按授权安装配置。
references: [system/overview]
---

运行 `node setup-check.mjs installation --subject-file <绝对路径>` 无需 pguide。
提供 workingDirectory、configPath、scratchDirectory 绝对路径和 pguide command/args。
完整 subject、版本来源、配置示例和 Git URI 在本目录 README.md。
当前源码未必发布：按准确 commit 构建或安装明确版本，不把 registry latest 当成源码。
优先使用执行 setup 的 Agent 的实际 ACP 命令；没有就报告并选择用户已有入口。
不得复制秘密、自动申请付费资源或为测试调用真实模型。
直接 shell 入口继承已有环境；Git probe 不继承模型变量，不存在 receipt 绕过。
userHome 仅补 HOME/USERPROFILE，profile 必须通过 transport.env 选择名字，
Agent 自己访问已登录文件；setup 不读取认证文件。
