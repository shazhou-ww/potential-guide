# Gateway 外部验证证据

## 契约与消费来源

本次按已同步的 [Deployment](Deployment.md) 执行 D-S01、D-S02、D-AC01、D-AC02，
未修改部署要求、源码 deliverable、Inner、Ideal 或 events，也未提交门限事件或 push。
原 [RPC 证据](Evidence.md)、Results.json 和 Verify.mjs 保留为历史，没有覆盖。

- 消费源码提交：`9648e2094b296b7f559c79c6ac994e19277300ea`。
- 已接受 implementation revision：`095469bdb16c88c15f92b7b0b71282339da4d5ec`。
- 执行前已同步 deployment revision：`681ac1346b428796ba00a26acf0c0b21656bed2c`。
- Deployment.md Git blob：`4a05b865cfeaf1e5380b97044a1f3d453882a15d`，本次保持不变。
- 开始观测的事件 digest：`9a0abf35782ba9f6d57a09eb10797db47a76494a`。
- Windows，Node `v24.11.1`，pnpm `11.22.0`；未发布 npm。

逐条命令及退出码、安装图、HTTP 请求、实际监听、Task 身份与清理结果见
[Gateway-Results.json](Gateway-Results.json)；可复现脚本为
[Gateway-Verify.mjs](Gateway-Verify.mjs)。
`<source>`、`<owned-root>`、`<node>`、`<user-home>` 是脱敏占位符；
不保存真实用户配置内容/摘要、个人路径或 Kubo 私钥。

## 仓库外安装与独立内容源

因主线集成 `ecb55bd2` 的 Bundle loader/protocol/SDK 修改，本次固定在
`9648e209` 重新构建、打包和执行完整矩阵，不继续追逐其他并发主线。
使用一个全新、带 owner marker 的仓库外目录，单次完整执行成功并已清理。
**先前 `843e8ecb` 的成功实测已被本次集成实测整体替代**，不是只重标 sourceCommit。
旧执行和其最初 harness SQL 断言问题仅作为 `Gateway-Results.json` 的
`supersedes` 历史保存，不作为当前 HEAD 的证明；旧文件版本仍可在
`af6661c83271fea2e3befb6e39603f9a934e506c` 查看。

`pnpm build` 成功，37/37 workspace；从该提交本地产物打包 **22** 个内部包。
分别写入新的消费 manifest 与本地 tarball overrides 后执行
`pnpm install --prod --prefer-offline --ignore-scripts --no-frozen-lockfile --reporter=append-only`：

| 外部环境 | 显式依赖 | 内部包 / production 物理包节点 |
| --- | --- | --- |
| runtime | `pguide`、`@potential-guide/pguide-task-engine` | 21 / 406 |
| author | `@potential-guide/task-sdk`、`@potential-guide/ipfs-content` | 5 / 142 |

通过仓库既有 `verifyConsumerGraph(..., true)` 从每个实际父包递归校验
dependency/peer/optional 版本和物理路径；全部留在各自外部 consumer 内，
无 `workspace:` range、源码路径回退或 runtime 的 SDK 依赖。
图验证辅助代码来自源码，但所有实际命令、作者构建与服务运行均消费已安装 tarball。
独立 `.bin\pguide-task-engine.cmd` metadata 及 `.bin\pguide.cmd task-engine --help` 成功；
发现链实际调用安装后的扩展 binary，而不是第二套路由器。

安装后的 SDK 构建同一非敏感标准 UnixFS Bundle（**7** 个唯一块），含 600,000 字节资源；
作者用标准 importer 将实际块保存为外部内容源的只读数据，不向服务注入内存 client。
本轮 harness 限定 sourceCommit，并额外断言 SDK 输出 clean YAML 而非 JSON、
声明没有私有 `resolved` 元数据，仍为七块资源 fixture；未改源码或 Inner。

```text
bafybeiaybqzipbsrydabmstgkfwk6msd42n6xbin6bfjpeaorslxjkcmnu
```

