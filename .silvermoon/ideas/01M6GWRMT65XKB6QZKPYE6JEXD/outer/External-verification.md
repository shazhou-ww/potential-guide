# 仓库外实际验证

## 契约与执行范围

依据已同步的 Deployment `8cdffd1028b4`，在 source commit
`e9b2985ca1e90bb010aca73ea062516bb82d2bcf` 上执行。
准确 accepted Inner 为 `282fc60f2e22da55ae4e2775e4c62567d641fcb7`。
本次只新增 Outer 验证驱动、证据及 ledger 执行事实；
没有修改 Inner、Ideal、实现或 `events.jsonl`，没有 commit/push、
submit、accept、waive 或 npm publish。父代理保留生命周期门限。

成功执行时间：2026-11-04 00:31:02～00:31:36（UTC+08:00）。
完整结构化事实见 [external-result.json](external-result.json)，
驱动前几次失败见 [external-attempts.json](external-attempts.json)，
可审查驱动见 [verify-external.mjs](verify-external.mjs)。
后者是本世界的外部验证工具，不是对 accepted Inner 的实现补丁。

## 环境与独立安装

本次获授权的外部资源根目录：

```text
C:\Users\leescott.REDMOND\.copilot\session-state\77764d4e-4801-4372-b19f-cf93d7af2ebb\files\bundle-deployment
```

最终 `consumer` 是本次新建、重建后 fresh 安装的目录；没有把仓库内
`.cache\potential-guide-packs-uObLIg` 的已安装 consumer 冒充外部环境。
从该 pack 树复制 **18 个本地 tgz** 到外部 `consumer\tarballs`，
逐一保存包名、候选版本、长度与 SHA256；全部身份见 machine evidence 的 `packages`。
不同尝试使用完全相同的这 18 份 tarball。候选身份以字节哈希为准，
不是声称 npm 上同名版本已发行。

- `consumer\author` fresh 安装 `pguide`、
  `@potential-guide/pguide-task-bundle` 与 TypeBox 0.34.52。
- `consumer\host` fresh 安装仅以 `@potential-guide/task-engine`、
  `@potential-guide/ipfs-content` 为直接依赖的运行闭包；内部依赖另有
  task-protocol、check-artifacts、check-runtime-files。完整外部依赖图也已保存，
  不宣称该既有闭包完全没有构建相关传递依赖。
- 安装使用本地 file-URI overrides、`--prod --prefer-offline --ignore-scripts
  --no-frozen-lockfile`。可执行 pnpm 实际为 **12.16.1**；不是默认 PowerShell
  包装器所选的 11.22。外部项目没有修改仓库 workspace/lockfile 或全局设置。
- 驱动 Node 为 24.11.1；真正的作者 executable shim 与 Engine host 均使用
  父代理已校验的 **Node 22.13.0**，PATH 优先放置该运行时，`node --version`
  与 host `process.version` 均已实测。
- APPDATA/XDG_CONFIG_HOME、最近项目的空 `.pguide\config.jsonc` 都是本次独立域，
  清空 NODE_PATH/NODE_OPTIONS；没有读取或写入用户的既有 pguide 配置。

## D-S01 / D-AC01：离线作者流程

本次 Kubo 尚未启动、没有配置 IPFS RPC 时，在外部目录先完成以下操作：

1. 直接运行真实 `pguide-task-bundle` shim 的 discovery metadata，
   再以 `pguide task-bundle --help --format json` 实际发现扩展。
   子命令严格为 check/build/publish。
2. 在 `author\project-one` 以 TypeBox contract、纯类型导入的 callback、
   `task.build.yaml` 和 assets 为输入；不维护顶层 `task.yaml`，
   不执行 include 更新命令。author check 成功且不写 dist。
3. 交替使用独立 binary 和 pguide dispatch 构建、重建；
   在不同作者根 `author\project-two` 构建相同输入，
   核对整个成品逐文件字节哈希与 CID 一致。
4. 添加 `assets\added.txt` 后清单/CID 改变；再删除 obsolete 资源后 clean 重建，
   精确清单及 dist 都无旧资源残留；最终重复构建 CID 保持一致。

| 阶段 | 实际 CID |
| --- | --- |
| 初始、重复及不同作者根 | `bafybeiggjfqfibbhutgpfor7wgz5uts7rnhjrjsrrqh5ztkc6ud2yp2mse` |
| 新增资源后 | `bafybeifadjq6ulac3wm3ohqr6lg5rudcjgg3l5awlyjbb7ly3dwxmzxege` |
| 删除旧资源、最终重复构建及发布 | `bafybeiegec2kv74zwrpec75sxmgtfxzz7zbw3eyhy5dmpmpfkcoxukwcsu` |

最终精确清单为：

```text
resources/added.txt
resources/keep.txt
schemas/0.json
schemas/1.json
schemas/2.json
task.yaml
worker.cjs
```

