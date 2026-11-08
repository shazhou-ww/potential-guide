# 验证 Probe Task Bundle 的真实交付与消费

本轮按用户委托自主审查部署门限，不发布 npm、不创建或修改公共 Pinboard publication。
交付渠道选择本次自有的临时 loopback HTTP raw-block Gateway，消费者使用独立 npm 安装，
不是源码或仓库 node_modules 的子目录。该范围证明实际交付/消费，不宣称永久公共托管。
产品源码固定为 `5428223891ebd6a049048aa5d8eb7e3cd972e017`，
Inner 修订为 `76a169ea63da3fa135a905f196f594a4e862bdb4`。

## Steps

### D-S01: 交付代表性 Probe Task Bundle

从准确源码的构建输出打包本地 tarball，并在独立 Node/npm 消费目录安装运行包和作者工具。
以真实 Pinboard 当前 tools Check 根
`bafybeifydrqggqypfapxiwt2bpovdprxae6iysrjhiua3d2jebico74u7a`
作为只读依赖来源，逐块验证后构建 Probe，保留来源锁、最终 CAR 根和包版本/散列。
也交付一份本次自有可控 Check，用于确定性取消及错误传播验证。
所有 Probe/Check 通过同一自有 Gateway 提供真实 HTTP 内容，不依赖 MemoryIpfsClient
或 source test runner 作为部署证据。

真实 publication API 的只读核对保留 Inner 证据中的旧版本拒绝边界。
指针更新仅在自有 HTTP publication-shaped fixture 中执行，用于证明构建固化；
不冒称已经更新真实 Pinboard publication，也不隐式发布新版本。

### D-S02: 验证独立消费者

在独立消费者环境中获取完整闭包、验证物化，并将 Probe Task Bundle 作为普通 Task
提交执行 Probe，检查有效文档与原始 Check 文档的可读取性。
使用独立安装的标准 Task Server/HTTP Client，记录父子 Task/Run 与原始响应。
覆盖首阶段失败、后续阶段失败、全部完成、文档 Override 与同语言继承；
验证 publication fixture 更新后原 Probe 根仍绑定原 Check。
在自有慢 Check 上验证父取消和子回收，关闭全部自有服务并确认端口不再响应。

## Acceptance criteria

### D-AC01: 精确成品可获取

真实渠道按记录的 Probe Bundle CID 返回完整可验证闭包；
以独立下载、哈希验证和物化记录证明，不以构建成功替代交付证据。
保存包清单、tarball SHA-256、消费者依赖图和模块实际安装位置。
父 CAR 的实际子目录根等于原 Check 根；物化后的完整文件集合与已验证快照相同。

### D-AC02: 消费结果与文档一致

独立 Probe 覆盖未完成与完成状态，实际读取 Override 和继承文档；
发布入口更新后原 Probe Task Bundle 仍绑定相同 Check 内容。
父子执行身份、业务输出、Run 退出/回收及取消结果有真实 HTTP 证据。
错误不能变成业务成功；服务清理失败不得记录为完成。
受限于本轮授权，公共发布与长期可用性不属于本次已证明结果。