raw-block 源为独立 Node 进程 **26856**，地址 `http://127.0.0.1:50968`。
它与所有 Engine/UI PID 不同，仅用 HTTP 提供真实块字节。
记录 **44** 次 raw 请求：42 次正常请求覆盖全部 7 个唯一块，加坏块和超限各 1 次；
均为 GET、`?format=raw`、Accept `application/vnd.ipld.raw`，无 Cookie/Authorization。
正常场景使用 `/good` 或 `/good/` base path，实际请求都落在 `/good/ipfs/{cid}`。
错误覆盖地址 `/unused-user`、`/unused-file`、`/unused-rpc` 收到 **0** 次请求。

## D-S01 / D-AC01：入口、四层与数据库来源

| 成功场景 | 实际入口与覆盖 | 监听 | 数据库，相对 `<owned-root>` |
| --- | --- | --- | --- |
| 纯参数，Engine-only | standalone，CLI 显式 Gateway，禁用用户层 | `127.0.0.1:50969` | `runtime\workspace\cli\cli.sqlite` |
| YAML + CLI | pguide 发现，YAML Gateway/base 尾斜杠，CLI port 0 覆盖 2345 | `127.0.0.1:64831` | `runtime\workspace\files\yaml.sqlite` |
| JSON | standalone，指定 JSON Gateway，禁用用户层 | `127.0.0.1:61568` | `runtime\workspace\files\json.sqlite` |
| 用户 JSONC | pguide 发现，注释/尾逗号，非法项目服务字段被排除 | `127.0.0.1:54224` | `isolated-user\pguide\user.sqlite` |
| 四层与 UI | standalone，用户 RPC 被 YAML Gateway 覆盖，文件错误 Gateway URL 被 CLI 正确 URL 覆盖，CLI port 0 | Engine `127.0.0.1:52223`；UI `127.0.0.1:52225` | `runtime\workspace\files\ui.sqlite` |
| 全局完全禁用 | pguide 发现，存在损坏用户文件，JSON Gateway + CLI 数据库 | `127.0.0.1:52239` | `runtime\workspace\cli\isolated.sqlite` |
| 默认 RPC 对照 | pguide 发现，不提供 transport；同时给真实 RPC 与无用 Gateway URL | `127.0.0.1:56766` | `runtime\workspace\cli\rpc.sqlite` |

每个成功场景关闭后，用 SQLite 只读查询准确的 `request_id → task_id` 验证目标文件；
不仅推断文件存在。数据库分别锚定 CLI CWD、指定文件目录、用户文件目录；
非法项目数据库 `must-not-exist.sqlite` 始终不存在。
共享用户设置仅使用隔离的既有 pguide 用户目录，没有另一套服务全局目录。

两种入口各执行 9 类非法输入，共 **18/18** 非零退出且没有 ready：
损坏的启用用户层；被覆盖的非法文件 transport/URL；
被覆盖的非法用户 transport/URL；Gateway 缺 URL；非法 port 被覆盖；
非回环 host；退役 `.mjs`。
旧模块的文件副作用标记始终不存在。禁用损坏用户层仍能发现并实际执行，
不是仅对解析器调用或 help 的验证。

## D-S02 / D-AC02：无 RPC 执行、失败与 UI

作者发布后先关闭本次真实 Kubo，并确认原 RPC 不可访问，再运行全部 Gateway 场景。
这段期间 owned Kubo daemon 不运行，runtime 环境清除历史 IPFS 环境变量，
Gateway 配置的 RPC 地址仅指向独立 HTTP 源的 `/rpc` 计数探针。
六个 Gateway 成功场景及三个失败场景期间，探针累计 **0** 次请求。
没有把真实节点作为 Gateway 的运行依赖，也未尝试接管父会话既有节点。

全部七个主成功场景，加 UI 代理另一次提交，共 **8** 个 Task 完成，精确结果均为：

```json
{"message":"gateway-outer-proof","resourceBytes":600000}
```

其中 Gateway 独立完成 7 个 Task，真实 RPC 对照完成 1 个。
callback 实际逐块读取标准 DAG 中的资源，不只是返回常量或声明元数据。
UI 场景验证 HTML/app.js/style.css、bootstrap/CSRF/endpoint binding，
通过公开 HTTP 代理读取已有 Task 并 POST 同一 Bundle 取得上述精确结果；
未读取 Engine 数据库或调用进程内 Engine。
各服务对错误 Host、跨站 Origin、`Sec-Fetch-Site: cross-site` 返回 403；
UI 对跨站 Origin 返回 403。

