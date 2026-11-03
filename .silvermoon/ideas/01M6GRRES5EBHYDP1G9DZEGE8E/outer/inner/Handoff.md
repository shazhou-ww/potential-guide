# Task Engine 服务命令实施交接

## 检查点性质

2026-11-03，用户要求阶段性提交并换机器继续。实现代理已停止写入并清理其拥有的测试进程，
当前保存的是**未完成实现**，不是通过验收的发布候选；不得把已构建等同于行为正确。

- Idea: `01M6GRRES5EBHYDP1G9DZEGE8E`，alias `task-engine-server-config`。
- 已接受 Ideal: `6c72d05bb29672035ebc6477fa5f890fbdd6bd39`。
- 已同步的构想验收提交: `cf6751a0ec56dc9a6e21887875fc98a0c170407b`。
- 最新生命周期为 `implementing`，control `downstream`；最近事件为 `acceptIdeal#5`。
  该事件之后尚无 `submitInner`、`acceptInner`、`submitOuter` 或 `acceptOuter`。
- 三个门禁仍为 `explicit`，没有豁免。用户已明确委托当前执行者负责所有门禁审批，
  无 blocking issue 不需逐项询问；审批必须基于准确修订和真实验证，不能据此提前宣布完成。
- 本次暂停检查点仅推送到 `origin/agents/task-engine-server-cli-config`，不将未验证实现推到 primary。
  分支仍跟踪 `origin/main`，以保留 Silvermoon 的 primary 关系。

本文件是 Inner World 的进度与交接证据，不是第四份契约，也不记录任何接受事件。
权威要求仍是 [Idea](ideal/Idea.md)、[Configuration](ideal/Configuration.md) 和
[Implementation](Implementation.md)。[ledger](../../ledger.md) 的 I/D 项全部未勾选。

## 已落地的部分实现

| 表面 | 当前改动 |
| --- | --- |
| 新服务命令 | `apps/pguide-task-engine` 提供 `@potential-guide/pguide-task-engine`、`pguide-task-engine` binary、设置描述、help/metadata、配置解析、前台装配及三份测试。 |
| pguide 分派 | 为 `task-engine` 单独允许 `--config` 透传，并在 `--no-global-config` 时跳过用户主配置的发现来源；未恢复其他命令的全局 `--config`。 |
| cli-core | `loadConfig` 增加 user/project 来源选择；配置路径存在但不是文件时明确拒绝；生成内置 task-engine 设置描述。 |
| 可选 UI | UI app 增加可消费 package exports、类型和资源文件声明；服务经公开 HTTP 连接 UI，不把 Engine 注入 UI。实际打包消费尚未验证。 |
| IPFS 适配 | `createIpfsClient` 的 block.get 增加字符串 CID 转换，以匹配服务注入接口；需要相关回归测试。 |
| 旧 CLI | 删除 `task-engine-server` 的 bin 声明、模块配置入口和执行模块专用测试；Server 程序化 API 保留。迁移与打包清理尚未全部核验。 |
| 文档与构建 | 更新服务指南、示例 YAML、部分消费者脚本、包分类、设置生成、发布清单声明与 lockfile；没有执行 npm 发布。 |

### 当前实现采用的细节

- 四层服务配置为显式 CLI > 指定 YAML/JSON > pguide 用户 JSONC > 默认值；
  项目文件不参与服务配置。用户配置使用完整键 `task-engine.ipfsRpcUrl`，
  服务文件使用单层 `ipfsRpcUrl`，CLI 使用 `--ipfs-rpc-url`。
- `--cwd` 或进程 CWD 是有效 CLI 基准；文件内路径按各自目录解析。
  每个启用层校验后再覆盖；`uiOptions` 是完整对象替换，不深合并。
- 当前配置字段包括 host、port、database、ipfsRpcUrl、scope、ui、uiOptions。
  `--ui`/`--no-ui` 控制 UI；`--ui-options` 接收完整 JSON 对象。
  这些是部分实现选择，仍需按已接受契约验证，不是额外的用户验收事实。
- 默认本机地址 `127.0.0.1`，支持 `localhost` 归一和 `::1`；
  本地 Caller subject 为 `local-cli`，scope 默认 `local`。
  Host/Origin、Fetch Metadata、方法、JSON 写请求和 scope 策略已有初版。
- 默认不启动 UI；服务输出 ready/closed JSON 事件，前台处理 SIGINT/SIGTERM。
  CLI 测试的退出链路尚未通过，不能依赖该声明作为清理已正确的证据。

## 验证记录与限制

实施环境为 Windows、Node `24.12.0`、pnpm `11.22.0`。
以下构建与测试结果由已停止的实现代理报告，交接整理未重跑完整套件：

| 命令或检查 | 结果 |
| --- | --- |
| `pnpm install --reporter=append-only` | 依赖清单变更后执行，通过。 |
| `pnpm exec turbo run build --filter=@potential-guide/pguide-task-engine --filter=pguide --output-logs=errors-only` | 最后一次通过，25 个任务；之前的编译失败已修正后重建。 |
| 较早的服务测试 | 2 通过 / 2 失败；配置矩阵和本地策略通过。失败涉及当时未构建的 CLI 产物，以及 fetch 重写 Host 导致的测试断言。后者已改用原生 HTTP，但最终完整运行未完成。 |
| `pnpm --filter @potential-guide/pguide-task-engine test` | 后续运行在 `test/cli.test.ts` 挂起；用户要求暂停后终止自有测试进程树，无最终通过结果。 |
| `git diff --check` | 交接整理时通过。 |
| `silvermoon check --worktree` | 暂停的代码快照检查通过；只证明 Silvermoon 结构/历史，不证明产品正确。 |
| 格式、lint、完整回归、`pnpm check`、独立 tarball 消费 | 尚未运行，不得填写通过。 |

