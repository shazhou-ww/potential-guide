# 实现证据

## 官方依赖与归属

- 通过 npmx.dev 核对 `@helia/http@4.0.8`、`helia@7.1.16`、`@helia/unixfs@8.0.9` 的已发布版本及 API；版本统一进入 pnpm catalog。未使用 npm registry 做包研究。
- Bundle 的 `src/car.ts` 直接使用官方 UnixFS、Helia CAR、IPLD CAR 和 multiformats；本地仅保留离线容量、完整 DAG、规范文件树和格式准入。没有节点、网络、上传或 pin 装配。
- Engine 的 `src/content.ts` 使用 `withHTTP(createHeliaLight())` 和官方 UnixFS。静态 Gateway 是唯一网络来源，delegated routers 显式为空，无 libp2p、公共 fallback 或重定向。
- Helia 7.1.16 在 primary router 列表为空时存在队列不结束的实际行为；本地空 provider router 只负责让官方路由器结束这个空发现阶段，不发现节点、不发网络请求。受控 Gateway 的成功、404、损坏、超大响应、取消及 Worker 测试均经过此真实链路。
- `ipfs-content` 设为 private，只保留历史回归夹具；Bundle、Engine、service 和所有 packed 生产闭包均不依赖它。Engine 的显式离线测试夹具由官方 UnixFS 生成内容，不承担上传或 pin。

## 行为与迁移边界

- 默认准入验证目录、精确清单、类型、尺寸、声明、入口和 Schema，但不预取资源的全部后继块。accepted 不是所有资源离线可用的证明；首次访问未缓存块时，后续 Gateway 故障可使 Run 明确失败。
- `bundlePrefetch: true` 在准入前读取全部文件。完整预取成功后，或按需读取已覆盖全部资源后，已有验证块支持 Gateway 故障期间的缓存读取。raw 文件节点自身就是字节，解析此类节点时不可避免会读到整个小文件。
- 每次拉取使用最多 256 KiB 的官方 UnixFS 范围和单块读取并发；官方 exporter 在恰好位于边界时还可能读取相邻块，不能声称每次拉取严格只产生一次网络请求。测试证明首个范围没有读取完整 800000 字节文件，并验证后续块的实际请求和故障。
- 官方 trustless broker 对响应体实施 2 MiB 块上限；本地继续限制文件数、路径数、逻辑字节、文件尺寸、保留块数和总内存。取消同时覆盖后续拉取和正在等待的响应体。租约与驱逐按当前实际保留量回收预算。
- 官方 Gateway broker 会将 pathname 置为 `/ipfs/<CID>`；为避免静默丢弃旧前缀，配置拒绝 `/gateway` 等非根基址。旧部署必须迁移到独立根 origin。CID 内部的 Bundle 相对路径仍由官方 UnixFS 解析，嵌套资源和越界拒绝均有测试。
- 规范 CID 布局保持 CIDv1、raw leaves、256 KiB chunk、174 子节点 balanced layout、不含时间戳及目录分片。历史向量根仍为 `bafybeiebhql7fgalsvwuy55kkhii3pfukhjdyauualacmnkzeij4z6t6tq`，包含原有八块。
- 移除 CLI `publish`、库 `/publish`、`createIpfsClient`/`importTaskBundle` 和 `task-bundle.ipfsRpc`。旧 settings 注册需移除；外部上传工具、目标和 pin 策略由使用者选择。构建后的 Worker 仍自包含第三方代码，不增加动态模块加载器。
- 旧 `fetchIpfs` 传输注入移除，由官方 HTTP 客户端处理传输；hint 仍按实际块请求 URL 调用 `allowGateway`，并仅在主读取失败后使用已授权候选。

## 已执行验证

- Windows：`pnpm typecheck` 的 38 个 workspace 及根测试类型检查通过；生产依赖层检查通过。
- Windows：Engine 全套 193 项测试通过，覆盖 Task 准入、取消、Worker 生命周期、缓存与官方 Gateway 读取；还验证了按需模式在资源缺失时 accepted 后 Run 失败并回收，完整预取则在 Task 创建前 rejected。
- Windows：`node --test scripts/task-engine-contracts.test.mjs scripts/release-packages.test.mjs`，8 项通过。
- Windows：`node scripts/check-packages.mjs --task-service` 通过；真实 packed 安装的两个 CLI 入口分别经过 user/file/CLI/禁用 user 配置层，经受控 Gateway 执行自包含 Worker 并读取嵌套的 600000 字节资源，无 RPC。
- Windows：`node scripts/check-packages.mjs --task-sdk` 通过；离线 CAR 构建、移除作者来源、依赖可见/不可见控制及无 node_modules Worker 消费通过。
- Windows：`node scripts/check-packages.mjs --structure` 通过；候选不包含 ipfs-content 生产发布包。
- Windows：`node scripts/check-packages.mjs --task-bundles` 通过；独立生产宿主执行自包含 Check/Probe，真实负业务结果、诊断、历史和证据保留通过，作者 node_modules 不可见。
- Windows 原生 `pnpm check` 已实际执行，未跳过测试；Bundle 的 7 个既有符号链接场景在创建文件链接时遇到 `EPERM`。未修改断言或添加跳过规则。
- 在仓库自有验证副本中，WSL 的 `pnpm --filter @potential-guide/pguide-task-bundle exec node --import tsx --test "test/*.test.ts"` 完整执行 Bundle 108 项断言，108 通过、0 跳过，包括上述全部符号链接场景。验证副本的 73 个候选文件与工作树逐一比较 SHA-256，未发现差异；副本及运行 scratch 已清理。
- WSL/NTFS 仍不能替代原生 Linux 完整检查：大小写碰撞断言遇到大小写不敏感的挂载语义，tsx CLI 的 Unix socket 也不受该项目路径支持。没有修改系统权限、挂载或测试断言来伪造通过；完整 `pnpm check` 继续通过既有 Ubuntu CI 对准确候选 commit 验证，结果待补齐。
- packed 验证期间 pnpm 共享 store 出现 SQLite 损坏错误；未删除或修复共享数据，改用已核实生效的项目本地 `pnpm_config_store_dir`/`pnpm_config_cache_dir` 后验证通过。恢复时不要使用 pnpm 11 已忽略的旧 `npm_config_*` 变量。

## 关键内容指纹

| 文件 | SHA-256 |
| --- | --- |
| `packages/pguide-task-bundle/src/car.ts` | `d16d51199d58ef6ea459534b1fb94e99ee62c5b1c91a269d98c30fecd21d2b94` |
| `packages/task-engine/src/content.ts` | `b76365768bd5d806604cf3db374196a2ef0593b717a6c9a26b94c8a8e76592ca` |
| `packages/task-engine/src/bundle.ts` | `c11b82bcc9504a795e0d1d1bf11a9041221c6a7d6059f07325741cd2d0d289c3` |
| `packages/task-engine/test/gateway-resources.test.ts` | `09bb1be435e9ccb1394fe4534865814ec4e8535d2d4672981c6ff858783f1201` |

## 未执行范围

未执行 npm 发布、公共节点访问、外部上传或 pin，也未将受控内存 Gateway 当作外部持久交付证据。独立 CAR 导入、真实 Gateway 与最终外部结果保留给 Deployment 契约。