| 独立失败场景 | 公开拒绝结果 | 外部事实 |
| --- | --- | --- |
| 请求正确 CID，源返回错误块字节 | `bundle_fetch_failed` / `IPFS acquisition or CID verification failed.` | 无 Task，源标记实际返回 corrupt 字节 |
| raw MIME、无长度的 3 MiB chunked 流 | `capacity_exceeded` / `IPFS acquisition exceeds host capacity.` | 无 Task；源在写出 **2,129,920** 字节后观察到提前断开，小于完整 3 MiB |
| 已释放随机端口上的不可达 Gateway | `bundle_fetch_failed` | 无 Task；不切换到 RPC |

三个失败各用新数据库/新服务，均经真实 HTTP 请求与状态轮询确认；
拒绝结果未伪装成成功 Task，也未误称失败请求必须出现在已接受 SQL 投影。
三个失败后 `/rpc` 探针仍为 0。外部不逐项重复 Inner 的 MIME/timeout 等单元矩阵，
也不把它们冒充本次外部实测。

## 当前真实 RPC 对照

从官方 `ipfs/kubo v0.43.1` release 下载 Windows amd64 zip 与 `.sha512`，
两者校验一致后解压，SHA-512：

```text
e611cecef25cddb10b7f907145383608d9b31219ad7120041aeacfe2313882da1944f2897fda29bc2d959dd357e4950089ec8f2cbd52b29f2fc472bcae4356d0
```

独立 `IPFS_PATH`，`init --profile=test`、API/Gateway 随机回环端口、`daemon --offline`。
作者阶段 PID **7208** / RPC `127.0.0.1:62873`，真实写块与 recursive pin 成功，
`block/stat`、`pin/ls` 均返回 200；随后关闭，Gateway 验证期不运行。
Gateway 验证全部结束后才重启为 PID **9296** / RPC `127.0.0.1:56763`，
默认 RPC 服务通过同一已发布 Bundle 执行成功。
同时设置 Gateway URL 不会自动改变 transport，`/unused-rpc` 收到 0 请求。
CLI 停止后真实 Kubo 仍返回 version 200，最后仅由 harness 关闭。

## 退出、环境保护与限制

- 7 个成功服务和 3 个拒绝服务，共 **10/10** 打印 `closed`、退出码 0；
  停止后 Engine URL 均拒绝连接，UI URL 同样不可达。
- 每次 Engine 退出后独立 raw 源仍返回 stats 200；仅 harness 最后通知它退出，
  源退出码 0，原源地址随后不可访问。
- 两次 owned Kubo 均通过自己的 shutdown API 退出 0；最后独立 `repo stat` 成功，
  证明 repo lock 释放。没有修改/停止用户既有 Kubo。
- Windows 使用与旧外部验证一致的 IPC wrapper/private named-pipe preload，
  对 ready 输出的确切服务 PID 输送 Node SIGTERM 事件。只输送信号，
  不注入 IPFS client、Engine、权限回调或业务对象；发现仍走已安装 binary。
  这证明服务实际信号 handler 和关闭，不冒充原生终端 Ctrl+C。
- 真实用户配置的内存 fingerprint 前后相同，未落盘其内容/摘要；
  项目 fixture 与 owned old-database sentinel 字节不变。
- 最终 tracked helper **0**；额外按已记录 PID 和独立外部路径做 OS 检查为 **0**。
  核对 owner marker 后删除本轮新建仓库外环境，含 tarballs、安装图、数据库、Kubo 私有 repo/tools；
  生成 JSON 的最终 cleanup 字段由这一步实际结果补充。无遗留 owned 服务或目录。

本轮固定集成源码的附加回归：

- `pnpm --filter @potential-guide/task-sdk exec tsx --test test\bundle.test.ts`：
  **5/5 通过**，包含新 Bundle-relative Schema 路径、绝对 ID、fragment 与共享引用解析。
