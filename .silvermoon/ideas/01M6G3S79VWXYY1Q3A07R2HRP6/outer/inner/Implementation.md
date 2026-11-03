# Implementation

准备阶段的 axis 修订已完成；本轮依据实施授权落地运行时与消费端。
实施依据[Task Bundle 契约](../../../../../docs/axis/task-engine-contracts/task-bundle.md)，
仅覆盖新 Task Engine 的 Bundle 链路。

## Steps

### I-S01: 对齐新架构契约与影响范围

维护 axis 及[影响范围](./ideal/Axis.md)，落实 IPFS 身份、目录交付、完整准入与保留边界。

实施保持 `ideal/Idea.md`、`ideal/Axis.md` 原样，不推进 lifecycle 或 Deployment gate。
公共说明同步到 Engine、SDK、HTTP、Server、Web UI、Worker 协议和环境检查样例。
唯一 Task v1 原地演进，声明布局及既有 Checker/Objective/Probe 业务格式与业务引用不变。

### I-S02: 实现标准 IPFS 交付与装载

复用标准 IPFS 实现，固定可复现的目录导入参数；打通 SDK 目录交付、可验证获取、
入口装载、context 相对路径字节流及活动内容保护，移除新架构 URL/Digest 与 tgz 依赖；
块缓存复用 IPFS 能力，不要求业务依赖宿主目录，资源物化与否作为实现选择。
底层 client/access 只处理节点与内容；Bundle 解释由 Engine 完成，context 由 SDK 封装。
客户端连接独立本地 IPFS endpoint，不在 Engine 进程内嵌节点；注入者关闭客户端，
Engine 只释放自己的读取与保护，不能关闭共享客户端或撤销其他持有者的 pin。
如采用内存源码启动，验证生成入口、协议与诊断行为，不直接把 IPFS 流交给 Worker 构造器。

具体实现：

- `@potential-guide/ipfs-content` 为通用节点/内容包，不认识 Bundle 或 Run。
  `await createIpfsClient(url)` 惰性装载 `kubo-rpc-client@7.1.0`，
  连接注入者独立管理的本地 Kubo RPC 服务；不内嵌或启动节点。
- 使用 `ipfs-unixfs-importer@17.1.1`、`ipfs-unixfs-exporter@16.2.3`、
  `multiformats@14.0.5`。目录导入固定 CIDv1/SHA-256、raw leaves、
  262144 字节固定块、balanced 174 links、排序路径、wrap directory、
  无 mode/mtime、不对预算内目录分片。地址完全由标准实现生成。
- SDK 离线构建返回 `{directory,cid,declaration}`；`importTaskBundle` 用同一标准
  importer 生成的准确块调用节点 `block.put`，逐项核对 CID 回执，最后确认递归根 pin。
  不依赖 daemon 的可变导入默认值；未确认 pin 不报发布成功。该 pin 归发布调用方管理。
- Engine 在受理前遍历并校验**全部 DAG 链接**，再完整读取/验证所有逻辑文件、
  声明、Schema 闭包、路径、重复/空目录/特殊文件及容量，不用运行时流绕过准入。
  `worker.cjs` 从已验证、有界内存源码以 Node CommonJS `eval:true` 启动，
  每个 Run 独立 Worker；作者模块仍只在可信 Run 命令后求值。
- `context.bundle.read(relativePath,{signal?})` 统一返回
  `ReadableStream<Uint8Array>`，SDK highWaterMark 为 0，每流最多一个在途 pull。
  上游 exporter 内部有 eager queue，因此通过标准 256 KiB range window 有界推进；
  DAG 解释、范围及截断校验仍由标准库负责，不维护第二套文件寻址。
  创建/消费中途错误、取消、背压与结束明确区分，没有宿主路径或整文件平行 API。
- Engine 仅持有自己的有界 verified blocks/lease，避免共享 Kubo pin 无 owner
  语义时误撤保护。默认完整内容 64 MiB、256 文件、512 路径、16384 DAG blocks，
  单文件 64 MiB、16 个 hints、全 Engine protection 总量 256 MiB。
  超限明确失败；显式淘汰归还自己的保护预算。节点 GC 不破坏活动内容。
  Engine 从不关闭 client、停止节点、删除共享 pin 或节点块；关闭先请求 Run 停止，
  再取消自己的读取并释放自己的保护。

### I-S03: 统一新架构身份与消费链路

对齐 Request、preparation、缓存、Run 匹配、持久记录与消费端的 CID 引用；
支持根 CID 字符串与 `{cid, hint}` 的单个或多个候选 gateway 提示，
新增针对性测试，保持原始意图、生命周期及业务制品边界。

具体接线：

- Protocol、Request/Task/Run bindings、preparation、共享匹配、缓存、HTTP client/server、
  SQLite submission 恢复、UI 表单/历史/星标和查询使用 CID；查询键为 `bundleCid`，
  缓存详情/删除回执身份字段为 `cid`。不提供旧 URL/Digest 或 tgz 成功回退。
