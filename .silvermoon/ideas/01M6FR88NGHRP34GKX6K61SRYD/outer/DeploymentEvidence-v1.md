# Task Run Logs 当前 v1 独立部署证据

## 固定候选与边界

执行日期：2026-11-07，约 09:13–09:21（UTC+08:00）。
实现候选为 `26ab9bcfdf0caa382c79348f4bbb0e001d3caee3`，
用户已接受 `implementationRevision=e25596e463ce1306b1772d7caa23c7c8fe8e1ac3`，
接受事件已同步至 primary `5385e013865ce5467e73565c7747b8e74ea83625`。
[Deployment.md](Deployment.md) 在执行前同步于
`d0b815eeccc047ecc839268cc62512a2916c840d`，
当时 `deploymentRevision=83c52d735db39ed24d5ab94f76c599a5b90b045d`。
本证据只补结果，不改变部署要求或已验收 Inner World。

环境为 Windows、Node `v24.12.0`、pnpm `11.22.0`，仅演练本机独立消费者，
不发布 npm、不替换共享服务或生产数据库。
协议以 axis 的唯一 v1 和 `frozen: false` 为准；不复用
[旧 v2 部署证明](DeploymentEvidence.md)。
实施阶段已披露并获用户接受的 Windows symlink `EPERM` 全量检查限制，
仍见 [Inner 证据](inner/Evidence-v1.md)，本轮不把该限制改写为全量通过。

## D-S01 / D-AC01：本地 tarball 与独立 runtime

从固定候选的构建产物逐包执行 `pnpm --dir <包目录> pack --pack-destination <本轮 packs> --json`。
内部依赖全部通过本地 tarball overrides 锁定；仅第三方生产依赖允许下载，
两个独立目录均以 `packages: []` 隔离 workspace，执行：

```powershell
$env:PNPM_CONFIG_STORE_DIR = "<本隔离工作区专用 store 绝对路径>"
pnpm install --ignore-scripts --prefer-offline --no-frozen-lockfile
```

包名均带 `@potential-guide/` 前缀，实际版本及 tarball SHA-256 如下：

| 包 | 版本 | SHA-256 |
| --- | --- | --- |
| cli-core | 0.3.0-rc.0 | `d3578b681e65c94a3b756cfa31644cb4376ba11cb6f430d759ee7cb801b6ee05` |
| task-protocol | 0.1.0-rc.1 | `7d93d3573e08d3665ec8db50702dd467630c11cb506da6f5af731d6833983e62` |
| task-sdk | 0.1.0-rc.1 | `82f5b54a3f4dcddcbae24e470c43d9af98a33f00173665b162edac2a2906cb1b` |
| task-engine | 0.1.0-rc.1 | `257567e9031854d016441002a6493a1a38a076f3e1d11cf0becdca858c4e63a0` |
| pguide-task-bundle | 0.1.0-rc.1 | `f01a6f517f0f53b6cbaa75f509a49eb9ad173d483f299adb2a1af07f866f0864` |
| task-engine-http | 0.1.0-rc.1 | `d08cf2e364a18372eb8e0dbb57edaa1f1909e37ec0ad495ffa1913b307dff629` |
| task-engine-storage | 0.1.0-rc.1 | `f9c3e978e24164dc807f04eda9f2743600a977a470c713f3724caa4f735d543f` |
| task-engine-server | 0.1.0-rc.2 | `3010a9675e5db666b76dbe929a4d769687e76823bf99fa6e69b4b665bb225f87` |

author 安装 SDK、Protocol、Bundle 工具及 Engine，显式 `runTask(callback)` 以
`entryMode: "explicit"` 生成自包含 Bundle；删除作者 main/declaration，
将 author node_modules 移出解析路径，再结束作者进程。
实际 Bundle：

- 根 CID：`bafybeiaagyjdcou5rlyk4beju5navlbv6xfbznpmmjie56bnbjud3qrzgm`
- Schema：`https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json`
- CAR SHA-256：`0c4e76e55aaa61ce65f358129731081290e8a843dba763a04e357b57f1b691f6`

callback 按输入的 label/count/delay 显式输出带选定 fields 的逐项日志和结束摘要，
最后仅返回 `{ok:true}`。消息含字面量 `<script>label:index</script>`，
用于核对 UI 按非可信文本展示；不记录环境变量或凭据。
策略分支额外输出 1024 字符条目，并在 callback 内断言回执为
`dropped/entry_too_large`，不将回执塞进业务 Result。

runtime 只安装 Server/Engine/HTTP/Storage/Protocol 生产闭包，
虚拟 store 中只有这五个内部包；独立进程断言 SDK、Bundle 工具、Check、Probe
均无法解析。Engine 通过公开 `createIpfsGatewayClient` 从 loopback HTTP
Gateway fixture 读取校验过的原始 IPFS blocks，实际产生 6 次 block GET，
不依赖作者进程或源码目录，不使用 RPC。
这是隔离 Gateway fixture 的本机证明，不是公网 IPFS 可达性或生产部署证明。

Web UI `0.1.0-rc.1` 复制完整 dist 至独立目录，无 node_modules；
以 `node --permission --allow-fs-read=<ui> --allow-fs-write=<ui> ...\dist\src\main.js ...\ui.json`
启动，不能读取工作区依赖。实际 UI 产物 SHA-256：

- `dist/public/app.js`：`1c4119ea8785dbf758ae718923d88879b9e945ae861b5862df6e8fd29b26615a`
- `dist/src/server.js`：`ec311c6cbabfca01c387b56b48847fc46ef2f5bc57b9aa037bd2e4069df7ab05`

