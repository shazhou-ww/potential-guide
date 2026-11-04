# Gateway-only 外部部署证据

## 当前刷新：重新验收 Inner 后的同步版本

本轮固定产品来源为 `09f93e45cf63fbe1db9d8e8da7bbf20a4411bcfc`，
已验收 Inner 为 `e766edd27d16c247d8ff059021ecb8a08f03c9d9`；
起始 Outer revision 为 `92fbaf5f3f074fefd8474cb8046510a07f625f80`，
起始 events digest 为 `16e3581d5d9be1c793a9636579524513f64fb887`。
[Deployment.md](Deployment.md) 未改，blob 仍为
`cda9ee9c25fee9cdff5233ad722f3acfdebab80d`。

本轮验证器为 [Gateway-Only-Verify.mjs](Gateway-Only-Verify.mjs)，当前机器结果为
[Gateway-Only-Results.json](Gateway-Only-Results.json)。验证器从指定产品 HEAD
读取 Outer/Inner revision，不再沿用第一次运行的硬编码 Outer 值。
服务 runtime 源码、manifest、settings 相对 `741e77ef...` 没有变化；
变化是服务包测试依赖的 owner metadata/README，以及其他 Idea/monorepo 检查。
仍在全新仓库外 owned 目录重新 pack、安装并执行完整既有矩阵，不重标旧 JSON。
无需重复 build 或完整 `pnpm check`；后者在新 Inner 已准确记录剩余两条
先于本任务的 `6471f793` owner 遗漏，本轮不扩大范围或宣称全库全绿。

执行前仅检查四个确切 `task-engine-server/dist/main.*` 退役路径；只有存在且
确认无对应源码时才删除。不改产品源码、Inner、Ideal、events 或部署契约。

```powershell
node --check .silvermoon\ideas\01M6GRRES5EBHYDP1G9DZEGE8E\outer\Gateway-Only-Verify.mjs
# 在全新仓库外 owned 目录执行：
node <source>\.silvermoon\ideas\01M6GRRES5EBHYDP1G9DZEGE8E\outer\Gateway-Only-Verify.mjs <source> 09f93e45cf63fbe1db9d8e8da7bbf20a4411bcfc
```

### 本轮实际输出与边界

语法检查和完整外部命令均退出 **0**，没有本轮重试；退役 `dist/main.*` 四个确切
路径的实际存在数为 **0**，没有清理任何构建产物，也没有 build 或安装仓库依赖。
本轮仍是 Windows、Node `v24.11.1`、pnpm `11.22.0`；生成两个 consumer manifest 后，
仅在全新的 runtime/author 目录安装本地 tarball 与生产依赖。所有具体 pack/install
参数、退出码和生产版本位于新 JSON 的 `commands` / `graphs`，不是旧运行复制。

| 当前同步来源的证明 | 本轮实际结果 |
| --- | --- |
| 新打包/安装与独立消费图 | 22 个内部 tarball；runtime 21 个内部包/406 个生产包，author 5 个内部包/142 个生产包；物理路径均在各自 consumer，runtime 无 SDK |
| 成功服务配置 | 14 个（两入口各 7）；参数、YAML、JSON、隔离用户 JSONC、四层覆盖/UI、禁用损坏用户、禁用旧字段及非法发现设置 |
| 实际完成 Task | 16 个；包含两入口各 1 个 UI HTTP proxy 提交；14 个正常场景关闭后均只读核对数据库 request/Task ID |
| 配置拒绝 | 36 个；34 个检查无 ready/指定 DB/监听及用户文件不变，另 2 个旧模块拒绝且不执行 |
| 内容拒绝 | 6 个；两入口各验证 CID 错块、无 Content-Length 超限流、不可达，无成功 Task/无回退 |
| 占用 UI 端口回滚 | 2 个；仅回滚本次 Engine，不接管独立源监听 |
| 本机 HTTP/UI | 20 个服务场景的 Origin、cross-site、hostile Host 拒绝保持；UI assets/bootstrap/CSRF/binding/proxy 经公开 HTTP 验证 |

本轮 Bundle 仍为标准 importer 的 7 个真实 CID/DAG 块，root pin 成功；
CID 为 `bafybeid464aluaavxpmdz3vpmf6csh3iw4wnyl3oznx3ah5i4aswdsnvqe`。
作者 callback、600,000-byte 资源源文件和 Bundle 目录在服务启动前删除。
全部成功 Task 严格返回
`{"message":"gateway-only-external-proof","resourceBytes":600000,"resourceSum":25200000}`。
这些相同值是本轮重新构建、读取和执行得到，不是因 metadata-only 而沿用旧结果。

