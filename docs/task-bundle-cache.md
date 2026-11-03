# Task Bundle 内容存储与内部复用

Task Bundle 的持久内容由独立 IPFS/Kubo 节点管理。Engine 不维护额外的 Bundle 文件缓存目录，
只在内存中保留已验证的装载结果、Schema、Worker 源码及活动内容保护。
这些状态是内部运行机制，不是类型目录或操作员缓存管理产品。

原 `/bundle-cache` 列表、详情和删除 API 已移除，返回 404。
Engine 与 TaskClient 不再提供 `listCachedBundles`、`getCachedBundle`、
`removeCachedBundle` 或 `evictBundle`，也不再定义 `cache-read` / `cache-remove` 操作。
Web 工作台只提供 Task 和 Run 工作区，不提供缓存页或缓存管理代理。

准备与运行仍复用已验证内容，并受内部占用保护和容量上限约束。
关闭 Engine 释放它自己的内存状态，不关闭共享 IPFS 客户端或节点，不移除共享 pin。
IPFS 内容、pin 和垃圾回收应通过独立节点的管理工具处理，而不是通过 Task Engine。
历史查询读取持久事实，不因 Engine 内存状态释放而失效；需要再次执行时仍按根 CID 获取并验证内容。

参见 [Task Engine](task-engine.md) 和 [Task Bundle 契约](axis/task-engine-contracts/task-bundle.md)。
