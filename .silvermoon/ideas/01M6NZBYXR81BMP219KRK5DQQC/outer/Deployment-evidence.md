# 部署验证与延期范围

本文对应 [Deployment.md](./Deployment.md)。实施已经监督者依据用户授权独立复验、接受并同步；本轮仅准备 Outer 提交，不记录接受或 completed。历史本地机器证据见 [Deployment-results.json](./Deployment-results.json)。

## 当前范围：Ubuntu 验证延期

用户于 2026-11-06 明确要求“那可以提交了，ubuntu 先不验了”。本轮据此调整 Deployment，将 Ubuntu 全套安装、CLI 入口和运行验证延期，保留 npm 发布回执、Windows 独立公共 CID/Reference 消费、独立作者新检查及业务/物理释放要求。Ubuntu 不标记已验证；此要求是提交授权，不是对尚未提交的准确 revision 的 acceptOuter 授权。

调整后的契约及验收脚本先同步 primary `498834b13250d16038ada90fc2fb927f3b860dee`，观察稳定 deploymentRevision `957cef126b53d976624f7ea10b0fc4f081c7951b` 后完整复跑保留的交付证明。Deployment 文件 Git blob 为 `86276ccf38c60f607d3a7af4177cac3252847fb4`，本轮结果记录及 ledger 更新没有进一步改变要求。机器证据中的 `deploymentRevisionAtExecution` 保留该准确执行基线；新增证明文件使最终待提交的 Outer 修订改变，按同步后的 CLI 观察提交，不猜测或沿用旧修订。

### 当前标准的逐项结果

| ID | 实测结论 |
| --- | --- |
| D-S01 | 原 MCP 上传回执的三个 CID 与本轮已发布 CAR 根一致；指定公共 Gateway 的全部 48 个块经 CID 校验且逐字节匹配原 CAR。发布是已有事实，没有重上传或声称获得新账户 pin 回执。 |
| D-S02 | 调整后的范围下重新构建独立作者检查，实际执行九个公共环境 CID 用例和两个独立作者用例；11 个 Run 均有实际 exit/reclaimedAt，资源释放断言通过。 |
| D-AC01 | 三个公共 CID 由已发布 Engine 实际消费；通过标准 UnixFS/block Gateway 读取三份 check.json 和全部 12 篇 Reference，逐字节/SHA-256 匹配已发布资源。 |
| D-AC02 | 两个发布/provenance Action 回执重新查询成功；独立项目的每个固定依赖均核查实际版本。通过、非空问题、异常失败及取消结果符合契约，独立作者新检查实际运行通过/问题用例，工具 PID、目录探针与 HTTP 请求物理释放均通过。 |

最新完整结果见 [Delivery-verification-results.json](./Delivery-verification-results.json)：Windows Node `v24.12.0`，实际安装 check-sdk/check-environment `0.1.0`，Task SDK/Engine/HTTP/Bundle `0.1.0-rc.0`，Task Server `0.1.0-rc.1`，TypeBox `0.34.52`，CAR `5.4.6`，UnixFS exporter `16.2.3`，multiformats `14.0.5`。依赖均来自仓库外独立项目的已发布包，脚本逐项断言版本与项目固定依赖相同，没有从仓库内部源码执行。公共环境请求不使用本地 CAR fallback；独立作者请求明确使用新作者 CAR，不冒称公开发布。