独立源实际记录 **102** 次 raw `GET`，全部
`Accept: application/vnd.ipld.raw`、无凭据；覆盖全部真实块。
两次超限流各写出 **2,129,920 bytes** 后被提前关闭，返回 `capacity_exceeded`；
错误块和不可达均明确 `bundle_fetch_failed`。唯一本次主动 RPC 路由探针仍为 503，
计数 **1**，因此服务 RPC 增量为 **0**。不安装/启动 Kubo executable/daemon，
成功服务输入没有 transport/RPC 字段或 flags；退役输入仅在负向矩阵中出现。
已安装 help/settings 再次确认无退役 option/setting/default、无默认 Gateway。
迁移提示字样和保留的作者库依赖不等于提供运行端 RPC 支持。

两入口对 user/file 中旧 RPC URL（字符串、false）及 transport（rpc、gateway、null）
即使有合法 Gateway override 仍拒绝；旧 flags、缺 URL、启用损坏用户层、被覆盖的
非法 Gateway、未知服务键也拒绝。禁用损坏/旧用户层可以成功。
CLI/文件/用户数据库来源路径、项目服务值排除及低层 DB 锚点均实证；
真实用户文件、owned 项目文件和旧 DB 指纹不变，项目 DB 和默认 `tasks.sqlite` 不存在。
无自动配置迁移，不探测或接管父会话在其他端口的服务。

20 个正常/内容拒绝服务实例均 `closed`、退出 0，Engine/UI HTTP 关闭后不可达且
独立源仍活；最后独立源自己的 IPC close 退出 0，HTTP 不可达。
Windows 停止仍仅用本次 owned PID 的随机 named-pipe preload 触发产品 `SIGTERM`
event 路径，不冒称验证 OS 原生 POSIX signal。
运行器结果 `errors=[]`、`forcedOwnedPids=[]`、`trackedChildrenRemaining=0`、
`signalControllerClosed=true`、`rawSourceGracefulExit=true`。

复制新结果后，最终再确认所记录 PID 均不存在，核对 marker 的 purpose 和精确
`09f93e45...` sourceCommit，删除整个本轮 owned 外部目录并验证不存在，
才将 JSON 的最终四个清理字段补为已确认。首次额外 PID 检查曾暂缓删除；
没有对任何仍存在的 PID 发终止信号，再次只读检查全部记录 PID 已不存在后才继续。
没有把这个清理前检查重算成部署重试或推断成产品失败。
仅在上述实际验证与清理完成后重新勾选 D-*；source、Inner、Ideal、events、
Deployment.md 和历史 `741e77ef...` Git 证据均未改写，不 push 或记录生命周期事件。
最终语法检查、新 JSON 的 provenance/矩阵/精确结果/脱敏/清理断言及
`git diff --cached --check` 均退出 0；本轮
`silvermoon check --worktree --audience agent` / `silvermoon check --staged --audience agent`
均退出 0，仅暂存本 Idea 的四个 Outer/ledger 文件。

## 历史运行：741e77ef，不是本轮结果

下方原始记录中的“本次”等字样仅指此前 `741e77ef...` 运行。
其原始 JSON、验证器和证据保存在提交 `47a75462aab35afb2732b4a92ff11b155cc5dcd4`，
并已由父层独立断言通过；当前 JSON 已由新运行实际输出替换，而非修改旧结果的 sourceCommit。

## 契约与边界

本次验证使用已同步的 [Deployment.md](Deployment.md)，没有实质修改部署契约。
产品来源固定为 `741e77ef8d44413116cf0da7abfc2bb7a7aaf096`；
对应已验收 Inner 为 `153a2c2f6e563460e11894d2667dac2e3d0eba62`，验证开始时
Outer revision 为 `09abf9de18c2f3b5667cc115fcd6ad526506210c`。
历史 RPC/双 transport 证据保留，不把它们作为本次运行结果。

历史验证器为 [Gateway-Only-Verify.mjs](https://github.com/shazhou-ww/potential-guide/blob/47a75462aab35afb2732b4a92ff11b155cc5dcd4/.silvermoon/ideas/01M6GRRES5EBHYDP1G9DZEGE8E/outer/Gateway-Only-Verify.mjs)，机器结果为
[Gateway-Only-Results.json](https://github.com/shazhou-ww/potential-guide/blob/47a75462aab35afb2732b4a92ff11b155cc5dcd4/.silvermoon/ideas/01M6GRRES5EBHYDP1G9DZEGE8E/outer/Gateway-Only-Results.json)。只增加 Outer 辅助材料和
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
