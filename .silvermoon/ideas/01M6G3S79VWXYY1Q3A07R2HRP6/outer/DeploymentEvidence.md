# 独立 IPFS 部署验证证据

## 环境与执行

本机 Windows，Node v24.11.1，pnpm 11.22.0，官方 Kubo v0.43.1。
沿用实施阶段已校验 SHA-512 的二进制；没有下载或发布业务内容到公共 IPFS。
发布节点与消费节点使用不同的临时 repo/API/gateway，全部 `--offline`，
仅监听 loopback，日志确认 `Swarm not listening`。
Engine 运行于独立 Node 子进程，持久事实存于临时 SQLite 数据域。

验证前，部署契约与辅助已同步至 primary `d6d29b75529d6a627f613c8364c4fb064c092585`，
当时 `deploymentRevision=6cb9aa47d194`。
执行：

```powershell
node .silvermoon\ideas\01M6G3S79VWXYY1Q3A07R2HRP6\outer\verification\endpoint.mjs
```

退出 0。该辅助只负责自己的临时节点与进程，不管理共享 IPFS 服务。
结束后停止全部自建子进程并删除本次专用临时 repo 和作者目录。
源码与资源为人工生成的非敏感固定内容，没有 npm 发布、公共监听或外部节点传输。

## 观测结果

根 CID 为 `bafybeigvgtgl44su2dwo5mrigae5ozoow7mfcam3myaucrfzizqr56xg3e`，
完整 Bundle 包含 9 个经标准解析与哈希验证的块。

随后将 gateway 实例的 SQLite 路径也明确限定到本次临时目录，
同步到 primary `49ca32e556d20fd030f7471ca8a7eea717514b96` 后完整重跑同一命令，退出 0，
所有下表结果再次成立，`git status --short` 无输出，节点/数据库/作者目录没有残留。
重跑根 CID 为 `bafybeifcs7o5ueszsyjmp53vsakfwyr6vm6f62kbohlfs3wzgnz57x3gpq`；
构建源码包含临时作者位置，跨次验证 CID 可不同，不将其误作相同固定输入的重现性证据。

| 标准 | 实际结果与证明 |
| --- | --- |
| D-S01 | 使用两个独立 Kubo repo 和服务进程；SDK 在发布节点导入合成 Bundle，经验证复制块到消费节点并确认递归 pin。 |
| D-S02 | 停止发布节点并删除作者/构建目录后，消费节点按根 CID 和资源路径读取 600000 字节，Engine 完整准入并执行内存 Worker。 |
| D-AC01 | 实际结果为 `{bytes:600000,sum:25200000,chunks:3}`；代码和资源均不再依赖作者文件位置，提交不含 tgz URL 或额外 Digest。 |
| D-AC01 | 在新 Engine 实例中强制 RPC 读取失败，scalar hint 和包含首个无效路径的 array hint 均由实际 gateway raw-block 获取成功；共观察到 27 次网关访问，仍验证 CID。 |
| D-AC02 | 另起一个已读取资源且仍在运行的 Run，受控强制终止 Engine 子进程；消费节点仍能查询版本，发布者根 pin 列表与终止前一致。 |
| D-AC02 | 以内容客户端必定失败的方式重启 Engine，同一 SQLite 中已完成 Task、原始 Request 和 Run 历史仍可读取；不确定旧 Run 恢复为 stopped，不重新执行。 |
| D-AC02 | 同一缺失内容客户端处理新的同 CID 请求，结果明确 rejected；未换用其他 CID，也未将失败伪装成完整空内容。 |
| D-AC02 | gateway Engine 正常关闭后，独立消费节点及发布者 pin 仍不变；不关闭调用方客户端或撤销外部 pin。共享同 CID 双持有者的独立单元证据亦在实施门限保留。 |

该验证证明进程故障隔离及已确认内容保护，不保证未完成上传、进程缓冲或网络流自动续传，
不保证整机/磁盘故障下零丢失。它不是公共生产服务上线或长期存储承诺。

## 审批边界

用户已授权协调者负责门限审批。实施门限已基于相关 suites、类型检查和独立生产安装图接受。
全仓 `pnpm check` 的并行重启时限失败与既有技能职责分类 `unverified` 仍明确保留，
未修改无关规则、降低 TLS 验证或声称全仓绿色；不将这些例外伪装为部署环境结果。
本部署验证直接覆盖既定 D-S01、D-S02、D-AC01 与 D-AC02，可据此提交准确 outer revision。
