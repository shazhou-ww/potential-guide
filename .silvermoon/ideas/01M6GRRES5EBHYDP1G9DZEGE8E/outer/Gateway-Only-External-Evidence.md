# Gateway-only 外部部署证据

## 契约与边界

本次验证使用已同步的 [Deployment.md](Deployment.md)，没有实质修改部署契约。
产品来源固定为 `741e77ef8d44413116cf0da7abfc2bb7a7aaf096`；
对应已验收 Inner 为 `153a2c2f6e563460e11894d2667dac2e3d0eba62`，验证开始时
Outer revision 为 `09abf9de18c2f3b5667cc115fcd6ad526506210c`。
历史 RPC/双 transport 证据保留，不把它们作为本次运行结果。

验证器为 [Gateway-Only-Verify.mjs](Gateway-Only-Verify.mjs)，机器结果为
[Gateway-Only-Results.json](Gateway-Only-Results.json)。只增加 Outer 辅助材料和
更新 D-* 执行清单，不修改 source、Inner、Ideal、events；不发布 npm、不 push、
不记录 Submit/Accept。部署材料的新增自身会形成新的 Outer revision，后续同步与审阅由父层负责。

## 方法

- 在仓库之外新建带 marker 的独占目录；两个生产安装分别为 runtime 和 author。
  本地 tarball 覆盖完整内部依赖闭包，执行 `verifyConsumerGraph(..., true)` 检查真实
  逐父依赖解析、版本及物理路径均不逃逸各自 consumer。runtime 不安装 SDK。
- 作者进程使用安装后的 SDK 标准 importer，将真实 CID/DAG 块写入本次独立块文件；
  不安装/启动 Kubo，不调用发布 RPC。移除 callback、资源源文件和 Bundle 目录后，
  独立 HTTP 子进程仅从块文件提供 raw-block 接口。
- 两入口使用相同 Bundle，经参数、YAML、JSON、隔离用户 JSONC、四层覆盖、
  禁用用户层等情形实际执行。每次服务使用新数据库；读取请求记录与真实 Task ID 对照，
  证明 CLI、文件和用户来源的数据库路径锚点，而非仅验证文件被创建。
- UI 通过公开 HTTP bootstrap/CSRF/binding 及 proxy 路径读取、提交并执行第二个 Task，
  不触碰 Engine 对象或 SQLite。其他情形不启动 UI。
- 成功启动场景不含 transport 或 RPC 参数/字段；旧字段只用于拒绝矩阵。独立源对 `/api/v0/version`
  的唯一主动探针返回 503；服务没有配置 RPC endpoint，没有可用的 owned RPC，
  也没有启动 Kubo 对照。不推断或探测父会话在其他端口的服务。
- 原用户配置仅计算前后指纹；项目配置、旧数据库使用 owned 夹具，比较前后字节指纹。
  不执行模块配置、不自动迁移用户文件、不接管或停止父会话的任何服务。

## 执行命令

环境为 Windows、Node.js `v24.11.1`、pnpm `11.22.0`。

```powershell
pnpm exec turbo run build --filter=@potential-guide/pguide-task-engine --filter=pguide --filter=@potential-guide/task-sdk
node --check .silvermoon\ideas\01M6GRRES5EBHYDP1G9DZEGE8E\outer\Gateway-Only-Verify.mjs
```

构建退出 0：25/25 tasks、25 cached；语法检查退出 0。
本次没有复现无对应源码的 `task-engine-server/dist/main.*` 残留（检查四个确切路径，
删除数为 0）；不因历史缓存问题清理其他产物或修改产品源码。
没有修改依赖 manifest，也没有安装仓库依赖；外部 consumer 的 manifest 为本次生成，
随后才在各自目录安装依赖。每个包的实际 pack/install 参数和退出码记录于 JSON 的 `commands`。

从新建 owned 外部目录执行：

```powershell
node <source>\.silvermoon\ideas\01M6GRRES5EBHYDP1G9DZEGE8E\outer\Gateway-Only-Verify.mjs <source> 741e77ef8d44413116cf0da7abfc2bb7a7aaf096
```

