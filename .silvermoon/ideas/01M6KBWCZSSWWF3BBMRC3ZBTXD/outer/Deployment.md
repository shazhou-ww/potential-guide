# Deployment

## Steps

### D-S01: 验证外部 CAR 交付与 Gateway 执行

在隔离消费者环境安装候选 tarball，由独立外部工具把生成的 CAR 导入受控内容服务，再通过 Gateway-only Engine 执行 Worker 并读取嵌套资源。不依赖仓库源码或本地链接，也不使用 Bundle 上传命令。

### D-S02: 验证故障与迁移说明

在相同环境复核取消、缺失资源及 Gateway 中断的实际结果，并确认用户能够按文档选择上传方式和理解移除入口。本阶段不发布 npm 包或启动公共节点。

## Acceptance criteria

### D-AC01: 独立消费者完成 CAR 到 Worker 的闭环

留存候选版本、CAR CID、外部导入结果、Gateway 请求与 Worker 输出，证明无需 ipfs-content 发布包、Bundle 上传入口或 Engine RPC 连接即可运行并返回正确资源。

### D-AC02: 故障结果及用户边界得到确认

留存受控故障证据，证明错误不伪装成成功；外部使用步骤与实际命令一致，上传和 pin 仍由外部工具负责，没有执行 npm 发布。
