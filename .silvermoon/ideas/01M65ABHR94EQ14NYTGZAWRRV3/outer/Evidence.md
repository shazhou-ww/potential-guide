# 独立消费部署验证

本文件服务 [Deployment.md](Deployment.md)，仅记录 Agent 的外部验证，不代表 acceptOuter。
全部 D 步骤与标准已有实测证据，未改动已验收 Inner World 或生产源码，未发布 npm 包。

## 准确的被测候选

- 已验收 implementationRevision：`4db53c32aa9765262fd0a67626eba114e5e08ae7`。
- 原实现验收提交：`979204e9f836eb15be2fe95f8a9b339f7f88b4a9`。
- 已同步后才执行检查的 deploymentRevision：`e2f1804ec03485128fc69f25e7d2e5201b9ef505`。
- 对应 primary/harness 提交：`c544ba717e1098bfad85d3499e31f302085f0f4c`。
- 被测 packages tree：`b7b9ad4ff41ef3421676cfe8cd61b658f0a1c977`。
- 最终运行：2026-10-30 **07:20:38.808Z–07:21:06.682Z**；
  Windows x64、Node **24.11.1**、pnpm **11.22.0**。

以上契约与 harness 均先同步并重新观测 revision，再执行外部检查。
此后只补充本报告、原始结果和 D 清单；契约与 harness 没有再改动。
最终提交的 Outer revision 包含这些新增证据，不冒充测试前自包含的 revision。

## 实际执行与独立性

准确命令（退出码 **0**）：

```powershell
node .silvermoon\ideas\01M65ABHR94EQ14NYTGZAWRRV3\outer\verification\verify.mjs --external-root D:\Code\check-server-mvp-deployment-20261030-a4 --revision e2f1804ec03485128fc69f25e7d2e5201b9ef505
```

完整原始证据在 [verification/results.json](verification/results.json)：
`commands` 保存每个 pack/install/执行命令、cwd、PID、退出码、耗时和输出摘要；
`packages` 保存实际 tarball SHA-256、名称、版本与对应 Git source tree；
`consumers` 保存真实安装图及 API/进程原始观测，`cleanup` 保存独占标记与删除证明。
重跑必须另选此前不存在的仓库外目录，并传入当前已同步的 Outer revision。
tarball 摘要标识本次实际安装的 bytes，不能以相同 SemVer 替代后续重打包的摘要验证。

三个消费者都有自己的 package.json、`packages: []` pnpm workspace 和指向本次真实
tarball 的覆盖，使用 `pnpm install --ignore-scripts --prefer-offline --no-frozen-lockfile`。
递归解析每个实际父依赖并检查 realpath 必须留在该独立 consumer 内；
所有内部 workspace range 已物化，无源码路径、工作区 node_modules 或旧 Host 包。

| 外部消费者 | 实际安装包数 | 结果 |
| --- | ---: | --- |
| `contracts` | 16 | Checker/Objective manifests、全量文件、Git-tree digest、References、mapping、输入和结果；无 IO |
| `generic` | 5 | 只有通用 task 五包；程序化/真实 CLI、鉴权、HTTP/SSE、历史及 fatal startup |
| `check` | 22 | Check + Server 组合、共享取消、七类失败、物理回收、SQLite 独立进程重启 |

纯契约在禁止网络、写盘、worker/process API 的独立进程中运行；
禁止调用计数实际为 **0**，包括预期抛错的负例。`registerHooks` 记录真实导入图，
仅观察到 `node:crypto`、`node:process`、`node:buffer` 这些 builtin；
没有准备层、旧 root、archive/build、filesystem、网络或 worker 模块。
安装图则如实包含 **esbuild 0.28.2、@esbuild/win32-x64 0.28.2、tar 7.5.22**。
无导入副作用不等于免安装构建工具；未宣称这种隔离。

## 不可变包与制品

八个包的完整摘要均在 `results.json.packages`；两个新交付包为：

| 包 | 版本 | 本次 tarball SHA-256 |
| --- | --- | --- |
| `@potential-guide/task-engine-server` | `0.1.0-rc.0` | `2048e0d464da8ec6b947dbd66e12ba3f3cd0c3894f1497a502f98aecb81459a6` |
| `@potential-guide/check-task` | `0.1.0-rc.0` | `12d4251a2d0caf4b520cfa7d9e4f9ab0426a333f0dca646d83ce404ca8c644a6` |

Check fixture 使用独立安装中的公开 author API 创建及打包：
来源身份 `https://deployment.invalid/checker.tgz`，
准确内容 digest `sha256:52c61c02c83b019d0437e4a8fff3c69bf9a8aa50c8584ac0b7234733cae78242`。
来源由受信任本地 archive resolver 授权映射，不是假装运行远端 HTTPS 制品服务。
每个请求、缓存命中与恢复分配仍通过 source scope 授权；错误 scope 明确失败。
另有完整合法但要求 Node 999 的制品，以及真实替换制品
`sha256:8a2d7e42de7443e09a4e795afeaf2882ae02394f0afca78619355ab87c7720d3`。
完整 archive transportDigest 也保存在原始记录中，未混同内容 digest。