此前父会话曾遇到文件分类/原生清理测试失败和隔离后消失的 V8 崩溃；
这些只是历史信息，不能作为本检查点失败的免责依据。恢复后须重新验证并区分基线，
不得顺带修复无关问题。

## 下一步顺序

1. **先解决 CLI 测试挂起。**
   检查 `apps/pguide-task-engine/test/cli.test.ts` 的 readiness、IPC wrapper、
   pguide 分派子进程与 `exited` 等待；给退出和失败清理加有界断言。
   Windows 的 `child.kill("SIGTERM")` 不等价于 Node 收到可处理的 POSIX signal。
   只清理该次测试实际创建的 PID，不按进程名杀进程。
2. **补齐真实可消费的包边界。**
   核对新 app packages 是否进入包验证 inventory 和独立消费者场景；
   现有验证脚本仍有仅扫描 `packages` 的假设。核验 UI exports、静态资源、声明文件、
   workspace 依赖打包后的解析，以及删除旧 CLI 后是否仍残留旧 dist/main 产物。
   不要将 public manifest 声明误当作 npm 发布授权。
3. **完善直接入口迁移与行为验证。**
   `docs/task-run-logs.md` 仍引用旧 CLI；UI 指南仍描述 private-only 包，
   pguide 指南尚需服务入口说明。验证顶层发现与独立 binary 的配置矩阵、禁用全局、
   项目层排除、非法覆盖值、路径锚点、UI HTTP 代理、跨站拒绝、失败回滚和退出。
   复核共享 cli-core/pguide 与 IPFS client 的回归，不只验证新命令。
4. **格式化并执行验证。**
   先运行最小相关构建/typecheck/test，再执行 `pnpm check` 和打包消费。
   不重跑已知会无限等待的测试而不增加诊断/边界。
   把确切命令、结果、必要日志摘要写入 Inner World 证据，按实际完成情况更新 ledger。
5. **达到实施门禁后再同步 primary。**
   先整合 primary 的并发历史，保留父会话 Task Bundle 改动；
   完成 worktree/staged 校验及普通提交同步，取得准确 implementationRevision，
   再由负责审批的执行者记录 `submitInner` 和基于验证的 `acceptInner`。
   本次用户要求的暂停检查点不是可直接推到 primary 的完成候选。
6. **随后才进行 Outer 独立消费验证。**
   细化并先同步 [Deployment](../Deployment.md)，再使用本地产物、隔离配置、
   随机端口和新数据库证明两种启动模式及非敏感 Bundle 的真实执行。
   原有 D 项仍未开始，不得根据构建/单元测试提前勾选。

## 在另一台机器恢复

先取得本检查点分支并建立新的独立 worktree，例如：

```powershell
git fetch origin
git worktree add -b resume/task-engine-server-config D:\Code\potential-guide.worktrees\task-engine-resume origin/agents/task-engine-server-cli-config
Set-Location D:\Code\potential-guide.worktrees\task-engine-resume
git branch --set-upstream-to=origin/main
```

选择本机尚不存在的路径/分支，不重用父会话 checkout。先检查干净状态、primary 差异，
加载 Silvermoon skill，再运行：

```powershell
silvermoon whats-next 01M6GRRES5EBHYDP1G9DZEGE8E --audience agent
```

由于检查点尚未进入 primary，报告可能先要求协调历史。保留该检查点和并发 primary，
不要通过 reset、force push 或把半成品直接推 primary 来消除提示。
用户的阶段暂停要求优先：先在隔离分支完成剩余实现/验证，再恢复正常门禁同步流程。
新机器恢复依赖后重新构建，不依赖旧机器的 node_modules、dist、缓存或绝对临时路径。

## 环境隔离与清理

- 本次实现代理已停止写入，报告所有自有测试 PID 均已退出；
  其残留的单个 `service-cli-*` fixture 已清理，没有要在新机器接管的进程。
- 未启动 Kubo；没有操作父会话 3000/4310/5001 服务或 `E:\ipfs`。
  原服务当前是否运行不构成接管授权；继续时同样不能停止、重启或覆盖它们。
- 父执行者仅下载了官方 Kubo `0.43.1` Windows amd64 验证工具并核对 SHA-512 与
  GitHub release SHA-256，没有初始化 repo 或启动节点。它不在 Git 检查点中，
  新机器需取得适合自身平台的官方工具并重新校验，不依赖旧机器 session 目录。
- Windows 历次工具来源为
  `https://github.com/ipfs/kubo/releases/download/v0.43.1/kubo_v0.43.1_windows-amd64.zip`，
  该资产 SHA-256 为 `c25871516dec4d97ce1d160a26c1e3fdad294cb0eea065c0c0343bcfca86c524`。
- 不管理用户 Kubo 生命周期、IPFS_PATH、pin/GC，不发布 npm，不自动改写用户配置或旧数据库，
  不恢复已移除的公开 Bundle 缓存 API/UI。
- 同级 Bundle 作者工具 Idea `01M6GWRMT65XKB6QZKPYE6JEXD` 由另一会话负责；
  本分支不实现 `pguide task-bundle`，也不修改其生命周期。
