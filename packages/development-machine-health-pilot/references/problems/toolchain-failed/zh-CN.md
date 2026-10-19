---
title: 编译链接或运行证明失败
description: 所选开发栈未完成真实最小项目并输出期望标记。
references: []
---

查看 stack、tool、expected、actual.code/stdout/stderr 与 recovery，区分编译器、
标准库、链接器、venv、运行时或执行输出问题。Rust 使用 offline 无依赖构建，
Python venv 必须具备本地所需组件。先修复明确缺失的组件再重测；
不将版本检查成功等价于工具链可用，不自动下载或安装依赖。