`<source>` 是固定在上述提交的产品工作树，所有实际消费、构建夹具、运行数据和安装均在
外部 owned 目录；提交的结果只用 `<source>`、`<owned-root>`、`<node>` 等占位符，
不保存个人绝对路径、用户内容或凭据。
后续复核可从包含本验证器的 evidence checkout 执行脚本，传入的产品目录仍指向固定在
`741e77ef8d44413116cf0da7abfc2bb7a7aaf096` 的产品 checkout；验证器会拒绝不同的产品 HEAD。

### 验证器重试

第一次独立环境已成功打包/安装并生成 7 块标准 Bundle，但在首个场景的 child
`close`/IPC 清理观察处超时，0 个完整场景，不作为部署成功证据。
修正验证器为既有 prior art 的进程 `exit` 观察、明确断开 IPC，并保留原始失败上下文；
没有修改产品实现。已确认第一次 raw-source PID 不再存在，按 marker 清理整个首次 owned
目录后，在另一个全新外部目录重新打包/安装执行，未沿用半成品服务或数据库。

## 本次实际结果

第二次完整外部命令退出 0，`errors` 为空：

| 证明 | 实际结果 |
| --- | --- |
| 本地产物与生产消费图 | 22 个内部 tarball；runtime 21 个内部包、406 个生产包，author 5 个内部包、142 个生产包；两图的全部物理路径均在各自 consumer 内 |
| 已安装设置与发现 | 两入口 help、发现 metadata、已安装 settings 均检查；无退役 option/setting/default，无默认 Gateway URL |
| 成功服务场景 | 14 个（每入口 7 个），完成 16 个 Task（含每入口各 1 个 UI proxy 提交） |
| 配置拒绝 | 36 个（每入口 18 个）；均非零退出、无 ready；其中 34 个验证无指定数据库/监听及用户文件不变，另 2 个验证旧模块没有执行 |
| 内容拒绝 | 6 个（每入口 CID 错块、chunked 超限、不可达各 1 个），无成功 Task、无 RPC 回退 |
| 生命周期回滚 | 2 个；UI 端口占用时只回滚本次 Engine，原独立源监听继续响应 |
| 正常退出 | 20 次内容/成功服务实例均 `closed`、退出 0，Engine/UI 监听关闭，独立源仍活 |

包内发现与 help 的检查针对 options、defaults 和 setting IDs；迁移说明中保留
RPC/transport 字样是刻意的提示，不是仍提供这些选项。JSON 的命令退出码分布为
28 个 0、37 个 1、1 个 2；后两类正是预期的 36 个配置拒绝和 2 个启动失败，
不是忽略失败。长驻服务的完整 HTTP/退出结果另记于各场景。

### 标准 Bundle、raw HTTP 与精确结果

- CID：`bafybeid464aluaavxpmdz3vpmf6csh3iw4wnyl3oznx3ah5i4aswdsnvqe`；
  标准 importer 生成 7 块，内存 root pin 成功。作者源与 Bundle 目录在 runtime 启动前删除。
- 每个成功 Task 的完整结果严格相等：
  `{"message":"gateway-only-external-proof","resourceBytes":600000,"resourceSum":25200000}`。
- 独立 HTTP 源记录 102 次 raw 请求，均为 `GET`、
  `Accept: application/vnd.ipld.raw`、无凭据；覆盖全部 7 个真实 CID 块。
  成功源返回 raw MIME；错误块被 CID 校验拒绝为 `bundle_fetch_failed`。
- 两次无 Content-Length 的超限响应各写出 **2,129,920 bytes** 后被提前关闭，
  小于原定 3 MiB，明确返回 `capacity_exceeded`。不可达返回 `bundle_fetch_failed`。
- `/api/v0/version` 仅有验证器主动的 1 次 503 探针；所有服务带来的 RPC 请求增量为 **0**。
  这里的“未安装 Kubo”指 Kubo 可执行程序/daemon，不是删除保留的作者 RPC client 库依赖。
  本次证明 Gateway-only 运行，不重复历史真实 Kubo 发布对照，也不替代已验收 Inner 的作者回归。

### 配置、数据库与 HTTP 边界

