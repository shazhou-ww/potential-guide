# 统一新 Task Engine 的 IPFS Bundle 引用与内容访问

## 问题

新架构用自定义 URL + Digest 定位 Task Bundle，并以 tgz 交付文件树，
重复维护内容寻址与打包机制；业务资源访问也不应依赖 Worker 在宿主上的物理位置。

## 结果

保持 Bundle 内容契约不变，以 IPFS 目录根 CID 统一身份、引用与获取，
Request 支持根 CID 字符串或 `{cid, hint}`，hint 可提供单个或多个候选 gateway；
外部按根 CID 加路径访问文件，业务 Worker 经 Task context 以字节流读取当前 Bundle 内容，
不感知本地目录，需完整字节时自行聚合；取消自定义引用、平行摘要与 tgz 必经链路。

## 边界

1. 仅限 Task Engine 新架构及其交付、装载与消费链路，不改既有 Check/Probe 业务制品。
2. 保留声明、Schema、自包含 Worker、完整准入及 Task/Run 生命周期语义；
   底层 IPFS access 只理解节点与内容，Engine 解释 Bundle，SDK 封装 context；
   IPFS 使用独立本地 endpoint，注入者管理客户端，Engine 不内嵌节点或关闭共享客户端。
3. 本轮先修订 axis；不实施运行时代码，不新增资产管理、权限或远程执行模型。

## 验收标准

1. 新架构以根 CID 多态引用 IPFS 目录，hint 只辅助获取，不再要求 URL + Digest 或 tgz。
2. Context 统一流式相对路径读取，不依赖宿主位置；完整准入与恢复一致，
   Engine 故障不连带终止 IPFS 服务，不把进程隔离当作续传或零丢失承诺。
3. [axis 影响范围](./Axis.md)可追溯到修订文档，并明确保留与排除的边界。
