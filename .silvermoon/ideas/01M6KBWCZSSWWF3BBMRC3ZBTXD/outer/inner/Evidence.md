# 实现证据

## 官方依赖与归属

- 包研究仅使用 npmx.dev，实际安装采用普通 pnpm。最终锁定 `@helia/http@3.0.4`、`@helia/block-brokers@5.2.4`、`@helia/routers@4.0.6` 和 `@helia/unixfs@8.0.9`，版本统一进入 pnpm catalog。
- Bundle 的 `src/car.ts` 直接使用官方 UnixFS、Helia CAR、IPLD CAR 和 multiformats；本地仅保留离线容量、完整 DAG、规范文件树和格式准入。没有节点、网络、上传或 pin 装配。
- Engine 的 `src/content.ts` 使用独立 `createHeliaHTTP` 工厂和官方 UnixFS。清空默认 delegated 服务、监听地址、libp2p transports、stream muxers 和 peer discovery，只使用静态 Gateway router 与 trustless broker。官方 HTTP-only 客户端内部仍有 libp2p 身份对象，但没有 P2P 传输、发现、公共 fallback 或重定向。
- 首轮准确候选 CI [`41854155066`](https://github.com/shazhou-ww/potential-guide/actions/runs/41854155066) 发现完整 `helia@7.1.16` 根入口会加载未使用的 libp2p HTTP/undici 8，导致最低支持版本 Node 22.13 导入失败。因此改用独立官方 HTTP-only 工厂，而不是提升引擎要求或依赖仅在本仓库生效的 overrides。最初 Helia 7 空 primary router 的本地 workaround 随该试验实现一并移除。
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
- Node 22 兼容性调整后，受控 Gateway/按需与预取/真实 Worker 的 8 项针对性测试重新通过，根类型检查与 8 项依赖及发布清单断言重新通过；Engine 生产依赖树不再包含 undici。
- Windows：`node scripts/check-packages.mjs --task-service` 通过；真实 packed 安装的两个 CLI 入口分别经过 user/file/CLI/禁用 user 配置层，经受控 Gateway 执行自包含 Worker 并读取嵌套的 600000 字节资源，无 RPC。
- Windows：`node scripts/check-packages.mjs --task-sdk` 通过；离线 CAR 构建、移除作者来源、依赖可见/不可见控制及无 node_modules Worker 消费通过。
- Windows：`node scripts/check-packages.mjs --structure` 通过；候选不包含 ipfs-content 生产发布包。
- Windows：`node scripts/check-packages.mjs --task-bundles` 通过；独立生产宿主执行自包含 Check/Probe，真实负业务结果、诊断、历史和证据保留通过，作者 node_modules 不可见。
- Windows 原生 `pnpm check` 已实际执行，未跳过测试；Bundle 的 7 个既有符号链接场景在创建文件链接时遇到 `EPERM`。未修改断言或添加跳过规则。
- 在仓库自有验证副本中，WSL 的 `pnpm --filter @potential-guide/pguide-task-bundle exec node --import tsx --test "test/*.test.ts"` 完整执行 Bundle 108 项断言，108 通过、0 跳过，包括上述全部符号链接场景。当次验证副本的 73 个候选文件与工作树逐一比较 SHA-256，未发现差异；副本及运行 scratch 已清理。随后按最低 Node 版本 CI 反馈调整了 HTTP-only 工厂，最终候选以新的完整 CI 结果为准。
- WSL/NTFS 仍不能替代原生 Linux 完整检查：大小写碰撞断言遇到大小写不敏感的挂载语义，tsx CLI 的 Unix socket 也不受该项目路径支持。没有修改系统权限、挂载或测试断言来伪造通过；准确候选的完整检查结果以如下原生 Ubuntu CI 为准。
- 最终代码 commit 为 `7e06699b8cf78fb7ca5d42ea2f0345f57f422c7d`。既有 CI [`41858975838`](https://github.com/shazhou-ww/potential-guide/actions/runs/41858975838) 已在 [Node 22.13.0](https://github.com/shazhou-ww/potential-guide/actions/runs/41858975838/job/126675228371) 和 [Node 24.11.1](https://github.com/shazhou-ww/potential-guide/actions/runs/41858975838/job/126675228636) 上分别完整执行 `pnpm check` 并成功。未过滤、跳过或放宽现有测试断言。
- 同一准确 commit 的 [Windows packed CLI](https://github.com/shazhou-ww/potential-guide/actions/runs/41858975838/job/126675228557) 和 [Ubuntu packed CLI](https://github.com/shazhou-ww/potential-guide/actions/runs/41858975838/job/126675228662) 均成功，包含真实 tarball 消费与 Worker 执行。macOS packed CLI [任务 126675228938](https://github.com/shazhou-ww/potential-guide/actions/runs/41858975838/job/126675228938) 仍在等待 GitHub runner，不能声称整个五任务工作流已完成；双 Node 的完整检查结果已满足 I-AC03，macOS 排队作为额外跨平台验证限制保留给上游评审。
- 首轮 Node 24 CI 还观察到既有 Probe 低预算物理回收场景失败；没有改变该生命周期逻辑或断言，最终候选的完整 Node 24 检查已通过。
- packed 验证期间 pnpm 共享 store 出现 SQLite 损坏错误；未删除或修复共享数据，改用已核实生效的项目本地 `pnpm_config_store_dir`/`pnpm_config_cache_dir` 后验证通过。恢复时不要使用 pnpm 11 已忽略的旧 `npm_config_*` 变量。

## 关键内容指纹

| 文件 | SHA-256 |
| --- | --- |
| `packages/pguide-task-bundle/src/car.ts` | `d16d51199d58ef6ea459534b1fb94e99ee62c5b1c91a269d98c30fecd21d2b94` |
| `packages/task-engine/src/content.ts` | `f6fc18dcc3bda1fdc45f4364cba42a4c762a68d9f18e746ef88507795b612e19` |
| `packages/task-engine/src/bundle.ts` | `c11b82bcc9504a795e0d1d1bf11a9041221c6a7d6059f07325741cd2d0d289c3` |
| `packages/task-engine/test/gateway-resources.test.ts` | `09bb1be435e9ccb1394fe4534865814ec4e8535d2d4672981c6ff858783f1201` |

## 未执行范围

未执行 npm 发布、公共节点访问、外部上传或 pin，也未将受控内存 Gateway 当作外部持久交付证据。独立 CAR 导入、真实 Gateway 与最终外部结果保留给 Deployment 契约。