这是“无需连接 IPFS 的构建”证明，不是对任意恶意作者代码的网络沙箱承诺。
父代理原先仅验证最低版本消费的边界已在本次扩展为：
**Node22.13 的作者 check/build 与实际消费均已运行**；
不回写已接受的 Inner 记录。

## D-S02 / D-AC02：真实 Kubo 发布与仅凭 CID 消费

### 自有节点

使用父代理提供的官方 **Kubo 0.43.1**、新建的 `kubo-data` 数据域，
每次 daemon/控制命令都显式传入该 IPFS_PATH。
启动前核对 loopback tcp/0 API/Gateway、AutoConf=false、MDNS=false、
无 bootstrap；配置实际将空 bootstrap 序列化为 `null`。
`daemon --offline` 输出 `Swarm not listening` 和 `Daemon is ready` 后，
才读取实际 API 地址并用 RPC version 确认就绪。

- 最终 daemon PID：`43860`。
- RPC：`http://127.0.0.1:54120`；Gateway：`127.0.0.1:54121`。
- 官方 archive SHA512 为
  `E611CECEF25CDDB10B7F907145383608D9B31219AD7120041AEACFE2313882DA1944F2897FDA29BC2D959DD357E4950089EC8F2CBD52B29F2FC472BCAE4356D0`，
  本代理重新计算 `kubo.zip` 并与父代理保留的官方 checksum 一致。
- 此 checksum 对应发行 zip，**不是**解包后的 exe。实际 exe SHA512 为
  `ACA8F352EA3B5013ED8CB6EC1A5AEAE2D02E34E7FC8341AFB48D85DA8E1A31738C979735781EAF3DB43BDA379821999BA4A7EF6BE103811FA919EE275E072A73`，
  两者分别保存在证据中，没有把不同对象的哈希误记为相符。

没有运行 Docker、接管已有节点或端口，也没有联网 swarm、公网传播或持久多副本验证。

### 仅从成品发布

最终 dist 复制至 `consumer\publication\artifact`，该发布目标只含上述七个成品文件，
没有作者源码、构建描述、TypeBox 模块或 ownership marker。
原作者的 main/build 文件已删除，contract 改成求值必抛错，
再从 publication cwd 用独立 executable 执行：

```text
pguide-task-bundle publish <publication\artifact> --ipfs-rpc http://127.0.0.1:54120 --format json
```

发布成功返回最终 CID，与离线 build/check 相同；真实 Kubo recursive pin 包含该 CID。
发布前后本地七个文件的长度/SHA256 完全相同，
再以真实 Kubo `cat <CID>/<path>` 读取全部七个文件，逐一核对相同长度/SHA256。
`artifactBefore`、`artifactAfter`、`kuboFiles` 保存了全部比较值。

分别复制出缺失 keep.txt 和额外 extra.txt 的坏成品，实际 publish 都以非零退出拒绝。
两次拒绝前后 Kubo block count 保持 **11**，recursive pins 不变。
不是使用 MemoryIpfsClient 或 HTTP fixture 模拟上述结果。

### 独立 Engine 执行

发布进程完成后才启动 `host\consume.mjs`；发布没有 Task API 配置，
任务由另一进程里的测试调用方提交 CID，而不是由 publish 顺带执行。

宿主 fresh 安装图没有作者 CLI、TypeBox、task-sdk 或 pguide，
且实际动态 import 它们均返回 `ERR_MODULE_NOT_FOUND`。
宿主只接收 CID 与 Kubo RPC，从真实 Kubo 获取块，
由 Engine 启动成品中的真实 Worker，读取成品 resource：

- Task：`01M6H40XMQFP3QJTJQPNFWB9FN`。
- Run：`01M6H40XNX2KRZEBPF9BGPJ9SM`。
- 结果：`{"echo":"outer actual","resource":"offline-resource\n"}`，stage=`completed`。
- 物理回收确认：`2026-11-03T16:31:36.383Z`；随后 engine.close 完成，host 子进程退出 0。

宿主使用 disposable MemoryStore 保存事实，不是模拟 IPFS；
内容输入始终是本次真实 Kubo RPC。此次验证不承诺该临时事实存储具备持久恢复能力。

### 资源退出

Engine close 后 recursive pin 仍存在，证明发布方 pin 不由 Engine 接管。
验证完毕再由发布方显式移除本次新增的准确 CID pin，随后用本次 IPFS_PATH
执行 `ipfs shutdown`。最终 daemon 正常退出 0，RPC 不再可连接，
另以精确 PID 43860 查询确认进程已不存在。
前一次驱动失败时启动的 PID 37008 也已正常退出 0、RPC 停止，
在下一次启动前确认没有残留。

保留自有的 external consumer、候选 tarballs、成品副本、节点数据及日志供父代理审查；
这些不是仍在运行的服务。没有更改任何既有节点的 pin、配置或数据目录。

## 命令与失败记录

成功驱动及全部实际子命令的参数、cwd、退出码、stdout/stderr
见 `external-result.json.commands`。实际入口为：

