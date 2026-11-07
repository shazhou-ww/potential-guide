# 多 Gateway 真实部署证据

## 验证对象与隔离边界

本轮针对已同步的 `deploymentRevision=738ed3a6641b` 执行现实验证；
产品源码来自精确提交 `5b02ee0cd4c12d1cf0c0700171d8f4d8dbcba424`，
Git tree 为 `32a9643c39b0dafd5c45f1822c82b26d0742325f`。
本文件及 supporting evidence 的新增会正常改变外层修订；未修改已接受的实现、
理想世界、事件日志或部署契约，也没有记录提交、同步或生命周期接受。

仅从本工作树导出受跟踪源码，在本次自有 WSL Ubuntu 原生目录
`/home/lyweiwei/silvermoon-deploy-01M6TB-0bd1-20261107` 构建。
`source` 只承担作者构建；旁边的 `consumer` 通过实际 npm 安装精确 tarball，
不是源码或其 `node_modules` 后代。消费运行模块的 realpath 全部位于
`consumer/node_modules`。未加载源码 runtime 模块，没有把源码测试当作部署证据。

作者使用 Node **v24.14.1**、pnpm **11.22.0**，运行正常
`pnpm install --frozen-lockfile` 与 `pnpm build`。
消费者使用 Node **v24.14.1**、npm **11.11.0**，
`npm install --ignore-scripts --no-audit --no-fund` 和 `npm ls --all --json`
均退出 0。运行时 PATH 只指向自有 `runtime-bin`，其目录仅有 `node` 与 `npm`，
不存在 `ipfs` 或 `pnpm`；服务通过已安装 CLI 的 foreground 入口启动，
显式 `--no-global-config`，只监听 loopback，未调用 Kubo、导入、pin 或发布。
新 upstream 已移除的 `check-artifacts` 没有重新加入。

精确交付版本：

| 实际打包并安装的包 | 版本 |
| --- | --- |
| `@potential-guide/pguide-task-engine` | `0.1.0-rc.3` |
| `@potential-guide/task-engine` | `0.1.0-rc.1` |
| `@potential-guide/cli-core` | `0.3.0-rc.0` |
| `@potential-guide/task-engine-server` | `0.1.0-rc.2` |
| `@potential-guide/task-engine-webui` | `0.1.0-rc.1` |
| `@potential-guide/task-protocol` | `0.1.0-rc.1` |
| `@potential-guide/task-engine-http` | `0.1.0-rc.1` |
| `@potential-guide/task-engine-storage` | `0.1.0-rc.1` |

完整 tarball 文件清单、SHA-256、版本见
[tarballs.json](verification/results/tarballs.json)；
[package-lock.json](verification/results/package-lock.json) 保留 npm integrity 与精确解析；
[npm-graph.json](verification/results/npm-graph.json) 保留真实独立安装图。
锁文件中的 `file:` 地址指向已清理的自有 pack 目录；复现时应从同一源码提交重新
build/pack，并将这些本地路径映射到新自有目录，不能声称这些包已发布 npm。

## 真实 Pinboard、完整 DAG 与当前准入

本轮只读来源为用户指定的 `https://pinboard.shazhou.work`。
每一个 DAG 块都实际 GET `/ipfs/{cid}?format=raw`，发送 raw Accept，
断言 200、`application/vnd.ipld.raw`、SHA-256 与 CID multihash 相符；
再使用独立安装的 `createIpfsGatewayClient` 公共生产 API 读取并逐字节比较。
DAG-PB Links 全部递归，raw 叶停止展开，按 CID 去重，拒绝未知 codec。
依据这些实际验证块恢复全部文件，并以已安装公共 `readTaskBundle` 验证 exact binary
manifest；之后实际 Engine HTTP accepted 与完成运行再次证明准入。

| Check | 本轮精确根 CID | 完整块数 | 原始块字节合计 |
| --- | --- | --- | --- |
| tools | `bafybeifydrqggqypfapxiwt2bpovdprxae6iysrjhiua3d2jebico74u7a` | 17 | 38627 |
| directories | `bafybeicx45guntfoueeddml532gfayxuvo5jhujuf4q2wasnef4ysyrfhe` | 15 | 35644 |
| network | `bafybeibgc2yxmiynaq3m64ptpch6bi4ion7pqx5zh7tda6bfkxqx7ie7si` | 16 | 39441 |

三个声明均明确包含 `binary: []`，不是缺失 manifest。
逐块 CID、hash、链接、HTTP/MIME、文件清单、声明和准入结果全部保存在
[deployment.json](verification/results/deployment.json) 的 `dag`；
不能把根块探测或 pin 元数据代替这 **48 个根内块记录**的完整遍历。

