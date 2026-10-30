# 本地文件扩展部署证据

本文件服务当前 Deployment.md。已验收 Inner 为
`5bea45766484d599e0a2bab86b25da05ec2447de`，
packages tree 为 `fb74721446963a327991a621d88e1ff14a8adc39`。
历史 HTTPS MVP 的 Evidence.md / verification/results.json 保留不变。

## 同步后执行的准确候选

- 被测试 deploymentRevision：`30e50af123a3047c06e4c35364d2ae5dce99695e`。
- 对应已同步 primary/harness commit：`cec86bd0130be3b769351d1046a981f640b8b083`。
- 实测时间：2026-10-30 **11:13:35.569Z–11:14:22.506Z**。
- 环境：Windows x64、Node **24.11.1**；实际包管理器为已配置 pnpm 11.22.0。
- 全新目录：`D:\Code\check-server-file-deployment-20261030-a1`，位于源码仓库外且此前不存在。

先同步契约/harness 并重新观测上述 revision，再实际运行以下命令，退出码 **0**：

```powershell
node .silvermoon\ideas\01M65ABHR94EQ14NYTGZAWRRV3\outer\verification\verify.mjs --external-root D:\Code\check-server-file-deployment-20261030-a1 --revision 30e50af123a3047c06e4c35364d2ae5dce99695e
```

完整原始结果为 [verification/local-file-results.json](verification/local-file-results.json)。
后续仅补充本说明、原始结果和 D 清单；契约与 harness 没有再改动。
最终 Outer revision 包含这些新增证据，不冒充测试前的自包含 revision。

## 当前包、安装与纯契约

八个内部包从当前已验收 packages tree 实际 pack，名称/版本/source tree/tarball SHA-256
全部记录在 `packages`。两个主要交付物的本次实际摘要为：

| 包 | 版本 | tarball SHA-256 |
| --- | --- | --- |
| @potential-guide/task-engine-server | 0.1.0-rc.0 | `afc0864be946ffffb67780d862e3b24f8888daf31bb4eae766cedbede639414c` |
| @potential-guide/check-task | 0.1.0-rc.0 | `cca26787d5960a45049aeaf0862aa450d34b471c2283ee554df172b82532ab05` |

不是沿用旧包 hash；同版本后续重打包也必须重新记录实际 archive 摘要。
三个消费者都有独立 package.json、`packages: []` workspace 与精确 file-tarball overrides，
实际执行 `pnpm install --ignore-scripts --prefer-offline --no-frozen-lockfile`。
递归解析每个父依赖并验证 realpath 位于 consumer 内，无 workspace/source/旧 Host 回退。

| 消费者 | 实际安装包 | 检查结果 |
| --- | ---: | --- |
| contracts | 16 | manifest/full files/digest/References/input/result、真实 file codec，禁止 IO 计数 0 |
| generic | 5 | 只有通用 task 五包；程序化、安装 CLI、HTTP/SSE/history、fatal startup |
| check | 22 | 保留完整 HTTPS MVP 证明，另执行完整真实 file suite |

纯契约 file roundtrip 不要求文件存在；Objective file 引用与 file query 拒绝。
运行时 import graph 与禁止网络/写盘/worker/process 调用均实际检查；
安装图仍包含 **esbuild 0.28.2、@esbuild/win32-x64 0.28.2、tar 7.5.22**。
无导入副作用不等于免安装构建工具。

## D-S01 / D-AC01：HTTP、HTTPS 与真实文件

保留原 HTTPS fixture resolver（明确不是远端 TLS 下载服务）和无制品类型，
验证真实程序化/CLI 启动、401/403 权限拒绝、business ok:false 正常完成、
七类制品/runtime/执行故障、共享独立取消、分页历史、SSE 重连和幂等不重跑。
实际安装的 executable shim 执行 JSON help，服务也通过真实 CLI main 运行。

新的 `consumers[check].fileProof` 使用生产 `allowedFileRoots` 与实际 filesystem：

- 来源为真实 `file:///…/imports/local%20archive%20%231.tgz`，含空格与 `#` 的实际 native
  文件名，Typed codec 精确 roundtrip。全 file suite 的 HTTPS hook 调用数为 **0**；
  hook 对任何非 HTTPS 入参直接抛错，不能靠本地 bytes hook 伪造 file 成功。
- 同一 unpinned reference、同一 eligibleAt，文件替换后新 Task 执行 replacement，
  不复用 original 的 Execution。随后删除文件，已授权 exact cache 仍执行 original。
- outside-root、错误 scope、无 root grant、business context 伪造 roots 全部拒绝；
  missing、directory、oversize、corrupt、digest mismatch、junction 分别有明确失败。
  malformed file query 在 HTTP admission 返回 **400**。
- file-backed 正常结果、分页 history、SSE 断开/续接，以及带活动 SSE 的正常 close 均通过；
  独立真实 CLI 也完成 file-backed Check。

文件 fixture 的原始 digest 为
`sha256:0e8e06bffe3032f0f9c4e29d45381e3d65f698ff4a37f7b37be67e653435863b`，
replacement 为
`sha256:c47fba94fabe2160dd2d69733d5f3061fcebf14b9ac3a3eebcf5a40fcbdba6e0`。
完整原生路径、transportDigest、Task/Execution 快照均在 `fileProof.artifacts` / `cases`。

## D-S02 / D-AC02：恢复与实际物理退出

