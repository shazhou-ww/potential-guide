---
title: 身份与管理权限
description: 验证真实账号、HOME、目录和 sudo 授权。
references: []
---

使用系统用户信息与 uid，而不是仅依赖 USER 环境变量。拒绝 root、用户名或 HOME
不匹配；目录必须归当前 uid 所有且无符号链接路径。根据容器标志与内核识别
container/wsl/native-linux。`sudo -n -l` 必须显示完整的 ALL 用户和 ALL 命令
NOPASSWD 授权，加入 sudo 组不等于已通过；不实际执行管理员操作。