自有只读 Node backup 仅供应以上实际从 Pinboard 下载并验证的块及实际空 identity 探针，
不生成、导入或上传 DAG。公共生产 client 在首源 503 后通过 backup 再次读取三个完整 DAG，
逐块 hash 与 Pinboard 记录相同；同一个 tools 根亦实际验证首源失败后从 live Pinboard 成功。
这是一项本次临时、调用者自有来源的验证，不声称存在第二个公共 Gateway。

WSL 最初继承的 `localhost:10808` 代理不可连接，直接 HTTP 替代也超时。
本次自有 Windows Node TLS transport relay 只允许连接
`registry.npmjs.org:443` 与 `pinboard.shazhou.work:443`，
经其实际 native HTTPS GET 两个来源均返回 200。只对子进程同时覆盖大小写 proxy
环境变量，并让 loopback 的服务与 backup 绕过 relay；未修改用户配置或 supply-chain policy。
relay 不提供 CID 内容，不算备用 Gateway，也不代替真实 Pinboard HTTP。

## 已安装服务的业务、物理回收、幂等与恢复

最终实际部署验证 **16 pass / 0 fail**。此前两个完整运行也各为 16/16，
分别保留在 [initial-run](verification/results/initial-run/deployment.json)、
[prelint-run](verification/results/prelint-run/deployment.json)；重复运行不扩大场景覆盖。
原始安装错误、helper 参数错误及一次复跑时自有目录 EEXIST 均显式记录，
不是业务成功或被吞掉的错误，见
[provenance.json](verification/results/provenance.json) 与 retained logs。
最终轮另保留 **121 条**本脚本实际 HTTP 原始响应；共享基础脚本的返回身份及
随后原始 Request/Task/Run 读取也纳入同一证据，不以测试名代替响应。

实际服务执行三个安全、只读 pass Check：

- tools：仅运行已知 Node 的 `--version`，要求最低 `22.13.0`；
- directories：仅检查本次自有目录的 `exists` 与 `read`，不做 write probe；
- network：仅请求本次自有 loopback 200 fixture，不依赖外部业务网络。

基础 tools pass 直接使用仓库既有共享
[verify-consumer.mjs](verification/results/verify-consumer.mjs)，没有重新实现其验证语义。
另补充三个真实业务 fail：Node 要求 `999.0.0`、自有目录下的缺失路径、
200 fixture 要求 201，分别返回 `tool-version`、`directory-unusable`、`http-status`。
六个 Task 都是 **completed**，业务 `pass:false` 不伪造成执行失败；
每个 result 文档 URI 都绑定其实际精确根 CID。

每个 Task/Run 通过公开 HTTP 记录完整 Request ID、Task ID、Run ID、bundle、
状态与结果。Run 必须同时具有 `exit.basis=worker`、`exit.code=0`、
`reclaimedAt`，且没有 `cleanupUnknown`，不是只看到 Task completed 就宣称物理退出。
同一 Request ID 和完全相同 JSON 正文重提六次，均返回原 accepted Task，
原 Run ID 不变；重提前后 `/runs` 全部 items 完全一致，没有多出 Run。

随后向实际 CLI 发送 SIGTERM，确认 exit 0、`closed` 及 HTTP 不再响应，
用 **同一个 SQLite 数据库**重新启动同一个 installed CLI。
六组 Request 原意图、Request status、Task、Run、Task history、Run history
均通过 HTTP 与重启前比较一致。只忽略明确的观察型字段
`timestamp`、`observedAt`、`nextCursor`、`expiresAt`；
身份、数据域、revision、业务数据、发生时间及历史 items 均保持原值。
完整 before/after 与 HTTP 原始响应见 `deployment.json` 的 `http` 和对应 `tests.value`。

## 现实故障与时间边界

所有故障只注入本次自有 loopback 来源，从不改变或干扰共享 Pinboard。
验证使用消费者独立安装的公共生产 API，不调用 repository test runner。

| 已验证场景 | 配置与明确断言 |
| --- | --- |
| 首源 503 → live Pinboard | 同一 tools 根成功且 hash 相同 |
| 首源 503 → 自有 backup | 三个根的完整 DAG 块均通过 hash 比较 |
| 首源伪造 raw → 有效 backup | CID 校验拒绝错误内容后成功，实际 backup 请求增加 |
| 全来源 503/404 | `GatewayReadError`，两个来源各有诊断；实测 **11.79 ms**，总预算 1200 ms，阈值 <2200 ms |
| 总预算耗尽 | stall，实测 **404.11 ms**；总预算 400 ms、单源 5000 ms，阈值 300–1400 ms |
| 调用者取消 | 80 ms abort，实测 **80.90 ms**；总预算 3000 ms，阈值 <1200 ms，保留原取消原因 |
| 真实 CLI 全失败 | HTTP Request rejected，`bundle_fetch_failed`，包含两个来源；实测 **45.57 ms**，阈值 <3500 ms |

