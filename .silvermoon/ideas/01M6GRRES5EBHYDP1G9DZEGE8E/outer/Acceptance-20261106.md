# 当前交付独立验收

## 准备与历史有效性

产品起点为 `3be07d321a57637e9189eda452cfb2f5703eb295`，已接受 Inner 为
`e766edd27d16c247d8ff059021ecb8a08f03c9d9`。现有
[Deployment.md](Deployment.md) 不变；旧 [外部证据](Gateway-Only-External-Evidence.md)
和 [结果](Gateway-Only-Results.json) 固定于 `09f93e45...`，不能直接沿用。
本轮不修改源码、Ideal、Inner，不授权 acceptOuter，不发布 npm。

初次直接运行旧验证器，在任何服务启动前退出 1：
`Missing consumer manifest: @potential-guide/ipfs-content`。
当前公开作者入口已为 `@potential-guide/pguide-task-bundle`，Task SDK 不再导出
`/build`、`/publish`。仅更新 Outer [验证器](Gateway-Only-Verify.mjs) 的离线作者
夹具：通过公开 Bundle build/Car API 生成及校验 CAR，将原始块交给独立 HTTP 内容源；
不访问 Kubo、不模拟服务读取、不声称已执行真实节点 pin。
四个 D-* 恢复未勾选，等待新实测；辅助材料先同步 primary 后观察 revision。

同步 `32180f573098d8db7a33994c5dfc44cd8d2965a7` 后第二次运行完成生产安装，
但发现阶段继承的宿主 PATH 中另有全局 `pguide-task-engine`，按公开协议正确报
`Ambiguous command task-engine`，尚未启动服务。进一步隔离运行期 PATH 为
本次 consumer binary、当前 Node 目录及系统工具目录，保留安装期包管理器 PATH；
不修改宿主 PATH 或移除全局 binary。此辅助材料修正亦先同步再证明。

第三次运行的离线作者夹具尝试 CommonJS 条件解析 ESM-only `@ipld/car`，
在服务启动前被 export 边界拒绝；改为仅使用公开 `validateContentCar` 返回的
blockstore 迭代块流，不绕过 package exports，不更改产品。

上述 blockstore 迭代会规范化 codec，不能作为原始 CAR 块 CID 的证明；
根路径诊断第一次请求的 404 因此属于夹具错误，不能归因产品。
最终使用 Node `--experimental-import-meta-resolve` 的 ESM 条件解析，
从公开作者包所在位置导入其声明依赖 `@ipld/car` 的公共入口，
由 CarReader 保留 CAR 原始 CID/字节，同时保留公开 CAR 校验。

跨盘临时目录的首次尝试被既有同盘路径安全断言拒绝，未启动进程或写入夹具。
改用新建的仓库外同盘独占目录，未放宽断言。

## 宿主与仓库验证

Windows，Node `v24.12.0`，pnpm `11.22.0`。
`pnpm run build` 首次触发缺失依赖恢复，但共享 store 返回
`ERR_SQLITE_ERROR: database disk image is malformed`；不修复共享 store。
随后使用本工作区独占 store，`pnpm install --frozen-lockfile --store-dir <owned-store>`
退出 0，`pnpm run build` 退出 0。

`pnpm check` 退出 1：已通过 sources/layers/format/lint/typecheck，test 阶段
`@potential-guide/pguide-task-bundle` 五项 symlink 测试被 Windows 宿主以
`EPERM: operation not permitted, symlink` 拒绝，Turbo 中止，pack:check 未执行。
不更改宿主权限、全局配置或产品代码，也不把该结果记为全库通过。

## 复现

在新建、空的同盘仓库外目录执行：

```powershell
$source = 'D:\Code\potential-guide.worktrees\task-engine-server-config-validation'
$env:npm_config_store_dir = '<本次独占 store>'
node "$source\.silvermoon\ideas\01M6GRRES5EBHYDP1G9DZEGE8E\outer\Gateway-Only-Verify.mjs" $source <精确产品 HEAD>
```

运行器使用两个独立生产安装、随机 loopback 端口、新 DB、隔离用户 JSONC，
只停止自身追踪的 PID。

## 最终实测与阻塞

最终产品来源为 `c010cba5234ca07a75ec315264eee40416c81186`，
运行前同步并观察的 Outer revision 为
`d72dc8a439eb8d9d347e24d6a56048f4d1c403f7`。
该来源相对起点仅有 Outer 验收材料和其他 Idea 的文档变更，未改变产品代码、
已接受 Inner 或 Ideal。

完整运行器退出 **1**：[Acceptance-Results.json](Acceptance-Results.json)。
16 个本地 tarball 在两个仓库外生产 consumer 中完成安装和物理依赖图核验，
runtime 无作者 SDK；标准 CAR 的 7 个原始 CID 块经离线校验。
作者 callback、600,000-byte 资源文件、Bundle 目录及 CAR 在服务启动前已删除。
首个 `--ipfs-gateway-url http://127.0.0.1:<port>/good` 场景未产生 ready，
stdout 为空，stderr 为
`Invalid configuration or service startup failed; cleanup unconfirmed.`。
该失败发生在任何 Task 提交前，完整四层/内容拒绝/生命周期矩阵未运行，不报全绿。

