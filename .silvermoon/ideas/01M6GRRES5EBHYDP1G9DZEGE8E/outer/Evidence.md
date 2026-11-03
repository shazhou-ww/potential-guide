# Task Engine 服务命令外部验证证据

## 契约与候选

本次按已同步的 [Deployment](Deployment.md) 执行 D-S01、D-S02、D-AC01、D-AC02，
没有细化或修改部署要求，没有更改 deliverable、Inner、Ideal 或 events。

- 消费源码提交：`9e436e535cd7bafb5034a9be477d44350e8c1bb3`。
- 已接受 implementation revision：`97a0be842462e555597cc09defae59d06e2849e7`。
- 执行检查前同步的 deployment revision：`a6cad9f317a8bfc553d506f49a8cbafa6c49bd81`。
- Deployment.md 的已同步 Git blob：`e234f8ce7b1140f6679843e301c1b19b1c75da5b`，本次保持不变。
- Windows，Node `24.11.1`，pnpm `11.22.0`；未发布 npm。

提交证据前 primary 已有其他 Idea 的并发历史，分支普通 fast-forward 到
`e9b2985ca1e90bb010aca73ea062516bb82d2bcf` 后才通过最终 snapshot 检查。
未编辑这些上游变更或其事件；本工作者的候选变更仅为当前 Outer 辅助证据及 D 项 checkbox。
外部实测所消费的提交仍准确记录为上述 `9e436e53`，没有把上游跟进冒充重新执行。

逐条命令、随机地址、数据库锚点、Task 身份、结果和清理事实见
[Results.json](Results.json)；可重现检查见 [Verify.mjs](Verify.mjs)。
结果中 `<source>` 表示该源码 checkout，`<owned-root>` 表示本次仓库外的专用消费目录，
不包含个人路径、真实用户设置内容、Kubo 私钥或其他凭据。
这些辅助文件只记录当前 Outer 的实测，不构成新的部署要求。

## 独立安装与实际 Kubo

在仓库外新建且只属于本操作的两个环境：

```text
D:\Code\potential-guide-outer-task-engine-20261104
D:\Code\potential-guide-outer-task-engine-20261104-graceful
```

第一轮已完成全部六个场景，但发现入口在 Windows 使用强制终止，不能作为优雅清理证明。
第二轮添加仅供测试的信号输送通道并重新执行全部检查；
本文与 Results.json 采用第二轮结果，六个场景均观察到 `closed` 和退出码 0。
两个环境及其中的 tarballs、安装图、数据库、日志和 Kubo 工具最终均已清理。

