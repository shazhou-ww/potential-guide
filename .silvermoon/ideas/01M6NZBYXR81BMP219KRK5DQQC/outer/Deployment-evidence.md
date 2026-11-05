# 独立消费验证与发布阻塞

本文对应 [Deployment.md](./Deployment.md)。实施已经监督者依据用户授权独立复验、接受并同步；现实世界尚未完成，不提交或接受 Outer。机器证据见 [Deployment-results.json](./Deployment-results.json)。

## 当前结论

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

## 清理

验证完成后已关闭 Task Server、受控 HTTP 服务和专属 Kubo；没有留下长期后台服务。临时 Kubo、消费依赖和过程数据库仅为本次操作所有，清理不触及共享节点、仓库或其他会话。