- `bundleCid` 规范化 CID 表示后用于内容身份。原始 Request 仍保留 CID 引用形状、
  scalar/array hint 及顺序；同 requestId 改写它们仍是幂等冲突。
  hint 只用于有序候选获取，默认无 gateway 访问授权，宿主通过 `allowGateway` 放行；
  HTTP raw block 一样验 CID，拒绝重定向，不把 hint 当信任依据。
- 新 submission 写入内部 `bundleProtocol:"ipfs"` 标记，区分不支持的旧持久协议。
  新请求即使因非法引用而被拒绝，仍可重启读取原始意图及持久拒绝；
  旧协议事实/记录（包括 Task 已清理后仅剩的旧幂等记录）在修改前明确拒绝，
  不迁移、不删除、不重演。
- SDK examples、公开 `examples/task-server`、环境检查 Bundle、Check/Probe 新 Task
  链路、独立包消费脚本与测试 fixtures 均迁移。Check/Probe 的 Checker/Objective
  URL/Digest 输入、归档及业务证据仍保留原格式；仅 Bundle 内资源读取改走 context 流。
  离线 fixtures 使用标准 importer 的通用内存 client，不冒充外部部署证据。
  Web UI 的 Node server 也打成自包含交付，避免共享 CID 校验引入运行时安装依赖；
  DOM fixtures 的 Event/EventTarget 构造器保持同一 realm，不干扰标准库后台读取。

## Acceptance criteria

### I-AC01: 架构契约一致

通过范围内文档审阅与引用检查，证明寻址和交付已统一为 IPFS，保留的内容契约及排除项无冲突。

### I-AC02: 获取与执行可验证

通过集成测试证明相同导入参数产生相同 CID、单文件可验证读取、完整 Bundle 可装载执行；
业务回调通过 context 的统一字节流读取资源，需要完整内容时自行聚合；
通过背压、取消、创建及消费中途错误测试证明不会无限缓冲或将截断视为成功。
在宿主装载位置改变后仍得到同一内容，
不依赖 `__dirname` 或工作目录；不存在文件、越界与读取失败明确报错，
错误 CID、缺块、非法文件或容量超限明确失败，不绕过完整准入。

### I-AC03: 身份与行为连续一致

通过新架构链路测试证明同 CID 的内容复用、不同 CID 的匹配隔离、重启恢复与历史读取正确；
覆盖三种引用形状、hint 不参与内容身份、hint 改变仍触发原始意图冲突，
以及宿主访问策略和 CID 验证不被 hint 绕过；
空字符串、空数组、非法 URI 与宿主上限通过边界测试；
共享客户端和同 CID 多持有者在单 Engine 停止时不被关闭或误撤保护；
新入口明确拒绝旧引用，相关检查通过且未改变既有业务制品格式。

## 实施证据

### 定向验证

- `pnpm --filter @potential-guide/ipfs-content test`：2 项通过，覆盖标准单文件读取、
  暂停消费时有界预取、取消、错误 CID、缺文件与中途缺块/损坏。
- `pnpm --filter @potential-guide/task-sdk test`：14 项通过，覆盖自包含 Worker、
  Schema 闭包/锁、v1、诊断保持，以及 creation/midstream/cancel/abort 流协议。
- `pnpm exec tsx --test packages\task-engine\test\bundle.test.ts packages\task-engine\test\bundle-special.test.ts packages\task-engine\test\bundle-admission.test.ts`：
  最终 12 项通过，覆盖完整准入/容量/缺块、同 CID 共享与不同 CID 隔离、
  hint 原始意图冲突、源码/资源不依赖作者或装载位置、停止与恢复、旧协议拒绝及保护预算归还。
  用标准 CID/块构造的 UnixFS symlink
  也在准入前拒绝，不因 exporter 将它表示为 file 而接受。CIDv0/v1 别名在查询、
  缓存 detail/分页/淘汰与活动保护中统一规范化。
- `pnpm exec tsc -p tsconfig.test.json --pretty false` 和相关 workspace build/typecheck 通过。
- 曾以跨包 concurrency=2 运行相关 suites，遇到已知负载敏感的
  `task-engine-storage/test/startup.test.ts` 10 秒 `startup fixture stalled`；
  不能据此宣称那次批量或全量通过。之后相关 10 个 workspace suites 共 408 项通过：
  Protocol 101、IPFS content 2、SDK 14、Engine 158、HTTP 19、Storage 48、
  Server 19、Check 20、Probe 19、Environment 8。
- Web UI 全 suite 在并行调度时遇到原有 5 秒真实目录观察负载边界；
  在该 workspace 运行 `tsx --test --test-concurrency=1 "test\*.test.ts"` 完整 91 项通过，
  包括独立、无 UI node_modules 的真实 HTTP/SSE 诊断交付。
- 复制公开 `examples/task-server` 到仓库内独立作者 fixture，执行
  `probe-integration.mjs` 通过：实际负业务结果、context 资源字节流、
  一个 Checker Worker、in-process/HTTP 一致、SSE 补读、授权 Child 历史、
  SQLite 恢复与物理清理均验证，原业务输入和证据格式不变。
