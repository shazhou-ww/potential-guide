---
title: 工具未安装或不在 PATH
description: Git 或所选栈的必要工具出现 ENOENT。
references: []
---

根据 tool、expected 与 recovery 确认所选栈确实需要此工具。明确安装可信版本或修正
账号 PATH 后重新检查。TypeScript 使用已安装 npm/tsc，不通过 npx 隐式下载；
Rust 需要预先配置可用工具链。检查不执行安装。
