---
title: 真实工具链证明
description: 检查所选栈的工具版本、编译、链接和执行结果。
references: []
---

Git 总是检查。TypeScript 检查 Node、npm、tsc，编译严格类型程序并用 Node 执行；
Python 创建 venv 并用其解释器验证独立环境；C++ 使用 c++、CMake、Ninja 配置、
编译、链接、运行；Rust 检查 rustup/rustc/cargo 并 offline 构建无依赖 Cargo 程序。
所有程序必须输出 pguide-health-ok；失败包含工具、期望、实际输出和恢复提示。
临时项目位于 scratchDirectory 的唯一子目录，结束或异常后清理。
不下载、不安装、不在 workspace 建造重复项目；未选择的栈不适用。