Gateway、SQLite Server 和 UI 都使用 loopback 随机端口、新数据库；
测试凭据仅在进程中随机生成，经 UI server 的 bearerEnv 注入，不写入仓库或本证据。
实际启动后分别检查 ready 文件、UI HTTP 200 和独立 host 的观察接口。

## D-S02 / D-AC02：真实浏览器和 history/SSE

集成浏览器实际打开独立 UI，通过其受控 proxy 连接上述独立 host，
不是源码 fake DOM 或历史 v2 浏览器记录。观察的 Run：

| label | Run | 最终日志序号 | Result |
| --- | --- | ---: | --- |
| alpha | `01M6SS4YMDB2CXCC5Q3E587S68` | 351 | `{ok:true}` |
| beta | `01M6SS4YQBXBKGQR27FK80P14G` | 13 | `{ok:true}` |
| gamma | `01M6SSD28TEGHYDN5BEV4SHQEB` | 351 | `{ok:true}` |
| delta | `01M6SSD2AC52ETH14KQRGVA3QM` | 351 | `{ok:true}` |

alpha/beta 并发执行；后续经 UI proxy 再提交 gamma/delta 并发执行，
后者每条间隔 150 ms，在执行中打开详情，完成后再读取历史。
以下结果均由真实 HTTP 响应和浏览器 DOM 观察得出：

- 独立 Logs 区域显示级别、宿主时间、sequence、正文、可展开 fields 和当前 Run。
- alpha 历史从序号 1 读取，暂停后保留 50 条；下一页替换为从 51 开始的 50 条，
  再连接的实际 SSE 请求使用 `afterSequence=100`。
- gamma 运行中暂停显示“跟随已暂停”、保留 50 条；
  从 `afterSequence=50` 重连后实际增长到 100 条。
- 从 gamma 切换到 delta 后，当前 Run 身份正确，只含 delta 文本，
  gamma 条目数为 0；旧订阅被中止，未混入其他 Run 输出。
- delta 结束后的 history 共 351 条，sequence 连续且只含 delta；
  从 350 续接的 SSE 实际交付 351，最终 completeness 为 complete。
- alpha 和 delta 的最终实时窗口均观察到 300 条及窗口清理提示；
  delta DOM 文本为 31132 UTF-8 字节（不是 JSON 预算计量），低于 1 MiB；
  日志区域内 `<script>` 元素数为 0，字面量脚本文本未执行。
- 四个 Run 均为 completed，Result 仍为 `{ok:true}`；详情的 Logs 不混入业务 Result。

浏览器工具的普通鼠标点击曾在稳定性等待中超时，
请求辅助接口也曾报 `Storage.getCookies` 协议不支持；
后续用浏览器 DOM 控件事件驱动，并按对应 HTTP response 同步断言，
没有直接修改应用状态或伪造响应。不将这次自动化称作人工鼠标体验验收。
长时间观察中，生命周期目录 SSE 曾出现 `ERR_INCOMPLETE_CHUNKED_ENCODING`，
UI 明确显示“数据陈旧”和错误中心提示；重新查询可恢复，
Logs 的显式 sequence 重连及结束后读取仍成功。
本轮未修改已验收实现，也不承诺长连接永不掉线。

## D-S03 / D-AC03：实际有限策略

主演练使用 `entryBytes=512`、`runEntries=400`、`runBytes=262144`、
`totalBytes=524288`、`maxRuns=8`、`retentionMs=600000`、
`pageSize=50`、`maxSubscriptions=2`。
另用相同独立安装启动新 policy SQLite Server，固定：

```json
{"entryBytes":256,"runEntries":3,"runBytes":1024,"totalBytes":2048,"maxRuns":2,"retentionMs":400,"pageSize":2,"maxSubscriptions":1}
```

实际断言结果：

| 验证 | 结果 |
| --- | --- |
| 未认证 history | HTTP 401 |
| 跨 scope history / SSE | HTTP 403 / 403 |
| 单条超限及每 Run 超限 | 作者断言 oversized receipt 成功；保留序号 1–3，availability=truncated，dropped=9，尾部 complete |
| 超过保留期 | availability=expired，completeness=unknown，firstSequence=4、lastSequence=3，gap=true |
| 活动订阅达到上限 | 第二个订阅 HTTP 429、`capacity_exceeded` |
| 取消观察释放容量 | 关闭第一个订阅后新订阅 HTTP 200；Run 继续正常结束 |
| metadata 淘汰 | 旧 Run 明确 `unavailable/metadata_evicted`，不伪装空日志 |
| 实际 SQLite 记录 | 2 个记录、逻辑正文 786 字节，均未超过 maxRuns=2 / totalBytes=2048；每个记录不超过 3 条 |

SQLite 文件在 policy 查询时为 32768 字节，关闭后为 102400 字节；
live 数据库关闭后为 286720 字节。
物理文件/WAL 高水位不是逻辑正文预算，不能声称即时缩小、安全擦除或硬实时磁盘延迟。
日志仍为 best-effort；未知写入结果不自动重试，日志也不代替退出或回收证明。

## 关闭与清理

浏览器导航至空白页后，显式关闭本轮 UI、Task Server 和 Gateway。
运行进程报告 `Independent run logs services closed.` 并以 exit 0 结束；
三个已知 loopback URL 随后均断言连接被拒绝。
本轮独立安装、CAR、作者依赖副本、数据库和 UI 配置位于唯一拥有的临时 fixture，
收集上述身份与结果后清理该 fixture；不删除共享 store 或用户文件。
本工作区专用依赖 store 保留供后续验证，不是常驻服务。
