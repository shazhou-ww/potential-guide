---
title: 配置与 ACP 检查
description: 验证自动发现的两级 JSONC 配置、必需命令、Agent 选择、环境引用及 initialize/session/new。
references: [pages/bootstrap]
---

启动 ACP 进程但绝不发送 session/prompt。目标用户目录或 workingDirectory 最近项目
至少有一份实际 config.jsonc；默认值不替代存在证据。新 subject 拒绝 configPath。
有效配置依完整 setting ID 浅合并。缺少环境引用不能从秘密文件中补取。