最新构建回执见 [Delivery-author-receipt.json](./Delivery-author-receipt.json)，发布回执见 [Delivery-release-receipts.json](./Delivery-release-receipts.json)，可复跑脚本见 [Delivery-verification.mjs](./Delivery-verification.mjs)。原 11 项验证证据被新修订下的完整复跑更新，不是把旧时点的结果标记为重新验证；上一轮阻塞时点的原文件可在 [原 primary 固定版本](https://github.com/shazhou-ww/potential-guide/tree/1d737b0a29ff2ee979f8df3b5c616ece7e20d550/.silvermoon/ideas/01M6NZBYXR81BMP219KRK5DQQC/outer) 查阅。

### 延期事项与已知限制

Ubuntu 全套安装、CLI 入口和运行验证仍没有开展，保留 `ubuntuVerified:false`，本轮依用户范围调整延期，而不是标记通过。当前 MCP pin metadata 的重新查询需要认证，旧上传回执与当前公共内容匹配分别记录；没有复制凭据、重 pin 或再次 npm 发布。

三个 HTTP UnixFS 资源路径仍返回 404，原样保留；实际通过的是标准按 CID 解码公开块的完整资源读取，不伪称 HTTP 路径成功。当前范围要求并不依赖 HTTP UnixFS 路由。

修改范围后的 `pnpm check` 已再次运行：sources/layers/format/lint/typecheck 通过，test 在既有 `pguide-task-bundle` Windows symlink 用例报 `EPERM`，pack:check 未执行。没有修改产品源码、测试或宿主权限，也不声称完整仓库检查通过。该宿主测试限制与部署外部消费验证分别记录；本轮外部消费脚本完整退出 0。完整检查日志保留在验收会话文件 `pnpm-check-current-scope.log`，可在支持符号链接的获授权环境另行复跑。

本轮四个 D-* 在调整后的要求下均有对应证明，ledger 记录 Agent 工作完成。证据同步 primary 后，仅对 CLI 观察到的准确最终 deploymentRevision 记录 submitOuter，等待明确 acceptOuter；不将“可以提交”或延期 Ubuntu 当作生命周期接受。

## 历史独立复验：公共 CID 与 Reference 已验证，Ubuntu 入口未确认

本轮于 2026-11-06 独立隔离工作区开展交付验收，基线 primary 为 `3be07d321a57637e9189eda452cfb2f5703eb295`，原 Outer 修订为 `bd83119f936dc2afd57ea90ad6eda3e2df06e468`。[Deployment.md](./Deployment.md) 的步骤、标准和文件内容均未改变（Git blob `42be8318f0078fe5e9d91feacd8e589122aaf0e0`）；未修改源码、Ideal/Inner 合约或事件。以下新证据不把历史 Ubuntu 执行当作当前设备复验。

当前父会话明确未能确认获授权 Ubuntu 的 SSH 目标或用户名，要求不再从既有 SSH 别名推断验收机、不继续探测主机或读取凭据。因此本轮仅在 Windows 上做独立 npm 消费和公共 Gateway 复验，没有开展 Ubuntu 操作。前期只读 SSH 定位未找到已记录的验收目录，不能构成授权或设备证明。当前 MCP 的三个 pin detail 请求也均返回需要认证，未得到新的账户 pin 回执；没有重上传、改 pin、导出凭据或发布 npm。

### 本轮实测与 D-* 结论

机器证据为 [Delivery-verification-results.json](./Delivery-verification-results.json)，可复跑脚本为 [Delivery-verification.mjs](./Delivery-verification.mjs)。

| ID | 当前结论 | 新实测及未满足部分 |
| --- | --- | --- |
| D-S01 | 已有发布步骤完成，保留勾选 | 原 MCP 上传回执仍是历史发布事实；本轮已发布 npm CAR 的三个单根 CID 与回执一致，指定公共 Gateway 的全部 17/15/16 个块逐字节匹配 CAR；当前账户 pin metadata 因认证未复查，不能声称获得新上传回执。 |
| D-S02 | 未完成，重置勾选 | Windows 独立消费者实跑九个公共 CID 用例和两个独立作者用例，11 个 Run 均有 exit/reclaimedAt；授权 Ubuntu 的安装、CLI 和同批执行尚无法当前复验。 |
| D-AC01 | 未完成 | 三个 CID 的 12 篇说明/问题 Reference 和三个 check.json 已通过标准 UnixFS exporter 按 CID 从公共 raw blocks 解析，逐字节/SHA-256 匹配已发布文件；仍缺获授权 Ubuntu 的当前执行证明。 |
| D-AC02 | 未完成，重置勾选 | 两个 GitHub Actions 的发布、provenance 校验回执已重新读取，Windows 通过/非空问题/故障/取消和物理释放已实测，独立作者新检查已构建并实际消费；Ubuntu 全套指定版本、CLI、业务结果和物理释放尚无法当前复验。 |

tools/directories/network 的当前 CAR SHA-256 分别为 `eb4f8c14b3284587471fbea9164af4f4bc5a8466959a8643234daaaebf8a6018`、`0833f5bc181c8a8a86d59ad6ce9617a32357599fa8fdfd1e31b2c19b6cefc47c`、`5ca8f0079b24eb997b37706d62a20b6ce9f38a02058d0b86593170882b93c683`。公开读取由已发布 Engine 的 `createIpfsGatewayClient` 验证块 CID，所有 48 个块与已发布 CAR 一致；Reference 使用标准 `ipfs-unixfs-exporter` 解码公开块，不读取仓库源码、不使用本地 Kubo、不用已下载 CAR 作为公共读取 fallback。

三个 HTTP `/ipfs/<cid>/resources/check.json` 请求依然是 404，已原样保留在新 JSON 中，绝未把它们写成成功。既定标准要求“按实际 CID 读取”，没有要求 Gateway 必须支持 HTTP UnixFS 路径；标准 UnixFS/block 读取已实际证明全部内容完整性，因此 Reference 不再是 Windows 侧的未证实项。这不取消 Ubuntu 要求，也不提出源码修复或更改交付门限。

九个公共用例为 tools 通过/问题/超时故障，directories 通过/问题，network 通过/问题/超时故障/取消。通过结果严格为 `{pass:true}`，问题结果为非空 problems；异常为 failed 且没有业务 result；取消为 stopped、canceled=true 且没有业务 result。物理断言额外确认工具超时 PID 不存在、目录探针文件清单恢复、HTTP 活动请求归零，关闭 Engine 与本地端点并删除本轮独占临时数据库/目录。

独立作者仅复制已安装 `check-sdk@0.1.0` 的 text 示例到仓库外项目，用实际发布的 SDK/Task SDK/Bundle 包构建。构建回执见 [Delivery-author-receipt.json](./Delivery-author-receipt.json)，CAR CID 为 `bafybeicldl4w2juh77ex3adu5hbxebljdnvt6te2many2tgphlkf2uqtqu`，SHA-256 为 `13a43fb808802e0aaedb138d6c2cd1a758fb3f5dbe68357a437453ffb74d9061`。该新检查通过/问题两项由第二个独立 Engine 按 CAR 根 CID 实际执行，两次均有物理释放。它使用本地作者 CAR 块，不冒称该示例已经公共发布或在 Ubuntu 执行。

### 发布回执与复现

[Delivery-release-receipts.json](./Delivery-release-receipts.json) 保存本轮重新查询的 SDK/environment Action 结果：均指向 `61aa5e50e5402e66afb3073b97a990536b2add0e`，实际 Publish package 和 Verify published metadata and provenance 均 success；SDK 完成早于 environment 开始。这是对已发生发布的当前外部查证，不是再次发布。

在仓库之外新建消费者项目，固定依赖：check-environment/check-sdk `0.1.0`，task-sdk/task-engine/task-engine-http/pguide-task-bundle `0.1.0-rc.0`，task-engine-server `0.1.0-rc.1`，TypeBox `0.34.52`，`@ipld/car` `5.4.6`，`ipfs-unixfs-exporter` `16.2.3`。执行 `pnpm install --ignore-scripts`。首次本轮验证不依赖仓库 node_modules；复跑只需要这些公共包、复制的发布示例和网络。

```powershell
$consumer = 'C:\owned\public-check-consumer'
Copy-Item -LiteralPath "$consumer\node_modules\@potential-guide\check-sdk\examples\text" -Destination "$consumer\author" -Recurse
node "$consumer\author\build.mjs"
$revision = git rev-parse 'HEAD:.silvermoon/ideas/01M6NZBYXR81BMP219KRK5DQQC/outer'
node --experimental-import-meta-resolve '.silvermoon\ideas\01M6NZBYXR81BMP219KRK5DQQC\outer\Delivery-verification.mjs' $consumer 'C:\owned\delivery-results.json' $revision
gh run view 42142928328 --repo shazhou-ww/potential-guide --json conclusion,headSha,jobs,url
gh run view 42143360575 --repo shazhou-ww/potential-guide --json conclusion,headSha,jobs,url
```

脚本开发时修正了验收工具自身的 ESM import 条件、可信 caller 的 scope/subject、请求业务字段应在顶层以及 Task snapshot 的 run.runId 路径；最终完整脚本退出 0、11 项实际运行完成。没有据此修改产品实现或掩盖失败。新 JSON 是最终完整复跑的结果，而非早期失败结果的拼接。

本轮仓库 `pnpm check` 已实际运行：sources/layers/format/lint/typecheck 阶段通过，test 在既有 `pguide-task-bundle` symlink 用例报 Windows `EPERM` 后退出 1，pack:check 未执行。首次缺依赖的自动恢复还遇到共享 pnpm store 的 SQLite 损坏；随后用本轮自有 store 完成 frozen 安装，没有修复/删除共享 store 或改宿主配置。可在支持创建符号链接的获授权环境重新运行完整检查；本轮不跳过这些测试、不擅自调整权限。公共消费者脚本的完整实跑退出 0，与仓库测试结论分别记录。

### 阻塞与下一步

恢复条件是上游明确确认获授权 Ubuntu 的设备入口及操作范围；再在独占目录、随机 loopback 端口和保留宿主配置的条件下复验全套指定包版本/CLI、公共 CID/Reference、11 项业务和物理释放。无需重复 npm 发布；不因直接 HTTP 路径 404 而要求改 Engine/SDK。若需要重新核查 Pinboard 账户 pin metadata，另需恢复当前 MCP 授权，不能转抄历史授权或 OAuth 凭据。

当前 D-S02、D-AC01、D-AC02 不满足，不能提交 Outer；没有 submitOuter、acceptOuter 或 completed，也未到 human gate、没有 response.review 验收索引。下列内容均为旧时点的历史证据，不能覆盖本节结论。

## 历史观察：MCP 上传成功，Reference 路径仍待验证

用户恢复 MCP 授权后，已通过 MCP 上传三个正确的完整单根 CAR，全部回执 CID 与已发布 npm 包及原独立执行证据一致。CLI 仍缺少独立 API token；没有复制 OAuth 凭据。最新机器证据见 [Public-delivery-observations.json](./Public-delivery-observations.json)，后文的认证失败和首次安装是历史时点，不再代表 MCP 当前不可用。

Ubuntu 已安装 Engine 从 `https://pinboard.shazhou.work` raw Gateway 实际执行九项：tools 通过/问题/故障，directories 通过/问题，network 通过/问题/故障/取消。九个 Run 均有实际 exit、reclaimedAt，未出现 cleanupUnknown；工具超时子进程不存在、目录探针恢复、HTTP 故障及取消的活动请求归零等断言均在后续失败之前完成。另在 Ubuntu 的独立 npm 项目中，用已发布 SDK 示例构建 text CAR 成功，CID 和 SHA-256 与既有本地独立消费证据相同。

验收脚本随后读取 `/ipfs/<cid>/resources/check.json` 返回 404；三个正确根的 raw 请求均为 200，但这不证明 HTTP UnixFS 路径可用。尚未完成公开 Reference 页面逐字节复验，不能把九个业务用例成功当作整个部署验收通过。当前剩余问题是 Gateway 路径能力与消费方式的契约澄清，而不是 CLI 没 token 导致整个流程无法继续。

本次还发现并纠正验收操作自身的问题：远端手工暂存的是旧 CRLF CAR，监督者又曾给出与正确 CID 不配套的“批准哈希”；已从已发布 npm 包恢复正确暂存并用标准 CAR 读取器核对。期间误上传的操作自有旧 tools pin 已 unpin，但不宣称公开块字节立即消失。一次内联 base64 转抄错误被服务拒绝，修正后才得到正确回执。脚本的未定义 `request` 自由变量在运行时暴露，修为 `submitted.request` 后才完成九项业务用例。

用户要求将全部遇到的问题另建 IDEA，已整理为 [验收问题复盘](../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Acceptance-issues.md)。D-S01、D-S02、D-AC02 现有证据已满足；D-AC01 因 Reference 公开读取未证实保持未完成，原 IDEA 的 Outer 仍不提交或接受。

## 追加交付门限

用户随后授权通过仓库 GitHub Actions 发布 SDK 和 environment 两个 npm 包，并在授权 Ubuntu 设备安装全套 Task Engine，以 `https://pinboard.shazhou.work` 为公共 Gateway 实跑检查。Deployment 已纳入这些要求；D-AC02 因新增证明要求重置为未完成。以下是追加要求之前的本地验证记录，不能替代 Ubuntu 公共 Gateway 验证或 npm 发布回执。

发布候选 `61aa5e50e5402e66afb3073b97a990536b2add0e` 已通过本地完整 `pnpm check`，其 [exact-main CI](https://github.com/shazhou-ww/potential-guide/actions/runs/42141060533) 第二次 attempt 全部通过，包括 Release verification (v1)。首次 attempt 的既有 Node 24 Probe 清理测试失败后仅重跑失败 job，没有修改代码、跳过测试或绕过门限。

## npm 发布与 Ubuntu 实测

以下结果依据同步后的 Deployment 修订 `06d324690e14` 执行。实际观察时间为 `2026-11-06T01:28:01Z` 至 `2026-11-06T01:29:25Z`，完整机器证据见 [Remote-delivery-results.json](./Remote-delivery-results.json)。

- SDK tag `check-sdk-v0.1.0` 与 environment tag `check-environment-v0.1.0` 均指向发布候选 `61aa5e50e5402e66afb3073b97a990536b2add0e`。先完成 [SDK 发布 Action](https://github.com/shazhou-ww/potential-guide/actions/runs/42142928328)，再执行 [environment 发布 Action](https://github.com/shazhou-ww/potential-guide/actions/runs/42143360575)；两者均成功，包括实际 Publish package 和 Verify published metadata and provenance。没有在本机或 Ubuntu 执行 `npm publish`，没有添加 npm token。
- 授权 Ubuntu 为 Node `v24.22.2`、npm `12.2.2`。远端 registry 实际确认两个包的 `0.1.0` 和 `latest=0.1.0`、tarball integrity、SLSA provenance 地址。没有从受策略限制的本机访问 npmjs。
- 全局安装并核验 13 个指定版本：`pguide`、`cli-core` 为 `0.3.0-rc.0`；`task-protocol`、`task-sdk`、`task-engine-http`、`task-engine-storage`、`task-engine-webui`、`pguide-task-bundle`、`task-engine` 为 `0.1.0-rc.0`；`task-engine-server` 为 `0.1.0-rc.1`；`pguide-task-engine` 为 `0.1.0-rc.2`；`check-sdk`、`check-environment` 为 `0.1.0`。原有 ahplex、corepack、npm 未移除。
- 两个 CLI 帮助入口可用；另外实际通过 `pguide task-engine` 启动 Engine 与 Web UI，显式禁用全局配置，使用独占数据库、随机 loopback 端口和指定 Pinboard Gateway。Engine `/tasks` 与 UI HTML 均返回 200。向本次启动的子进程发送 SIGTERM 后，观察到 closed 事件、退出码 0，无长期服务遗留。没有改写用户现有服务配置，也没有安装或启动 Kubo。
- 从已发布的环境包直接调用工具检查，Node 版本检查得到严格 `{pass:true}`。然后启动已安装的 HTTP Task Server，真实提交 tools CID；请求 `01M6Q7GH6SZMYVFA9KGT4D6646` 被拒绝为 `bundle_fetch_failed`。这不是 Check 业务失败，没有产生可声称通过的 Task/Run，九项远端业务用例尚未运行完成。
- 随后从 Ubuntu 使用 Pinboard CLI 对三个 CAR 分别执行显式 endpoint 的 import，全部退出 1，返回 `TOKEN_REQUIRED`。三个 CID 的 raw Gateway 请求实际返回 404、`{"error":"Block not found"}`。CAR 大小、SHA-256、CLI 错误、Gateway 状态与原始提交决定都保存在机器证据中。这里能确认当前块不可获取，不能据此推断 Pinboard 在制品上传后的全部 Gateway 协议兼容性。

因此 npm 发布与安装已经完成，公共 CID 运行仍明确阻塞，全部 D-* 保持未完成；没有 submitOuter 或 acceptOuter。恢复需要在目标 endpoint 安全配置有效 Pinboard token（例如通过 CLI 的 `config set-token --endpoint https://pinboard.shazhou.work --token-stdin`），不要把 token 写入聊天、仓库或报告。原先展示的 MCP 重新授权也不能视为 CLI 自动获得 token。

授权设备的操作目录保留了安装及复测脚本、三个 CAR 和 JSON 回执，位于 `~/.local/share/potential-guide/task-engine-20261106`；临时验证数据库已清理。认证恢复后先按原 CAR 导入、核对 CID，再重跑公共 Gateway 检查和 Reference 读取，不能以本次 CLI/UI 启动成功替代最终门禁。安装过程遵循 npm 默认脚本限制，没有放宽 esbuild 安装脚本权限；没有宣称在 Ubuntu 验证了新的作者项目构建。

## 本地验证时点的结论

- 已完成仓库之外的实际打包消费、独立作者构建，以及真实离线 Kubo、Gateway、HTTP Task Engine 和 Worker 执行。12 个用例通过，14 篇 Reference 按 CID 读取并逐页校验 SHA-256，所有 Run 都观察到实际退出和 reclaimedAt。
- Pinboard 发布被认证前置条件阻塞。三个 `pinboard import` 均返回 `TOKEN_REQUIRED`，没有上传成功回执，也没有 Pinboard 导出或公共可获取性证据。不能用本地 Kubo 代替该门禁。
- D-AC02 的本地独立消费结果与资源证据已满足；D-S01、D-S02 和 D-AC01 保持未完成。没有发布 npm，没有改动共享 IPFS 节点或用户配置。

## 基线与工具

实施与资源基线为 primary 提交 `38d91f9fb96571256149a62f10ac63fd2948030d`。主体世界修订 `2e1857ee95ebd2a8cb4e4661fd82de02347451df` 已由监督者批准，批准事件同步在 primary `319877f63b8961d09c31bde2e344d1c4c1e3e655`。本次检查依据该提交上既有 Deployment 契约执行，未改变其要求。

工具为 Node `v24.11.1`、pnpm `11.22.0`、Kubo `0.43.1-acc53c093`，实际观察时间为 `2026-11-05T16:26:15.296Z`。工具只有临时验证用途，不是长期部署服务。

| 检查 | 最终 CID |
| --- | --- |
| tools | `bafybeieqcbsrb4xfnstoc5fmlhhjefyylpgruk4nfgk36kcuxf2mj6xota` |
| directories | `bafybeihyo3ujmjh7jgtlfwmi6inowbcub4xdi2amj2m23rbv7ik3mzhdbi` |
| network | `bafybeigpnzao2lgpmx2ajfdu4w6uzzd3ovo7rf6gfrdv4dyuwwwepr6oca` |
| 独立 text 作者示例 | `bafybeicldl4w2juh77ex3adu5hbxebljdnvt6te2many2tgphlkf2uqtqu` |

## 独立消费方法与结果

1. 实际打包 SDK、环境库、标准作者工具、Engine/HTTP/server 及内部依赖，在仓库外新建 pnpm 工程，内部包统一覆盖为本次 tarball；真实解析路径均在该消费工程内。只从安装后的 SDK 复制 text 示例，使用安装后的公开 `authoring` 和标准 `buildTask` 构建，不引用仓库源码作为作者或宿主运行入口。
2. 在独占临时目录初始化 Kubo，以 `--offline`、随机 loopback RPC/Gateway 端口启动，确认节点与 Gateway 响应。只向该节点导入上述四个本地 CAR，逐一确认原 CID；启动打包后的 Task Server，通过公开 HTTP 客户端按 CID 提交请求。
3. tools、directories、network 各验证通过和问题结果；tools 与 network 另验证超时故障和运行中取消；独立 text 作者验证非空与空白输入。通过结果严格为 `{pass:true}`，问题结果为非空列表，故障和取消均没有业务结果。完整 Request、Task、Run 身份、终态、exit 与 reclaimedAt 见机器证据。
4. tools 超时和取消后，以已启动子进程的实际 PID 检查进程不存在；目录 write 探针前后文件清单一致；HTTP 超时和取消后受控服务的活动请求归零。全部 Run 确认物理退出与回收，不以回调上报代替释放。
5. 通过本地 Gateway 读取四个 CID 下的全部 14 篇检查与问题 Reference，与实际 CAR 中的页面字节 SHA-256 一致。这里证明本地导入的 CID 可消费，不声称 Pinboard 已持有或公开分发这些块。

工具取消的既有行为需要明确区分：该 Task 的 canceled 为 true，Run 收到 `no_active_demand` 停止请求，子进程实际退出，但现有命令适配器抛出的 `Command cancelled.` 使 Task/Run 终态为 failed，且没有 Result；网络取消终态为 stopped，同样没有 Result。监督者核对了原基线，`src/command.ts` 本次未修改，未为追求统一展示改写既有取消语义。最初验证脚本把所有取消一律预期为 stopped、把不存在的目录预期为 not-directory，这两处测试夹具假设已纠正为既有实际契约后，完整 12 项验证通过；不是放宽结果非伪造或物理清理要求。

## Pinboard 阻塞与恢复条件

目标 endpoint 为 `https://pinboard.shazhou.work`，根页面可达。已分别执行：

```powershell
pinboard import packages\check-environment\dist\bundles\tools.car --name check-environment-tools-38d91f9f --json
pinboard import packages\check-environment\dist\bundles\directories.car --name check-environment-directories-38d91f9f --json
pinboard import packages\check-environment\dist\bundles\network.car --name check-environment-network-38d91f9f --json
```

三条均退出 1，返回相同的 `TOKEN_REQUIRED`：该 endpoint 没有可用 token。尝试发现已有认证的 Pinboard MCP 替代入口时，工具连接已断开，也无法提供可用发布通道。没有搜寻、导出或记录凭据，没有替用户配置认证。

恢复需要为当前执行环境提供该 endpoint 的有效授权，或恢复已授权的 Pinboard 工具连接。届时重新观察准确当前修订，重试上述公开制品导入，核对返回 CID；从 Pinboard 独立导出并验证 CAR，再以导出的制品重跑 CID 执行和 Reference 获取。完成并同步证据后，才可勾选剩余 D-*、submitOuter 并由监督者按授权决定最终门禁。认证缺失不能推断为用户拒绝，也不能当作验收通过。

## 远端 CI 观察

primary 批准提交的 [CI run](https://github.com/shazhou-ww/potential-guide/actions/runs/42063816165) 中，Ubuntu packed CLI 和 isolated package consumers 已成功；Windows packed CLI 的既有 MVP Check 消费验证在等待窗口结束时仍观察到 running，断言预期 completed 而失败。该路径涉及的旧 Check、Task SDK、Engine、MVP consumer 和部署脚本本次均未修改；未通过修改超时或跳过旧测试来掩盖此结果。其余 job 在观察时仍运行，因此这里只声称本地完整 `pnpm check` 与上述独立验证通过，不声称远端 CI 全绿。

## 清理

验证完成后已关闭 Task Server、受控 HTTP 服务和专属 Kubo；没有留下长期后台服务。临时 Kubo、消费依赖和过程数据库仅为本次操作所有，清理不触及共享节点、仓库或其他会话。
