# 独立消费验证

服务于 [Deployment.md](Deployment.md)，不修改实现契约或替代准确 revision 的生命周期记录。

## 候选与方法

主 Agent 使用本 idea 的[打包驱动](evidence/pack-schema-consumer.mjs)和[消费者](evidence/verify-schema-consumer.mjs)，仅在自有独立目录安装打包闭包，通过真实 localhost HTTP 和自有 SQLite 验证；所有 runtime 入口必须位于安装目录内。不开生产服务，不发布 npm，不使用其他 session 的工作树、数据库或端口。

## 失败与修正

首次验证针对同步候选 `8a755464cf83bd0eea6201046af5603bc4735474`，包安装、Schema 比较及发现/输入前置检查已经执行，但执行共享观察超时。自有 SQLite 事实显示 `allocation_failed: No compatible resource domain.`：验证脚本把 pool resources 写成 worker-a/worker-b，而 resourceKey 返回 isolated-schema-proof，属于验证夹具配置错误，不是实现代码缺陷。

已将资源键改为匹配的 domain，并用既有 cross-spawn 执行 Windows 包管理器，避免 shell 参数拼接。首次进程已退出、服务由 finally 关闭；旧自有安装目录在保留结果摘要后清理。修正脚本先同步 primary，再使用新的安装目录重新打包验证，不把首次失败计作通过。

## 最终结果

修正后的准确候选 `dce0ffca8f89748adea3ed4e83e3b42a3b22fba8` 已先同步 primary，再执行独立验证；运行时为 Node.js 24.12.0，Windows，pnpm 11.22.0。2026-10-30T17:23:06.014Z 完成，驱动和消费者退出码均为 0。

机器证据：[运行入口、发现修订及断言](evidence/packed-proof.json)、[9 个内部包 tarball 摘要](evidence/package-digests.json)。所有运行入口均经 realpath 确认位于独立安装目录，而非源码工作树。

| 标准 | 外部验证结果 |
| --- | --- |
| D-AC01 | 7 组断言全部通过：Schema 独立判等及自由对象、自有 JSON 字段、联合等价关系/unevaluatedItems、真实 HTTP 授权发现、修订前置条件与原请求幂等、terminated 事件共享、Probe 准备失败及敏感输入拒绝 |
| D-AC01 | 401/403/412/400/409 精确断言通过；拒绝未增加持久 watermark；两份结构相同且额外字段不同的输入共享同一执行，只在终结时绑定；发现没有暴露运行环境或触发制品查询 |
| D-AC01 | Probe 摘要冲突通过同步授权后被接收，随后 preparation_failed；resolve/download 调用数为 0。大小写、编码等凭据键输入在写入前拒绝；普通 subject 对象及 file URL 参数可通过公开 Schema 校验 |
| D-AC02 | 自有 SQLite 实际关闭并重新打开，同契约记录恢复成功；同版本替换 Schema 后 start 明确抛出 unsupported_contract，没有重解释或重写既有输入事实 |
| D-AC02 | 服务关闭后真实 HTTP 端口请求失败；所有连接关闭，消费者进程退出。保留机器证据后，首次失败与最终成功的两个独立安装目录（含自有 SQLite）均已删除，并用 Test-Path 确认不存在 |

没有运行生产部署、npm 发布或资产管理，也没有修改来源工作区。此证据支持主 Agent 按委托审批当前准确 Outer 修订；阶段通过仍以同步的 submitOuter/acceptOuter 为准。