- `node --test "scripts\*.test.mjs"` 最终 37/37 通过；
  耦合的 dependency graph 断言已补新标准包与 multiformats。
- 修改文档的 37 个本地链接存在性检查、`git diff --check` 通过；
  ideal 与 lifecycle events 无差异，稳定 I/D ID 与 ledger 同步。

### 独立本地 IPFS 集成

使用官方 Kubo v0.43.1 Windows amd64 二进制，校验发布方 SHA-512：
`e611cecef25cddb10b7f907145383608d9b31219ad7120041aeacfe2313882da1944f2897fda29bc2d959dd357e4950089ec8f2cbd52b29f2fc472bcae4356d0`。
工具启动独立进程，`--offline` 日志明确为 `Swarm not listening`，
RPC/Gateway 仅监听 loopback 55001/55080，未上传任何内容到公共网络。

`node scripts\verify-task-ipfs.mjs` 使用固定的非敏感 600000 字节 fixture，
验证相同导入得到相同 CID、节点按根 CID+路径读取、真实 HTTP/SQLite 完整准入、
内存 Worker 三块流式执行、独立历史重启和 gateway raw-block CID 校验。
验证 Engine 关闭后节点仍响应且 caller pin 不变；helper 不管理节点生命周期、不撤共享 pin。
此为实施集成验证及可重复的部署辅助，不证明独立第二节点或故障部署 gate；
所有 `D-*` 保持未勾选，后续由父协调者审批推进。

最后一次独立 Kubo 验证的根 CID：
`bafybeih7altaddterom4lnumotkkfervxs2sgk27bwtcen3eb6am2w6c3e`。
验证进程已停止；没有 npm release、git commit/push 或 lifecycle 事件变更。

### 非绿色检查与外部阻碍

- 已实际运行 `pnpm check`。build/layers/format/lint/typecheck 通过，
  最后一次在未改动的 `check-environment/test/checks.test.ts:221` 失败：
  并行负载下命令取消后 `process.kill(pid,0)` 未按断言抛出 `ESRCH`。
  同一完整 Environment suite 单独重跑 8/8 通过；未修改该既有业务实现或放宽测试。
- 新 workspace 的 objective、root deliveries、generic layer 与 subject 数 35 已登记。
  定向重跑 monorepo 的 real-repository 测试后，仅余原有
  `.agent/skills/component-responsibility-docs/SKILL.md` 缺 responsibility rule 的
  `unverified`；未删除该技能，也未擅改无关归类策略。
- `node scripts\check-packages.mjs --task-bundles` 的全部相关 tarball 文件/导出检查通过，
  但新 production consumer 安装被 npm registry
  `ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE` 阻断。
  标准 TLS/IPv4、另一公开 registry、显式 `--offline` 均尝试过；
  严格离线安装缺 `kubo-rpc-client` metadata，锁定的离线 deploy 又被 pnpm
  supply-chain metadata 缓存缺失拒绝。没有绕过 TLS 或供给链校验，
  不能宣称全新安装的独立 author/runtime package graph 已通过。

因此代码实施步骤与 I-AC01/I-AC02 有直接证据；
I-AC03 的行为部分已验证，但“相关检查全部通过”仍受以上环境/既有检查阻碍，
保持未勾选，交由父协调者处理，不把局部通过写成全量通过。

### 协调者复核与门限裁决

协调者复核 CID 引用与 hint、完整准入和保护预算、通用 IPFS 获取、SDK 流协议、
Worker 资源拉取与内存入口，并独立执行：

- `pnpm exec tsx --test --test-concurrency=1 packages\ipfs-content\test\*.test.ts packages\task-protocol\test\bundle-reference.test.ts packages\task-sdk\test\streams.test.ts packages\task-engine\test\bundle.test.ts packages\task-engine\test\bundle-special.test.ts packages\task-engine\test\bundle-admission.test.ts`：
  20/20 通过，覆盖逐块读取、损坏/缺块、中途流错误、背压与取消、共享客户端保护、
  引用原始意图、完整准入及旧持久协议显式拒绝。
- `pnpm exec tsc -p tsconfig.test.json --pretty false` 通过。
- 再次执行 `node scripts\check-packages.mjs --task-bundles`：
  11 个相关 tarball 检查完成，新独立生产消费者仍因 registry TLS handshake 失败而无法安装。
  此为当前无法解除的外部验证阻塞，不绕过 TLS 或包管理器供给链校验。
- 并发 primary 仅新增另一个独立 IDEA，已普通 fast-forward 接入；
  `silvermoon check --worktree` 与 `git diff --check` 通过。

本轮保留并提交完整实施候选，但不记录 `submitInner` 或 `acceptInner`，
不将未验证的生产安装图或部署标准标为完成。`I-AC03` 与所有 `D-*` 继续未勾选。
恢复条件为 registry/TLS 与包管理器验证元数据正常后，完成独立生产安装图及剩余检查；
随后再同步准确的实施 revision，提交实施门限并进入部署验证。