HTTPS 的 crash/restart、shared cancel、CPU-bound worker + 活动 SSE 关闭、
owned subprocess 退出先于容量复用等旧场景，在当前新包中重新运行并通过，
没有只引用历史 results.json。

真实 file + SQLite 独立进程重启在 queued Prepared 持久化后：

1. 故意终止 running owner，确认旧 OS PID 不存在。
2. 将原 archive 替换为 replacement，再删除该文件。
3. 以同一 SQLite/当前 root 策略重启；unknown started work 为
   **execution_interrupted**，原 Request/Task/Series/Execution ID 与 deadline 保留，没有重跑。
4. queued Task 保留原身份/期限并执行 **original**；
   journal 精确为 `file-unknown`、`file-queued` 各一次。
   恢复进程的 native file-helper 数为 **0**，
   HTTPS 下载总记录 **6→6**，不存在读失败后偷偷 fetch replacement 的路径。

file suite 实测 **10 次 native helper start / 10 次物理 close**，
逐一确认 helper PID 消失和 `.cache/check-archive-*` 清空。
实测 **6 个 Worker start / 5 个 exit**；唯一无 exit 事件的是故意 crash 的旧服务器内
worker，其整个进程已退出，不假称正常 dispose。
其他单槽 worker 都验证前一个实际 exit 后才出现下一个 start，快照目录清空。

file suite 的 owned 服务器 PID 为 **36328、15328、25656、37208、20924**，
均确认不存在。包括无 root 的进程：既无 worker，也无 native file helper，
因此不能把权限拒绝后的副作用隐藏在计数中。
泛用 CLI fatal-startup 复现约 **169 ms** 自行退出：
`code:1, signal:null, ready:false, closed:false, harnessKill:false`，明确诊断清理未确认。

程序化正常 close 通过 IPC 请求，等待自然退出码 0 和 SSE 结束，
没有强制 `process.exit(0)` 制造成功。Windows CLI SIGTERM 仍明确标记
`gracefulSignalProven:false`；不宣称 POSIX signal handler 已实测。
Native helper 观察仅包装 spawn/close 事件，Worker 观察仅记录真实 exit；
没有替换生产 prepare/worker/cleanup 行为。

所有本次外部服务、helper 及 owned subprocess 均已结束。
核对唯一 ownership marker 后删除完整外部目录，`externalRootRemoved:true`；
另以 Test-Path 确认目录不存在，并按该路径标记检查进程，无本次遗留实例。
未访问父代理的 live service、SQLite 或 imports。

## 父代理浏览器收据

[ParentBrowserReceipt.json](ParentBrowserReceipt.json) 是父代理提供的独立观测，
不是本代理的浏览器重跑记录。记录包含初次端到端观测、最终 app.js 文案修订后的
实际文件选择/上传/提交复测，以及完整脚本摘要。最终 app.js 为
`13C35233E5CE734C81CE747AC7068ED35BC141B1EE455EA69E0372267DA34B1E`。
父代理持有的 58865/58864 服务及其 SQLite/imports 不属于本次外部 fixture，
本代理不访问、停止或清理它们。环境摘要分库是会话组装的显式策略，旧 DB 未改写，
不冒充产品迁移或自动 fallback。

## D-S03 / D-AC03：父代理实测浏览器与本次独立证明的区别

父代理实际选取 654-byte Checker archive，服务器保存为持久 imports 中的 opaque 文件名，
返回真实 file URL 与 digest
`sha256:dff35cd157480f29aa4b0f7e158b52e515c76675e17dca955d452675dc720566`；
subject schema 要求 value:number，delayMs:integer 可选。
初次 `{value:12,delayMs:300}` 对应 Task `01M667KDS5FX9FBZD5GNWGN4W4` /
Execution `01M667KEGNSG8W4P9PVAKEQC0A`，正常 ok:true。
raw progress 为 `{phase:"finished",processed:2,total:2}`，未假定 percentage bar；
history 观察到创建、准备、执行、进展、完成和 reclaimed。

最终 app.js 仅修订 import-status 文案后，父代理再次 reload 并实际选择/上传/提交：
`{value:12}`，Task `01M667SXD1MCF3V4MAJZGE1PN8` /
Execution `01M667SY5W6SQVWYNB3VZD19PX`，同 digest、completed、ok:true、无浏览器错误。
390 viewport / 375 content，无横向 overflow。
最终四个脚本 SHA-256（含校正过 realpath fixture 的 playground.test.mjs）
均保存在收据，未把旧 app hash 冒充最新代码。

父代理另实测 invalid checker.cjs 为 HTTP400 且旧 artifactURL 不变；
oversize413、corrupt400不创建文件、恶意 display-name 不作磁盘路径、
outside-root preparation_failed。真实 `/gateway/v1` 外部 endpoint 禁用 picker，
切回 local 恢复；上传与凭据均未送往外部 endpoint。
这些属于父代理观察的会话级边界，不宣称本代理重跑了浏览器或将 UI 发布为仓库产品。
本代理的仓库外 packed 实测则独立证明相同已验收 API 真正读取本地 archive 与不可变恢复。

## 审计结论

全部 D 步骤/标准已有当前证据，等待父代理明确 acceptOuter；本文件不记录验收。
历史 HTTPS 文件、旧运行结果与 Inner World 完整保留。
运行前后与实现验收提交比较，packages/scripts/docs/examples 及 Inner World 差异为零。
本次只有 Outer harness/证据与清单变动，因此未重复全仓 pnpm check，
但以上仓库外 pack/install/HTTP/SSE/file/restart 检查确实全部执行并通过。
