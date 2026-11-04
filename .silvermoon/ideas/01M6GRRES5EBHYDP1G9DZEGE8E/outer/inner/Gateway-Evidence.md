# Gateway 实施证据

## 范围与环境

本次仅为 Inner 实现候选。基于主线 `7a94f12471205fdd7806afbe1cd3a5ab5c433a9e`，
Windows、Node.js `v24.11.1`、pnpm `11.22.0`；不修改 Ideal、事件、Deployment 种子，
不提交门限事件、不发布 npm。历史 Evidence/Handoff/Outer 证据仍只证明原 RPC 范围。
所有运行数据使用本工作树内独立测试目录、新 SQLite 与随机端口；
未改真实用户设置、旧数据库或外部服务。测试拥有的进程、监听、目录由测试清理。

## 实现与边界

- `packages/ipfs-content` 导出 `createIpfsGatewayClient`，与 `createIpfsClient` 分离。
  CLI 显式选择 `gateway` 时只创建前者；默认仍为 `rpc`，仅填写 URL 不切换。
- 服务文件 `ipfsTransport` / `ipfsGatewayUrl`、对应 CLI flag 和完整用户 setting ID
  均实现四层覆盖。每层先校验所提供字段，合并后检查 Gateway 必需 URL。
  项目服务值不参与，禁用用户层不读取，路径仍按各来源锚定，旧模块继续拒绝。
- HTTP(S) base URL 禁止凭据、query、fragment（含空 `?` / `#`）；
  `/base` 与 `/base/` 都在其下追加 `/ipfs/{cid}?format=raw`。
  请求为 GET、Accept `application/vnd.ipld.raw`、省略凭据、拒绝重定向。
  仅接收 200、raw MIME 与无编码或 identity；先检验声明长度，流中累计到限即取消，
  不无界 `arrayBuffer()`。默认 2 MiB/块、30 秒/读取（包含 body），支持调用方取消。
- 既有 Gateway hint 复用同一 bounded reader，仍须显式 host policy；
  它不是服务 transport 的自动 RPC 回退。CID 校验、UnixFS exporter、DAG/文件/总保护预算保留。
  RPC、程序化内容注入、作者写块/pin、本机 Caller/浏览器限制、Engine/UI HTTP 边界不变。
- 更新 help、设置描述/生成器输出、相关 README、示例 YAML、指南与 packed 导出/消费者检查。
  新增 SDK 仅作为服务包的开发测试依赖，未加到其生产依赖。

## 已执行验证

| 命令 / 证明 | 结果 |
| --- | --- |
| `pnpm install --ignore-scripts` | 添加测试 SDK workspace 开发依赖后执行；成功，仅改变对应 lockfile importer。 |
| `pnpm exec turbo run build --filter=@potential-guide/pguide-task-engine... --filter=pguide...` | 成功，25 个 workspace。 |
| `pnpm exec tsx --test packages\ipfs-content\test\*.test.ts apps\pguide-task-engine\test\*.test.ts packages\task-engine\test\bundle.test.ts packages\task-engine-server\test\bundle.test.ts` | 16/16 通过。 |
| `pnpm --filter @potential-guide/task-sdk exec tsx --test test\bundle.test.ts` | 4/4 通过；作者构建/导入、锁定 Schema、移除作者源码后的 worker 运行。旧 include fixture 未复现失败。 |
| `pnpm --filter @potential-guide/task-engine-server exec tsx --test test\server.test.ts test\bundle-cache.test.ts` | 8/8 通过；程序化导入无副作用、认证、HTTP/SSE、回滚、Store 所有权和资源关闭保持。 |
| `node scripts\check-packages.mjs --task-service` | 退出 0；4 个显式消费包、22 个内部生产依赖，以本地 tarball 隔离安装后通过。两个真实 CLI 入口均以无可用 RPC 的 Gateway 成功执行，结果精确为 `{text:"packed"}`；Engine-only、UI assets、跨站拒绝、退出清理通过，公共 Gateway export 可用。 |
| `node scripts\build-settings.mjs --check`、`pnpm exec tsc -p tsconfig.test.json --pretty false`、`git diff --check` | 均退出 0；设置未过期、测试类型检查与差异空白检查通过。 |
| 定向 Biome lint / format | 退出 0；保留现有 warning 级规则，不声明零 warning。 |
| `silvermoon check --worktree --audience agent` / `silvermoon check --staged --audience agent` | 均退出 0；只校验本次候选，未追加 Submit/Accept 或同步主线。 |
| `pnpm check`（本次最终代码） | 退出 1；build/layers、format、lint、typecheck 已通过到 test；全量 test 被下述既存分类问题中断，因此没有执行其后完整 pack 阶段。单独 Gateway packed 消费已通过，不冒充全量通过。 |

