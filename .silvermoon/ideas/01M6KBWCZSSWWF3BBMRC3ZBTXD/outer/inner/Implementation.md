# Implementation

## Steps

### I-S01: 验证官方读取链路与行为边界

针对拟采用的已发布版本验证 HTTP-only Helia 与 UnixFS 文件读取，关闭非配置路由和公共回退。核对路径前缀、取消、流控、缓存及全量预取与按需读取的差异；不将现有附加策略自动视为必须保留的能力。

采用 `@helia/http@3.0.4`、`@helia/block-brokers@5.2.4`、`@helia/routers@4.0.6` 和 `@helia/unixfs@8.0.9`。使用独立 HTTP-only 工厂以保留 Node 22.13 兼容性，不导入完整 Helia 默认装配；显式清空 delegated 服务、libp2p 传输和 peer discovery，只配置静态 Gateway，拒绝重定向及带路径前缀的基址。默认按需读取资源后继块，显式 `bundlePrefetch: true` 保留完整预取选项；以受控请求记录验证实际网络行为而非仅比较最终字节。

### I-S02: 收敛 Bundle 与 Engine 职责

Bundle 直接使用官方 UnixFS/CAR 能力，移除 publish、RPC 配置、上传及 pin API。Engine 使用官方路径解析与字节流，保留 Task 准入、路径授权及 Worker 通道；调整或移除 ipfs-content 的生产依赖和测试夹具入口，避免复制通用 IPFS 实现。

离线 CAR 的容量和规范文件树规则归属 Bundle；准入、租约、块预算及 Worker 拉取窗口归属 Engine。`ipfs-content` 仅保留为 private 的历史回归夹具，退出发布验证清单、生产依赖和交付闭包；生产可消费的离线夹具入口使用官方 UnixFS，不再重导出该包。

### I-S03: 更新关联契约与发布清单

同步 CLI 帮助、文档、测试、示例、打包验证、依赖与发布清单，明确移除入口及资源读取行为变化。构建后的 Worker 继续包含非内置 JS 依赖，本改造不新增任意动态模块加载器。

具体实现理由、已验证行为、平台限制和验证命令统一记录在 [Evidence.md](Evidence.md)。外部 CAR 导入、持久 pin、真实节点和 npm 发布不属于本阶段的执行证据。

## Acceptance criteria

### I-AC01: 官方 Gateway 与 Worker 资源链路可验证

用受控 Gateway 和真实 Worker 证明嵌套资源路径可正确读取，CID 不匹配、路径越界、缺失内容和取消均有明确结果；通过请求记录证明未使用 RPC、非配置 Gateway 或公共发现。

### I-AC02: 离线 CAR 与依赖收敛可验证

通过 CLI、库接口及打包消费者测试证明可离线生成并检查 CAR，上传和 pin 入口已移除，独立 ipfs-content 不再属于生产发布闭包。检查规范 CID 兼容性；如需改变，明确记录影响与迁移边界。

### I-AC03: 关联验证与行为说明完整

pnpm check 通过；测试和文档覆盖按需读取、后续 Gateway 故障、缓存及有界读取的实际语义，并说明保留的本地业务逻辑及其归属。