总预算返回后额外观察 700 ms，取消返回后观察 1300 ms：
backup 请求计数均不增长，stall 请求也不再增加；已取消 signal 再读同根仍立即拒绝，
没有晚到备用/网络尝试。逐次实际耗时、阈值、错误对象、来源诊断、请求计数和原始
source request 时间线见 `deployment.json`，不把配置值当作测量值。

## 持久证据与清理

可复用脚本：
[pack-author.mjs](verification/pack-author.mjs)、
[deploy-consumer.mjs](verification/deploy-consumer.mjs)、
[network-relay.mjs](verification/network-relay.mjs)、
[collect-proof.mjs](verification/collect-proof.mjs)、
[verify-retained.mjs](verification/verify-retained.mjs)。
最终运行脚本、共享脚本、lockfile 及全部 raw 文件的 SHA-256 由
`provenance.json` 和 `deployment.json` 记录；不包含凭据或私有配置。
四个 supporting script 的定向 Biome lint 退出 0（仅 8 条模板风格 info），
格式检查通过；没有重跑或声称新增全仓实现验证。
清理审计脚本另通过既有 Biome stdin lint，输出与保留脚本规范化后相同；
使用 stdin 是因为工作树配置忽略 `.silvermoon`，没有放宽或修改仓库配置。

| 关键持久记录 | SHA-256 |
| --- | --- |
| `results/deployment.json` | `38fa586827e50aae96d846c46724528e83324e31e092e5ea1c3f12ce72e0b7b8` |
| `results/provenance.json` | `9343e46287120d7ab0a8360881f6f3a061c3850a42e663ee0e1398d7e03759e7` |
| `results/package-lock.json` | `564644f97fa0ec87fc95aaffcef5b49863154ccfa1d70eb4c3bf575a353d915d` |
| 实际运行 `deploy-consumer.mjs` | `3f0c943cfc5f7efd264058f23f3e8942d83027fc4c57aa46641af2a1f2389225` |

最终三个实际服务 CLI 均正常 exit 0，六个自有 HTTP server 全部关闭；
TLS relay 和本次原生作者/消费者/cache 目录在复制并校验持久证据后清理。
清理实际验证和关键 raw hash 见 [cleanup.json](verification/results/cleanup.json)。
取回文件的 36 个 provenance hash 全部重新校验；最终及前两轮共 9 个 CLI PID
均确认不存在，所有记录的自有 HTTP 端口和 relay 端口均确认不可连接，
自有原生目录与源码归档均确认已删除，没有遗留服务或 validation 目录。
仅更新本 Outer 证据及已证明的 D ledger 项，不进行 commit、push、事件或接受操作。

历史旧 CID 因缺少 exact binary manifest 的阻塞已经由用户交付的上述三个新根解决。
旧只读探测仍保留在 [pinboard-probe.json](verification/pinboard-probe.json)，
但不是本轮成功运行的 CID 或验收依据。

## 父 Agent 独立复核

父 Agent 审阅实际部署脚本、完整 DAG 准入、共享消费者调用、幂等、
同 DB 重启和故障断言，并独立读取最终原始 JSON 核对：

- 16 个场景逐项 `pass: true`，121 条原始 HTTP 响应，三个根各为 17/15/16 块；
  字节合计、raw MIME、200 状态和 `binary: []` 与交付身份一致。
- 六组重启前后快照的原始差异仅为 Task/Run 响应顶层的观察 `timestamp`；
  只移除这两个顶层字段后作完整 deep equality，Request、status、Task/Run
  数据和全部 history 完全一致，不依赖递归删除字段来掩盖变化。
- 逐项核对实测耗时小于明确上界，stall 达到下界，返回后备用读取计数未增加。
- 独立重跑 `verify-retained.mjs`，全部 36 个 provenance 文件 hash、一致的共享
  脚本与锁文件、9 个 CLI PID、HTTP/relay 端口和已清理原生目录的断言通过。
- 最终原始部署记录 SHA-256 仍为
  `38fa586827e50aae96d846c46724528e83324e31e092e5ea1c3f12ce72e0b7b8`；
  当前 Silvermoon worktree 检查及 whitespace 检查通过。

原始 build/lint 日志包含工具输出的末尾空白；为保留原始字节和 provenance hash，
不对这些 `.log` 文件格式化。暂存候选的 whitespace 检查只排除这些原始日志，
其余契约、脚本与 JSON 均检查；这不是跳过产品构建、测试或部署断言。

以上事实满足本轮 D-AC01、D-AC02、D-AC03。用户已明确委托父 Agent
负责实现和部署门限审批；仍须先同步本轮完整证据，按 fresh CLI 报告对准确外层
修订记录 submitOuter，再记录委托验收。证据和 ledger 本身不替代生命周期事件。
