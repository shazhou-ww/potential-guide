# Deployment

## Steps

### D-S01: 验证外部 CAR 交付与 Gateway 执行

在隔离消费者环境安装候选 tarball，由独立外部工具把生成的 CAR 导入受控内容服务，再通过 Gateway-only Engine 执行 Worker 并读取嵌套资源。不依赖仓库源码或本地链接，也不使用 Bundle 上传命令。

采用独立作者与运行消费者，只通过归档安装内部生产依赖，并验证解析位置、无 `workspace:`/`link:` 依赖及无作者工具、SDK、ipfs-content 的运行依赖。由已安装的 Kubo 0.43.1 CLI 在本任务独占仓库中导入 CAR、选择递归 pin 并离线重启；daemon 使用 `--offline`、空 bootstrap/Swarm/发现配置及回环 API/Gateway，不启动公共节点。运行消费者仅连接受控回环 Gateway，执行真实 Worker 并核对嵌套资源字节与 SHA-256。

### D-S02: 验证故障与迁移说明

在相同环境复核取消、缺失资源及 Gateway 中断的实际结果，并确认用户能够按文档选择上传方式和理解移除入口。本阶段不发布 npm 包或启动公共节点。

以独立冷启动消费者分别验证清单外路径、缺失资源块、CID 不匹配、在途读取取消及 Gateway 连接中断；核对 Task/Run 结果、物理回收、请求记录与外部 pin 保留。复核移除的 CLI/API/settings 和根 Gateway URL 迁移；不将按需准入误认为全部资源可离线读取。可复现入口为 `Verify-Delivery.ps1`，其只生成隔离环境与外部证据，不修改已验收实现。

## Acceptance criteria

### D-AC01: 独立消费者完成 CAR 到 Worker 的闭环

留存候选版本、CAR CID、外部导入结果、Gateway 请求与 Worker 输出，证明无需 ipfs-content 发布包、Bundle 上传入口或 Engine RPC 连接即可运行并返回正确资源。

证据包含准确候选 commit、部署契约修订、包版本和归档 SHA-256、CAR SHA-256/CID、Kubo 版本及二进制指纹、导入与重启后的 pin、完整 Request/Task/Run、资源期望值/实际值和 Gateway 请求轨迹。内部包均从 tarball 实际安装；pnpm 自身包内链接不指向仓库源码。

### D-AC02: 故障结果及用户边界得到确认

留存受控故障证据，证明错误不伪装成成功；外部使用步骤与实际命令一致，上传和 pin 仍由外部工具负责，没有执行 npm 发布。

取消须有 `canceled` 事实、在途连接关闭和 Run 回收；故障不得产生成功资源结果，Gateway 中断后也不得联系 RPC 或未配置来源。保留可重放命令和明确限制：本阶段仅证明回环隔离交付，不承诺公网可达、多副本、长期 SLA 或 npm 安装可用性。