Kubo 未在 PATH 上预装。`dist.ipfs.tech` 下载连接超时后，改从官方
[ipfs/kubo v0.43.1 release](https://github.com/ipfs/kubo/releases/tag/v0.43.1)
下载 `kubo_v0.43.1_windows-amd64.zip` 和对应 `.sha512`，按发布的 SHA-512 比对后解压：

```text
e611cecef25cddb10b7f907145383608d9b31219ad7120041aeacfe2313882da1944f2897fda29bc2d959dd357e4950089ec8f2cbd52b29f2fc472bcae4356d0
```

本次直接创建独立 `IPFS_PATH`，执行：

```powershell
ipfs.exe init --profile=test
ipfs.exe config Addresses.API /ip4/127.0.0.1/tcp/0
ipfs.exe config Addresses.Gateway /ip4/127.0.0.1/tcp/0
ipfs.exe daemon --offline
```

第二轮 Kubo PID 为 `45120`，实际 RPC 为 `http://127.0.0.1:53807`。
它是真实 Kubo daemon，使用独立本地 blockstore，不是 mock 或 Engine 进程内 client；
offline 模式避免连接公网 peers，随机回环端口不占用既有节点的监听地址。

从当前本地产物打包 **22** 个内部包，分别安装：

- runtime：仅直接选择 `pguide` 与 `@potential-guide/pguide-task-engine`；
  实际完整 production 图为 406 个物理包节点，其中 21 个内部包。
- author：仅直接选择 SDK 与 IPFS client；production 图为 142 个物理包节点，
  其中 5 个内部包。
- 安装均使用 `pnpm install --prod --prefer-offline --ignore-scripts --no-frozen-lockfile`，
  内部依赖全部通过本地 tarball overrides 解析；第三方依赖可使用 pnpm 缓存/registry。
- 从每个实际父包递归验证 dependency/peer/optional 解析与版本；
  所有物理包路径留在各自仓库外 consumer 内，无残留 `workspace:` range 或源码路径回退。

直接运行已安装 `.bin\pguide-task-engine.cmd --pguide-command-metadata` 和
`.bin\pguide.cmd task-engine --help --format json --no-global-config` 均成功。
runtime 未直接安装 author 工具，服务消费不依赖作者环境。

## D-S01 / D-AC01：入口、配置与实际数据位置

所有场景均从仓库外的 runtime/workspace 调用，使用新数据库和随机监听端口。
每个场景都通过实际 Kubo 执行 Bundle，停止后用 Node SQLite 的只读查询验证：
该场景的目标数据库 `requests` 表确实保存了返回的 requestId/taskId。
因此数据库来源不是只根据日志或空文件推断。

| 场景 | 实际入口与覆盖 | 监听 | 数据库，相对 `<owned-root>` |
| --- | --- | --- | --- |
| 纯参数，Engine-only | 独立 binary；禁用用户层，CLI 指定 RPC/数据库/port 0 | `127.0.0.1:53816` | `runtime/workspace/cli/cli.sqlite` |
| YAML 与 CLI 覆盖 | pguide 发现；YAML port 2345 被 CLI port 0 覆盖 | `127.0.0.1:53826` | `runtime/workspace/files/yaml.sqlite` |
| JSON | 独立 binary；显式 JSON，禁用用户层 | `127.0.0.1:53834` | `runtime/workspace/files/json.sqlite` |
| 隔离用户 JSONC | pguide 发现；用户文件含注释/尾逗号，项目服务值冲突且非法 | `127.0.0.1:55499` | `isolated-user/pguide/user.sqlite` |
| 四层与 UI | 独立 binary；用户层 + YAML + CLI；CLI 覆盖 port 及文件中的错误 RPC 地址 | Engine `127.0.0.1:55506`；UI `127.0.0.1:55507` | `runtime/workspace/files/ui.sqlite` |
| 完全禁用全局 | pguide 发现；损坏用户 JSONC 存在，`--no-global-config` 贯穿发现与启动 | `127.0.0.1:54406` | `runtime/workspace/files/isolated.sqlite` |

覆盖场景的 YAML 使用有效但不可用的 `http://127.0.0.1:1` RPC，
CLI 覆盖为本次 Kubo 后仍完成 Task，证明使用的是最终有效 RPC，而非文件值或默认值。
相对数据库路径分别命中 CLI CWD、文件目录、用户文件目录；
项目的 `task-engine.database` 指向 `must-not-exist.sqlite`，该文件始终不存在。
共享用户设置仅在隔离的既有 pguide 用户目录结构中读取，没有第二套服务全局目录。

## D-S02 / D-AC02：真实 Bundle、UI 与拒绝边界

从既有非敏感 `examples/task-server/echo-type.mjs` 构建自包含 Task Bundle，
使用安装后的 SDK/IPFS client 导入并 pin 到本次 Kubo；真实 `block/stat` 返回 200。
Bundle CID：

```text
bafybeigm3qxb653kykqlndsebzmzc55bi4qphsq6tbtdt4j5ps46tkoeq4
```

六个场景分别经公开 Engine HTTP 提交并轮询请求/任务，
全部取得 `completed` 和精确结果：

```json
{"message":"non-sensitive-outer-proof"}
```

带 UI 场景还实际验证：

- HTML、`app.js`、`style.css` 返回成功；
- bootstrap 会话和 endpoint binding，UI 经公开 HTTP 代理读取已完成 Task；
- 另一次由 UI 代理 POST 创建的同一真实 Bundle Task 完成并得到相同结果；
- Engine 对不匹配 Host、跨站 Origin、`Sec-Fetch-Site: cross-site` 返回 403；
  UI 对跨站 Origin 返回 403。

两种入口各执行五类非法输入，共 **10/10** 非零退出，均未输出 ready：

1. 损坏的启用用户配置；
2. 文件中非法 port 即使被合法 CLI port 覆盖；
3. 非回环 `0.0.0.0`；
4. 已退役 `.mjs` 配置，其副作用标记始终不存在；
5. 用户层非法 port 即使被合法 JSON 文件和 CLI 覆盖。

这些验证没有用 mocked RPC 代替真实外部节点。

## 关闭、所有权与配置保护

Windows `TerminateProcess`/`child.kill("SIGTERM")` 不等同于 Node 收到可处理信号。
第二轮 harness 只在本次子进程中加载外部测试 preload，通过私有 named pipe，
向 ready 输出的确切服务 PID 输送 Node SIGTERM 事件；独立入口使用 IPC wrapper。
扩展发现仍使用真实安装的 `.cmd`，服务运行的是未修改的安装产物。
preload/wrapper 仅用于操作系统测试信号输送，不是服务配置模块，
没有向服务注入 Engine、IPFS client、认证回调或业务对象。

结果：

- **6/6** 服务场景均打印 `closed`、退出码 0；停止后所有 Engine URL 拒绝连接，
  所选 UI URL 同样拒绝连接。
- 每次停止服务后，本次独立 Kubo `/api/v0/version` 仍返回 200；
  CLI 没有停止或接管 Kubo。
- 最后由 harness 对自己拥有的 Kubo 调用 `/api/v0/shutdown`，
  daemon 退出码 0；RPC 随后不可访问，独立 `ipfs repo stat` 成功，证明仓库锁已释放。
- 删除本次 Kubo repository，包括新生成的私有身份；关闭测试信号 controller。
- OS 进程探测：本次两个外部环境对应的 Node/Kubo/cmd helper **0** 个遗留；
  核对 owner marker 后删除两个外部环境，再次确认目录 **0**、helper **0**。
- 真实用户主配置的内存 fingerprint 前后相同，未将内容、路径或摘要写入证据；
  项目 fixture 配置字节未变，已有的 owned old-database sentinel 字节未变。
  没有扫描、启动、停止或修改父会话的既有 Server/UI/Kubo。

没有真实 Kubo、安装、执行、配置或清理 blocker。
本次没有模拟原生终端 Ctrl+C；证明的是未修改服务的真实进程信号处理与资源清理，
不把 Windows 强制结束冒充优雅退出。

## 复现命令

以下要求源码的本地产物已按对应提交构建；使用新的、无空格的独立目录，
不要在已有 consumer 或用户目录运行。脚本会拒绝非空环境，
仅允许预先提供的 `tools` 与 shell 本次创建的 `run.log`。

```powershell
$source = (Get-Location).Path
$harness = Join-Path $source '.silvermoon\ideas\01M6GRRES5EBHYDP1G9DZEGE8E\outer\Verify.mjs'
$outer = '..\..\potential-guide-outer-task-engine-new-run'
if (Test-Path $outer) { throw 'Choose a new owned directory.' }
New-Item -ItemType Directory $outer | Out-Null
Set-Location $outer
New-Item -ItemType Directory tools | Out-Null
gh release download v0.43.1 --repo ipfs/kubo --pattern kubo_v0.43.1_windows-amd64.zip --pattern kubo_v0.43.1_windows-amd64.zip.sha512 --dir tools
$expected = ((Get-Content tools\kubo_v0.43.1_windows-amd64.zip.sha512) -split '\s+')[0]
$actual = (Get-FileHash tools\kubo_v0.43.1_windows-amd64.zip -Algorithm SHA512).Hash
if ($actual.ToLower() -ne $expected.ToLower()) { throw 'Kubo checksum mismatch.' }
Expand-Archive tools\kubo_v0.43.1_windows-amd64.zip -DestinationPath tools
node $harness $source *> run.log
if ($LASTEXITCODE -ne 0) { throw 'Inspect owned results.json before cleanup.' }
```

完整命令数组和退出码保存在 Results.json。
`node $harness $source --graph-only` 可在尚未清理的 consumer 中独立复验安装图；
已验证在已有环境误执行完整脚本会退出 1，且不会删除现有环境。
复现者须在保存脱敏结果后按 owner marker 清理自己新建的环境，不能广泛删除其他路径。
