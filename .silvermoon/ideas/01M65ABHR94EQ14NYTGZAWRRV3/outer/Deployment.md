# Deployment

在仓库外验证两个包组成的 MVP，不要求 npm 发布或生产部署。

本地 file archive 扩展需重新验证。既有 Evidence.md/results.json 是已验收
`dda7b595c51d9bca022dd81c45dd95602879eab7` 的历史 HTTPS 证据；
其 pinned harness 保留历史含义，不宣称覆盖新的本地来源。

## 历史 HTTPS 验证协议

使用本世界的 [verification/verify.mjs](verification/verify.mjs)。
先同步本契约与 harness，重新观测准确 deploymentRevision，再传入该 revision 执行：

```powershell
node .silvermoon\ideas\01M65ABHR94EQ14NYTGZAWRRV3\outer\verification\verify.mjs --external-root D:\Code\check-server-mvp-deployment-<唯一名称> --revision <已同步的deploymentRevision>
```

目标目录必须在源码仓库外且此前不存在。harness 以准确的已验收 packages tree
`b7b9ad4ff41ef3421676cfe8cd61b658f0a1c977` 打包八个内部包，
建立纯契约、无制品 Server、Check + Server 三个真实独立安装，不使用工作区链接。
记录 tarball SHA-256、实际依赖遍历、来源与 runtime、真实 API 观测及 owned PID。
制品由独立消费者中的公开 author API 创建；受信任 fixture source 将准确 HTTPS 身份
映射到本次拥有的 archive 文件，明确不把该 fixture 称为真实远端 HTTPS 下载服务。

使用同一生产 Worker 的仅观察 preload 记录 Node Worker `exit` 事件，
并直接检查 owned 子进程 PID 已消失；不靠端口关闭、pool 计数或逻辑状态替代物理退出。
纯契约加载观察使用本机 Node 24.11.1 的 `registerHooks`，该 harness 环境要求不改变产品的 Node 最低版本契约。
程序化子进程通过 IPC 请求正常 close，自然退出而不强制 `process.exit(0)`；
真实 CLI 单独证明启动与消费，Windows 强制 SIGTERM 只作进程退出证明。
SQLite crash/restart 对照执行 marker、原 Task/Execution 身份、deadline、下载次数与
被替换的来源 archive，证明 queued 恢复原字节且未知 started 工作不重跑。

结果保存在 [verification/results.json](verification/results.json)，最终说明由
[Evidence.md](Evidence.md) 索引。每次运行删除本次唯一标记目录及 owned helper，
记录删除后的存在性。失败不勾选 D 项；若发现实现缺陷，停止并交父代理，不修改已验收 Inner World。

## Steps

### D-S01: 运行独立 MVP 消费者

在源码仓库外安装准确工具包和依赖，使用可校验的 Checker 制品，
分别验证程序化入口与 CLI，以受信任配置注册 Check，经真实鉴权 HTTP/SSE
完成提交、结果、历史和断线续接；另用无制品类型验证 Server 通用性。
记录工具来源与制品身份，不使用源码导入或旧 Host 进程。
另以独立消费者使用纯契约入口校验制品，记录安装依赖与导入边界，不以子路径替代安装隔离证据。

### D-S02: 验证故障恢复与资源退出

在独立服务进程中验证合法不通过、制品错误、执行故障、未授权访问、
共享取消、活动 SSE 连接下关闭、物理退出与 SQLite 重启，
记录脱敏证据并清理本次验证拥有的进程和文件。

### D-S03: 验证本地 archive 与上传组装

在仓库外用新包和显式 allowedFileRoots 执行本地 archive、不可变恢复与拒绝样例，
并验证会话级浏览器上传返回的是 endpoint 主机真实 file URL/digest，而不是伪装 HTTPS。
按新的实现 revision 更新适用 harness，再同步部署契约后执行，不改写历史证据。

## Acceptance criteria

### D-AC01: MVP 可独立启动与消费

从打包安装记录、监听就绪、实际 HTTP/SSE 和准确摘要证明消费者不依赖作者目录或旧 Host，
两种启动入口有效；无制品任务也可运行，未授权访问被拒绝。
业务不通过可作为正常结果读取，错误不会伪装成功，SSE 重连不另建任务或触发重跑。
契约入口可独立完成解析和校验，无网络、写盘或执行副作用；实际安装依赖与文档声明一致。

### D-AC02: 真实恢复与清理可复核

通过进程终止、重启及资源检查记录证明取消不伤其他需求，未知执行不重跑，
准确证据不被最新来源替换，已确认关闭后无本次遗留 worker。
无法确认清理时明确失败，不以端口关闭或计数归零替代物理退出证据。

### D-AC03: 本地文件消费与浏览器边界真实成立

独立安装消费者以 allowedFileRoots 和真实 file URL 执行可校验 Checker；
原文件替换/删除不改变已 Prepared 的执行或恢复结果，新的 unpinned Task 选择当前内容。
来源越界、链接、无 root/scope 授权均拒绝，file 不进入 HTTPS hook。
浏览器上传仅由本地 endpoint 的受控组装处理；外部 endpoint 不误读浏览器主机路径。
保存实际来源摘要、物理读取/清理与平台边界证据，不用旧 HTTPS 验证代替。
