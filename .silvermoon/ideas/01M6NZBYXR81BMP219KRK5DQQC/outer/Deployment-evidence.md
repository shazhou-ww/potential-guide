# 部署验证与 Pinboard 阻塞

本文对应 [Deployment.md](./Deployment.md)。实施已经监督者依据用户授权独立复验、接受并同步；现实世界尚未完成，不提交或接受 Outer。机器证据见 [Deployment-results.json](./Deployment-results.json)。

## 最新观察：MCP 上传成功，Reference 路径仍待验证

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