- `pnpm exec tsx --test packages\ipfs-content\test\*.test.ts apps\pguide-task-engine\test\*.test.ts packages\task-engine\test\bundle.test.ts packages\task-engine-server\test\bundle.test.ts`：
  **16/16 通过**，含合并后的 loader、原 RPC、程序化 Server、Gateway 和 UI 回归。

外部部署验收没有 blocker。按 parent 的有界 refresh 要求，**未在 `9648e209` 重跑
`pnpm check`，不声明当前 HEAD 全量通过**。以下只保留旧 `843e8ecb` 的准确说明：
其全量 check 退出 1，`check-task/test/restart.test.ts` 的 HTTPS/file 两项
子进程 readiness 超时，随后独立重跑 **2/2 通过**；独立 monorepo 分类项仍因
`.agent/skills/component-responsibility-docs/SKILL.md` 为 `unverified` 退出 1。
这些历史结果放在 JSON 的 `supersedes.historicalRepositoryValidation`，
不冒充本次重跑；本轮未修改相关源码/规则。

## 主代理最终复核

在证据提交 `0bc079ab9bada7f0f0d1858a3a2ec9b76aa0e700` 上，主代理独立重跑
Gateway/CLI/Engine/Server 的同一组回归，**16/16 通过**；
以结构化断言核对本轮 sourceCommit、7 个精确成功结果、18 个配置拒绝、
3 个内容拒绝、零 RPC 请求、七块 clean YAML Bundle、配置保护和零遗留资源，均通过。
相对实测源码 `9648e209` 的 apps、packages、scripts 和 lockfile 没有变化。

随后主代理执行当前集成候选的 `pnpm check`：**退出 1**。
build/layers、format、lint、typecheck 均通过；Turbo test 为 **67 successful / 74 total**，
已报告失败仍仅是既存 `.agent/skills/component-responsibility-docs/SKILL.md`
责任分类 `unverified`。本次没有报告 readiness timeout，不沿用历史超时结论；
后续完整 pack 阶段因短路未执行，不声明全量通过。该复核只增加 Outer 证据，
没有改变部署契约或产品源码。

## 复现

需要该 source commit 的已构建产物；从源码根目录运行，选择不存在的无空格外部目录：

```powershell
$source = (Get-Location).Path
$harness = Join-Path $source '.silvermoon\ideas\01M6GRRES5EBHYDP1G9DZEGE8E\outer\Gateway-Verify.mjs'
$outer = '..\..\potential-guide-gateway-outer-new-run'
if (Test-Path $outer) { throw 'Choose a new owned directory.' }
New-Item -ItemType Directory (Join-Path $outer 'tools') | Out-Null
Set-Location $outer
gh release download v0.43.1 --repo ipfs/kubo --pattern kubo_v0.43.1_windows-amd64.zip --pattern kubo_v0.43.1_windows-amd64.zip.sha512 --dir tools
$expected = ((Get-Content tools\kubo_v0.43.1_windows-amd64.zip.sha512) -split '\s+')[0]
$actual = (Get-FileHash tools\kubo_v0.43.1_windows-amd64.zip -Algorithm SHA512).Hash
if ($actual.ToLower() -ne $expected.ToLower()) { throw 'Checksum mismatch.' }
Expand-Archive tools\kubo_v0.43.1_windows-amd64.zip -DestinationPath tools
node $harness $source 9648e2094b296b7f559c79c6ac994e19277300ea *> run.log
if ($LASTEXITCODE -ne 0) { throw 'Inspect owned Gateway-Results.json.' }
```

脚本拒绝非新建目录，写入 owner marker；结果先落在该外部目录。
退出后回到源码目录，保存脱敏结果，核对 marker 与所有记录 PID 已不存在后，
只删除本次专用环境；确认目录不存在并补充结果的最终 cleanup 字段。
不要复制真实 Kubo repo/身份或广泛删除其他路径。本轮与历史轮次的实际环境均已删除；
JSON 的顶层安装、HTTP 与生命周期结果均来自 `9648e209`，
不是旧执行的复制或可复用的用户环境。