16 项定向证明具体包括：

- 标准 UnixFS 多块文件通过独立 HTTP Gateway 重建；逐块 CID 校验、DAG 块数、
  文件尺寸、累计保护预算拒绝保持。
- 错误 404/206、缺失/错误 MIME、gzip、坏块 CID、过大 Content-Length、
  无长度的无限流（缩小测试预算验证到限立即取消，而非读完）、非法 CID/URL 均失败。
- 真实 HTTP 的 headers/body 超时与消费者取消、预先取消、重定向不访问目标、
  不可达 endpoint 明确失败；测试将可配置超时缩至 100ms，而非等待生产默认 30 秒。
- 默认 RPC、URL 不隐式选择、Gateway 缺 URL、用户→文件→CLI 覆盖；
  被覆盖的非法 transport/URL 仍失败，禁用用户层完全跳过；
  两个入口的进程错误矩阵、help、新设置、项目层排除、来源路径及 `.mjs` 无副作用拒绝保持。
- 真实服务组合 Engine-only / 带 UI 均以 Gateway 执行，精确结果 `{text:"gateway"}`。
  带 UI 经 bootstrap/CSRF 和公开 HTTP 代理提交与读取；所配 RPC 探针收到零请求，
  Gateway 错误后也不访问 RPC。关闭服务后原内容源仍能响应。
- 原 Kubo RPC HTTP fixture 的 `block.get`、原程序化服务器 Bundle 执行/SQLite 重开、
  主 client 注入和受 host policy 约束的旧 Gateway hint 均通过。

## 全量基线与未声明结果

两次 `pnpm check` 均在
`packages/objective-monorepo-standard/test/pilot.test.mjs` 的
`real repository has thirty-seven package-owned subjects and no old contract input`
失败：`.agent/skills/component-responsibility-docs/SKILL.md` 缺少责任分类，
实际 `unverified`，预期 `pass`。本次最终运行 Turbo 为 66 successful / 74 total，
不是 74 项全通过；因 fail-fast 不推断未结束任务的结果。

独立复核：
`pnpm --filter @potential-guide/objective-monorepo-standard exec tsx --test --test-name-pattern="real repository has thirty-seven" test\pilot.test.mjs`
仍仅给出同一分类问题。该文件在 HEAD 与工作树的 Git blob 均为
`eaefe0432771c641b680091ffb04e000fb0fcac4`，相关分类规则/测试未修改；
未为本任务修复无关基线。本次未观察到 type-supervisor 超时，不沿用旧会话结论。
lint 退出 0，但其既有缺失路径诊断及 warnings 不视为本次新失败。

补充回归起初从根目录直接运行 SDK/Server 文件不符合它们的 package CWD，
产生包解析失败；改用上表的 package-local 命令后全部通过，未安装额外补救依赖。
分类单项最初使用 Node 而非该包要求的 tsx 也有模块解析失败；
修正 runner 后得到上面明确的基线失败，未将调用错误归因到代码。

本记录不包含真实 Kubo daemon 或仓库外运维验收、不保证公共 Gateway 可用性或持久化，
不替代 Outer 阶段。Deployment `D-*` 保持未执行，等待 parent 同步与门限验收。
