# Deployment

本轮部署目标是可交付的本地安装产物与主分支同步，不包含 npm 发布或生产服务变更。

## Steps

### D-S01: 验证安装产物

使用仓库现有 deployment:verify 对打包安装后的命令发现与执行进行验证，不使用 npm 发布凭据。

### D-S02: 同步交付与保存证据

将已验收实现同步到 primary，记录安装验证及可追溯交付证据，完成部署门禁。

## Acceptance criteria

### D-AC01: 安装后入口可用

pnpm deployment:verify 成功，安装产物的相关入口可被发现并执行，证据记录在本世界支持文件中。

### D-AC02: 可追溯交付

primary 包含已验收实现与部署契约，工作区无遗留执行产物或未说明变更，部署验收引用确切 revision。
