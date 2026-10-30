# 独立消费验证

服务于 [Deployment.md](Deployment.md)，不修改实现契约或替代准确 revision 的生命周期记录。

## 候选与方法

主 Agent 使用本 idea 的[打包驱动](evidence/pack-schema-consumer.mjs)和[消费者](evidence/verify-schema-consumer.mjs)，仅在自有独立目录安装打包闭包，通过真实 localhost HTTP 和自有 SQLite 验证；所有 runtime 入口必须位于安装目录内。不开生产服务，不发布 npm，不使用其他 session 的工作树、数据库或端口。

## 失败与修正

首次验证针对同步候选 `8a755464cf83bd0eea6201046af5603bc4735474`，包安装、Schema 比较及发现/输入前置检查已经执行，但执行共享观察超时。自有 SQLite 事实显示 `allocation_failed: No compatible resource domain.`：验证脚本把 pool resources 写成 worker-a/worker-b，而 resourceKey 返回 isolated-schema-proof，属于验证夹具配置错误，不是实现代码缺陷。

已将资源键改为匹配的 domain，并用既有 cross-spawn 执行 Windows 包管理器，避免 shell 参数拼接。首次进程已退出、服务由 finally 关闭；旧自有安装目录在保留结果摘要后清理。修正脚本先同步 primary，再使用新的安装目录重新打包验证，不把首次失败计作通过。

## 最终结果

待修正候选的独立运行完成后记录。