每入口 7 个成功场景依次覆盖：纯 CLI Engine-only、YAML、JSON、隔离用户 JSONC
（注释/尾逗号）、四层覆盖及 UI、禁用损坏用户文件、禁用带退役字段及非法发现设置的用户文件。
Gateway URL 只能来自显式启用来源；四层覆盖中被覆盖的两个错误 Gateway 路径从未收到请求。
项目服务配置被排除；用户数据库仍锚定用户文件目录，文件数据库锚定配置目录，
CLI 数据库锚定 `--cwd`。14 个正常场景均在关闭服务后只读查询 `requests`，
将 request ID 与实际完成的 Task ID 对照。

每入口 18 个配置拒绝包括：user/file 的旧 RPC URL（字符串、false）、
旧 transport（rpc、gateway、null），即使合法 CLI Gateway 覆盖仍给出迁移拒绝；
两个旧 CLI flags；缺 URL；启用的损坏用户文件；被覆盖的非法 user/file Gateway；
未知服务键；拒绝且不执行旧 `.mjs`。前 34 个新数据库/监听副作用检查均通过，
没有自动改写用户文件。真实用户文件、owned 项目文件和旧数据库指纹全部不变；
项目指定数据库及隐藏默认 `tasks.sqlite` 均不存在。

两个 UI 场景分别通过公开 HTML/assets、bootstrap、CSRF/binding、HTTP proxy 读取与提交执行；
Engine-only 场景没有 UI。所有服务场景都检查跨源 Origin、cross-site 和 hostile Host 为 403，
UI 还拒绝跨源访问，不通过私有 Engine 对象完成 UI 证明。

### 清理与可复核边界

Windows 下仅对本次 owned PID 使用随机 named pipe + preload，将停止通知转换为该
Node 进程的 `SIGTERM` event；不是 OS 原生 POSIX signal 的证明。退出仍必须走产品
优雅关闭路径、发出 `closed`、退出 0 并使 HTTP 不可达。没有停止既有服务。
独立源最后通过自己的 IPC close 优雅退出，其 HTTP 随后不可达。

运行结果为：`forcedOwnedPids=[]`、`trackedChildrenRemaining=0`、
`signalControllerClosed=true`、`rawSourceGracefulExit=true`。复制脱敏结果后，
逐一确认所记录 owned PID 已不存在，核对 marker 的 purpose 和精确 sourceCommit，
删除整个本次外部目录并验证不存在；JSON 的最终四个清理字段由这一步实际确认后补记，
不是运行器内部尚待执行的断言。首次失败目录也已按 marker 清理。

本次未重跑完整 `pnpm check`，不宣称它通过；其 Inner 已记录的责任分类基线问题
不被本次外部验证覆盖。构建仅为前述 25 个 cached tasks，外部消费、安装和 58 个
正/负部署用例均为本次全新实际执行。本 Idea 的产品实现、Inner、Ideal、events 和 Deployment.md
保持原样；父层仍需独立审阅、同步并记录后续生命周期决定。

提交前检查时，另一个会话已推进 `origin/main` 到
`dbd1bb337a98040b1a8507a50985668005a66675`，新增另一 Idea 及无关仓库检查修复，
导致本地旧 HEAD 的 history check 报“removing an integrated idea”。
执行 `git merge --no-edit origin/main` 普通 fast-forward 保留这些并发提交后，
`silvermoon check --worktree --audience agent` 恢复退出 0。本次没有自行编辑并发内容，
也没有重写历史；上述外部证据仍严格对应运行时的 `741e77ef...`，不冒称验证了新 tip。
检查期间该并发 Idea 又追加提交事件；同样普通 fast-forward 保留到
`c0e6edb17cb851f3feb371d26eb54a7bf44ae3d1`，没有删除或改写其事件。

最终候选仅包含本证据、验证器、结果 JSON 与 ledger 的 D-* 勾选。
`node --check`、结果 JSON 的计数/脱敏/清理断言、`git diff --cached --check` 均退出 0；
`silvermoon check --worktree --audience agent` 和
`silvermoon check --staged --audience agent` 均退出 0。检查日志只是本次 scratch，
不作为额外部署契约或提交附件。