```powershell
$outer=".silvermoon\ideas\01M6GWRMT65XKB6QZKPYE6JEXD\outer"
$base="C:\Users\leescott.REDMOND\.copilot\session-state\77764d4e-4801-4372-b19f-cf93d7af2ebb\files\bundle-deployment"
node "$outer\verify-external.mjs" --base $base --packs "$PWD\.cache\potential-guide-packs-uObLIg" --pnpm (Get-Command pnpm.exe).Source --node "$base\node-v22.13.0-win-x64\node.exe" --evidence "$PWD\$outer\external-result.json"
```

驱动拒绝覆盖已存在的 consumer；重放时父代理须使用另一个同样受控、完整准备好的新域，
而不是删除本次证据或借用用户现有工作目录。首次三次均是验证驱动自身的问题：

| 尝试 | 失败与处理 |
| --- | --- |
| 1 | CJS createRequire 以 pnpm symlink 的表面路径解析 cross-spawn 失败；改为先 realpath。daemon 尚未启动。 |
| 2 | 驱动把 Kubo 空 bootstrap 假设为 `[]`，实际为 `null`；按“没有 bootstrap 地址”验证两者。作者离线流程此前已通过，daemon 尚未启动。 |
| 3 | CJS require.resolve 无法解析只有 ESM import 条件的 IPFS 公共入口；改用宿主中的 ESM reexport 正常加载。该次自有 daemon 已正常 shutdown，未发布或提交任务。 |
| 最终 | fresh 重装后全流程退出 0，所有验收断言通过，`failures=[]`。 |

清理第一次的自有安装树时，Windows PowerShell Remove-Item 遇到长路径/ENOENT，
随后改用 Node fs.rm 成功清理准确的自有 consumer，再 fresh 安装；
没有扩大清理到父代理的其他树、运行时或数据域。
以上都不是发现并修改 accepted Inner 的产品缺陷。

## 仓库检查限制

本阶段没有重跑高负载全套，以免加重共享环境内存压力。
父代理报告：集成后的 build/layers/format/lint/typecheck 通过，
全套 test 遇 esbuild 明确 `cannot allocate memory` fatal；
随后 bounded SDK+作者+task-engine-service、concurrency=1 的 17/17 通过。
父代理另实跑 real-repository inventory，仍只返回既有技能分类
`.agent/skills/component-responsibility-docs/SKILL.md` 的 `unverified`，
没有 ENOENT 或 delivery/inventory 竞态，日志 `.cache\parent-final-inventory.log`。
这些是父代理提供的仓库卫生/环境事实，不是本次外部发布失败，
也不能将其改写成整条 `pnpm check` 或 CI 全绿。

本次本地 Outer 驱动通过；未触发远端 CI 或 npm 发行。
本轮 `node --check verify-external.mjs` 与 `git diff --check` 通过。
最终 `silvermoon check --worktree --audience agent` 退出 1，
报告同级服务 Idea `01M6GRRES5EBHYDP1G9DZEGE8E` 的
`idea.events.history-invalid: not-append-only (append)`；
日志 `.cache\task-bundle-validation\outer-silvermoon.log`。
这不推翻本次真实外部执行结果，但当前候选不能冒称生命周期快照检查已通过。
父代理须正常整合 primary/同级事件历史后重跑；本代理未改事件或自行同步。
父代理仍需审查、同步本 Outer 证据并对准确 revision 执行其提交/门限流程。

## 父代理独立复核与门限决定

父代理已正常 fast-forward 整合同级服务的外部证据和生命周期事件到
`05c97fca`，没有重写任何事件；随后 `silvermoon check --worktree
--audience agent` 已退出 0，消除上述未整合同级事件的快照阻塞。
accepted Inner tree 仍精确为 `282fc60f2e22da55ae4e2775e4c62567d641fcb7`。

父代理另行实际执行独立断言，全部通过：

- 18 份外部 tarball 的长度/SHA256 同时匹配结构化记录与原始 pack 文件。
- 使用 SDK 成品检查重新计算现存外部成品的 UnixFS CID，与发布和宿主消费相同。
- 七个现存成品文件逐一重新读取并核验长度/SHA256；
  发布前、发布后、Kubo 实际 cat 三组记录一致。
- 成功状态、空 failures、缺失/额外文件拒绝、宿主结果与物理回收、pin 所有权、
  发布方清理和 daemon 退出记录一致；再次访问准确 RPC 失败，精确 PID
  43860/37008 均已不存在。
- Outer 驱动的真实 RPC、独立 import 拒绝、Worker 执行及清理断言经直接审阅；
  没有用内存内容节点替代 Kubo，也没有改变 accepted 实现。

基于用户授予的门限审批权限，父代理决定按上述证据接受本轮外部结果；
准确接受仍需在这些证据同步 primary 后，由匹配 revision 的 submitOuter/
acceptOuter 事件记录。此决定不宣称整条 `pnpm check` 或远端 CI 全绿，
不授权 npm 发布或公网可达性承诺。