[Startup-Diagnostics.json](Startup-Diagnostics.json) 单独重现两种公开入口：

- 合法 Gateway 子路径：两入口均退出 1，无 ready、无新 DB。help 宣称支持 base path，
  但真实 CLI 启动失败；已不存在的源 URL 不影响该启动期拒绝，完整运行器已在源在线时证明同一失败。
- 缺 URL：两入口均退出 1，明确提示必须显式提供 Gateway。
- 退役 `--ipfs-transport=gateway`：两入口均退出 1，明确给出迁移提示。

仅作失败定位的 packed `parseArguments` → `resolveConfig` → `startService` 调用，
在相同合法子路径上返回
`IPFS endpoint must be an HTTP(S) Gateway base URL.`。
补充检查确认运行库要求 `endpoint.pathname === "/"`；
这不是源码替代验收，而是对上述真实失败的最小修复范围定位。
需实现侧协调 Gateway base path 支持和 CLI 可定位错误诊断，部署阶段不擅自改源码、
不把要求改成只支持根 URL 来放行。

### 根路径对照，不替代完整合约

在同一安装产物中，独立执行已同步的
[Diagnostic-Verify.mjs](Diagnostic-Verify.mjs)，退出 **0**；
[Diagnostic-Results.json](Diagnostic-Results.json) 记录四个成功场景：
两种入口各 Engine-only / Engine+UI，实际 HTTP ready、`GET /tasks` 200，
每个场景执行一个真实 Task，严格返回：

```json
{"message":"gateway-only-external-proof","resourceBytes":600000,"resourceSum":25200000}
```

UI HTML、bootstrap 与携带 CSRF/binding 的公开 HTTP Task 读取均 200，
恶意 Origin 被 403 拒绝。源收到 32 次 raw GET，另 4 次为关闭后生存探针；
不启动/安装/接管 Kubo，不执行作者写入或 pin。
四个服务均沿产品 SIGTERM event 路径 graceful `closed`、退出 0；
Engine/UI 关闭后不可达，而独立内容源仍可达，最后关闭本次内容源及 named pipe。
Windows 使用本次 PID 的 preload/named-pipe 控制，非 OS 原生 POSIX signal 证明。

根路径诊断的首次自造 ULID 因 admission floor 正确被拒绝，属于夹具错误；
随后使用当前时间 ULID 和新 DB。另一轮因 blockstore codec 规范化得到的 404
也仅属夹具错误。最终结果来自修正后独立重新运行，未重标旧失败或复制历史通过。

| 当前 D-* | 实测结论 |
| --- | --- |
| D-S01 | **未通过**。独立发现、参数/根 Gateway 启动与缺 URL/退役 flag 拒绝已证明；合法子路径启动失败，四层及其余负向矩阵未完成。 |
| D-S02 | **部分证明，未通过**。两入口 Engine-only/UI、四个精确 Task 结果、HTTP 边界与关闭隔离通过；坏块/超限/不可达及占用 UI 回滚未完成。 |
| D-AC01 | **未通过**。无需 JS 模块的参数启动成立，但全部配置来源和 base path 合约未满足。 |
| D-AC02 | **部分证明，未通过**。无 Kubo 的真实块读取/Task/UI/关闭已证明；完整失败和配置指纹矩阵尚未完成。 |

### 清理与交接

完整矩阵失败后的独立 HTTP 源由运行器仅对其自身 PID `49624` 强制停止；
该事实保留在 JSON，不冒称完整矩阵的源 graceful 退出。
对照诊断四个服务无需强制停止；`errors=[]`、`forcedOwnedPids=[]`。
两份最终结果均已补充 `finalOwnedPidAbsenceVerified=true`、
`externalRootRemoved=true`；完整运行器 `trackedChildrenRemaining=0`，
真实用户配置指纹保持不变。

五个明确命名的外部运行目录逐一核对 purpose/sourceCommit marker 后删除，
记录 PID 全部只读确认不存在，再删除首次跨盘尝试留下的空目录。
未终止任何其他用户/会话进程、未触碰其服务或配置。
独占 pnpm store 用后单独清理，不修复共享 store。

[Acceptance-Check.txt](Acceptance-Check.txt) 保留本轮 `pnpm check` 实际 test 阻塞摘录；
本轮不声称全库通过。四个 D-* 保持未勾选。全部 Outer 候选按
`silvermoon check --worktree` / `--staged` 验证后普通提交及同步，
并正常 merge 并发 main 历史。**未 append submitOuter，未 acceptOuter，未记录 completed**；
当前是 downstream 的部署阻塞交接，不是 human acceptance gate。