## D-S01 / D-AC01：独立消费闭环

- 无制品类型与 Check 均通过程序化独立进程和已安装包的实际 CLI 入口运行；
  安装的 executable shim 也实际执行 `--help --format json`，不是源文件入口。
- 真实 HTTP 返回：无认证任务/SSE **401**，错误 scope 任务/SSE **403**，
  reader 的提交/取消 **403**，请求企图选择任意 module **400**。
- Check `ok:false` 以 **completed** 正常读取；准确 digest 不符、损坏 archive、
  runtime 不可用、来源 scope 拒绝、执行异常、非法结果、defer 清理失败均显式区分，
  错误 Task 没有假造 result。
- 两个独立 Request 共享同一 Execution；取消一方不伤另一方，存活方正常完成。
  三次 SSE 断线续接与同 requestId 重提后，执行 journal 的实际调用仍为 **1**；
  冲突重提 **409**。历史以 `limit=1` 遍历，sequence 无重复。
- 记录包含原始 snapshot、cursor、帧和 history sequence，不只记录最终断言摘要。

## D-S02 / D-AC02：物理退出与恢复

- 实际记录 **10 次 Worker 创建、9 次 Worker exit 事件**。唯一没有 exit 事件的是
  故意 crash 的服务器中的未知执行；其整个 OS 进程退出并确认 PID 不存在，
  不把 crash 伪装成 worker 的正常 dispose。
- 其余独立进程的单槽事件序列均断言先收到前一个真实 worker-exit，才有下一个
  worker-start。清理后各自 owned snapshot 目录为空。
- owned 子进程 **PID 6340** 的泄漏导致执行失败；在下一真实 Worker 创建点
  （服务器 PID 34632、threadId 6）直接 OS 查询确认该 PID 已不存在，然后才证明容量复用。
  原始 `reuseObservation` 保存 `previousOwnedAlive:false`，不是统计计数推断。
- 活动 SSE + CPU-bound worker 的服务器通过 IPC 请求 `server.close()`：
  worker 物理结束、SSE 正常结束，服务进程自然退出码 **0**，没有调用
  `process.exit(0)` 或测试方强杀来制造成功关闭。
- SQLite crash/restart 保留原 Request/Task/Series/Execution ID 和 deadline；
  未知 running 工作为 **execution_interrupted**，journal 显示没有重跑。
  queued Task 保留原身份/期限并执行原字节；尽管来源 archive 已换成 replacement，
  下载记录数量仍是 **6→6**，结果仍报告 **original**。
- CLI 失败回滚保留 interval 的真实复现约 **175 ms** 自行退出：
  `code:1, signal:null, ready:false, closed:false, harnessKill:false`，
  stderr 明确包含 startup/rollback failure 与清理超时，不伪造回收成功。

正常/CLI/fatal/crash/restart 七个本次服务器 PID 为
**19416、21036、30704、34632、28452、20384、45064**，均已确认消失。
已确认消失的 owned child 不再参与后续兜底 kill，避免 PID 复用风险。
唯一标记核对后整个 a4 外部目录删除成功；a1/a2/a3 先前目录也逐一确认不存在。
最后按本次外部路径标记检查进程，无本次遗留 helper/server。
不删除其他用户目录或共享 pnpm cache。

## 平台边界及验证历史

Windows `ChildProcess.kill("SIGTERM")` 强制退出真实 CLI；
记录 `gracefulSignalProven:false`，不宣称 POSIX signal handler 已实测。
正常退出的独立程序化进程另用 IPC 验证；没有将 Windows 强杀结果替代正常关闭。
纯契约动态导入观察使用本机 Node 24.11.1；不修改产品 Node 最低版本契约。
本次不是生产环境部署、远端制品服务测试、npm 发布或 Probe/Regulate 验证。

首次 a1 仅因 harness 的 Windows cmd 参数转义失败，尚未打包首包；
原始失败及清理证明在 [attempts/shell-quoting.json](verification/attempts/shell-quoting.json)。
修正后 a2 全部通过；强化零 IO 计数/PID 安全后 a3 全部通过；
最终增加物理退出先于复用的直接观察并先同步，再运行 a4，全部通过。
这些修订均局限 Outer harness。与实现验收提交比较，生产目录及 Inner World
`git diff --exit-code` 为 **0**；无需重复未变更代码的 `pnpm check`，
但本次外部安装和验证确实重新执行，未用 Inner World 或 `.cache` 证据代替。
