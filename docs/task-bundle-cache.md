# Task Bundle 内容存储与内部复用

Task Bundle 的持久内容由交付方的独立内容服务管理，可经 Gateway 消费；本地 Kubo 不是消费前提。
参见 [Node/npm 消费走查](task-consumer.md)。Engine 不维护额外的 Bundle 文件缓存目录，
只在内存中保留已验证的装载结果、Schema、Worker 源码及已读取的块。
这些状态是内部运行机制，不是类型目录或操作员缓存管理产品。

原 `/bundle-cache` 列表、详情和删除 API 已移除，返回 404。
Engine 与 TaskClient 不再提供 `listCachedBundles`、`getCachedBundle`、
`removeCachedBundle` 或 `evictBundle`，也不再定义 `cache-read` / `cache-remove` 操作。
Web 工作台只提供 Task 和 Run 工作区，不提供缓存页或缓存管理代理。

准备时验证目录、精确 include/binary 清单、声明、Schema、入口和文件尺寸。
默认文本资源必须在准入前有界读取并验证合法 UTF-8/LF；旧清单或非规范文本不能用空占位符通过。
显式 binary 资源的后继块仍按 Worker 拉取读取；因此 accepted 不承诺全部 binary 资源已离线可用，
后续 Gateway 故障可能使 Run 失败。
`bundlePrefetch: true` 可在准入前读取全部文件，恢复完整预取的故障时点和离线读取能力。
小型 raw 资源自身就是文件节点，解析它时不可避免会读取全部字节。
准备与运行复用已验证块，并受内部租约、块数和总内存上限约束；未读取块没有保留保证。
驱逐按当前实际保留量回收预算；缓存不是持久副本，进程重启后按需重新获取。
关闭 Engine 释放它自己的内存状态，不关闭共享 IPFS 客户端或节点，不移除共享 pin。
IPFS 内容、pin 和垃圾回收应通过独立节点的管理工具处理，而不是通过 Task Engine。
历史查询读取持久事实，不因 Engine 内存状态释放而失效；需要再次执行时仍按根 CID 获取并验证内容。

生产 Gateway 客户端使用独立 `createHeliaHTTP`、官方静态 Gateway router、trustless broker 和 UnixFS。
delegated 服务、监听地址、P2P transports 与 peer discovery 明确为空，
静态配置之外没有发现或公共回退，HTTP 重定向被拒绝。
`createIpfsGatewayClient([primary, backup], {timeoutMs: 30000, attemptTimeoutMs: 5000})`
按操作者顺序逐块切换，保留旧字符串调用。每个缺失块共享总预算，单来源最多尝试一次；
没有健康管理、洗牌或负载均衡。错误列出实际尝试来源及超时/读取或校验失败分类。
换来源不换 CID，也不产生另一份缓存身份或历史。可信列表不是从 Request hint 推导的。
独立 HTTP-only 工厂避免完整 Helia 默认装配引入 Node 22.13 不支持的未使用依赖；
不依赖只对本仓库生效、但无法随发布包传递给消费者的 overrides。
旧 `fetchIpfs` 自定义传输注入已移除；生产 HTTP 传输由官方客户端处理。
`allowGateway(url)` 仍对 hint 的实际 `/ipfs/<CID>?format=raw` 请求 URL 授权，不改变为只检查基址。
授权 hint 排在可信列表后，共享同一块的剩余预算；没有显式策略时不访问 hint。
官方客户端按流限制每块最多 2 MiB；context 每次拉取至多读取一个 256 KiB 范围，
不是下载整个文件后切片。官方 exporter 在恰好位于块边界时还可能读取相邻块；
256 KiB 是输出范围上限，不是严格的单次网络请求字节上限。取消向网络和 UnixFS 传播。
官方 broker 不支持 Gateway 基址中的路径前缀，因此配置只接受 HTTP(S) 根 URL；
旧 `/gateway` 等部署应将 Gateway 暴露到独立 origin，不能静默改写或丢弃前缀。

参见 [Task Engine](task-engine.md) 和 [Task Bundle 契约](axis/task-engine-contracts/task-bundle.md)。
