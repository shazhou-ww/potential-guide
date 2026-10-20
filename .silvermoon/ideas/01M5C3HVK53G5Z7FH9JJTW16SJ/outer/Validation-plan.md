# 本机独立消费者部署验证计划

## 执行前置

1. 本契约及 consumer-validation.mjs 必须先通过 Silvermoon worktree/staged 验证，普通提交、同步 primary，并用 `whats-next directory-context-objectives --audience agent` 取得准确 deploymentRevision。accepted Inner 保持 `61ecfc89b1208bca68ca7ec98e8caf2adf4f77ea`。
2. 使用既有 `pnpm build` 重建 dist，保留 Build.log；不安装依赖、不发布。全局 `pguide`、`pguide-config` 是指向本 worktree 的已有 junction，不另装 registry 包。
3. 全局目录为 `C:\Users\Wei\AppData\Local\pnpm\bin`。验证程序检查实际 package junction，使用本机 npm 已有 cmd-shim 仅创建缺少的 pguide-objectives/.cmd/.ps1；存在不明同名项则停止，不覆盖。真实用户 config/objectives 只在内存比较字节，结果仅保存“不变”的布尔结论，不保存内容或其哈希。

## 可重放命令

以下命令在仓库根目录、计划已同步且重新观测后执行。`<plan-revision>` 为该次精确 Outer tree OID；全局 package/cmd-shim 参数可按既有安装位置显式给定，不改变产品。

```powershell
pnpm build
node .silvermoon\ideas\01M5C3HVK53G5Z7FH9JJTW16SJ\outer\consumer-validation.mjs --plan-revision <plan-revision> --global-bin C:\Users\Wei\AppData\Local\pnpm\bin
```

程序默认从该目录的 node_modules/pguide 验证 junction；若本机布局不同，仅调整 `--package-root`。`--cmd-shim` 可指定当前 Node/npm 已安装的 cmd-shim 入口。验证资源不是产品补丁；资源有实质变更时先重新同步、观测，再运行。

首次运行的验证资源使用 CommonJS require.resolve 定位 ESM-only 公共桥接包，在创建 scratch/全局接线前明确失败，见 Consumer-execution.log。资源已改用 Node 24 的 findPackageJSON 和安装包公开 import export，并额外记录桥接包版本及编译入口 SHA-256；没有更改产品。修订资源重新同步、观测后才重跑检查。

## 场景与断言

- 独立 plain Git consumer，无 package.json/pnpm-workspace；根和普通子目录分别发现，没有父级继承。另一个 Git worktree 保持相同逻辑 repository，不同 checkout/目录 subject。
- 用户级和目录级各有 Unit/参数化目标；缺省 Unit 与非空输入、patternProperties 非 Unit、缺参/类型、同名消歧、投影错误、缺失声明、非法 target、旧 manifest ID、不可取回来源均有实际 CLI 结果。readonly discovery 含不可达远程 URI，但不解析它，不执行检查或 Agent。
- 仅在隔离用户目录以显式完整声明迁移 fake legacy alias，验证其他别名保留；不迁移真实用户数据。
- Probe 只观察；受信 fake ACP 仅能写预先允许的 fixture marker。直接 regulation 完成一次有限修复。仓库消费者读取两个子目录的 objectives.yaml，经已安装 public projection/schema API 和来源 IPC 观察依赖；阈值来自消费者，不在清单中。根先 handoff，再由实际 supervise 推进两个子目标并重新观察根。
- 对照实际 Git 对象验证资源/References 更新改变 folder tree、无关提交只改 retrieval commit/support tree。continue 在同名声明和来源更新后仍读取原快照；schemaVersion 2/伪造恢复证据拒绝。
- 实际全局 CLI 持续 supervise：portfolio 内容不变，root 脚本从 v1 更新到 v2，再仅更新独立 dependency 的脚本。观察日志和最终报告必须证明 root 与 dependency 的 commit/tree 对应正确，稳定 terminal 不由旧结果代替。
- 不选择 publish fixture；其标记不得出现。检查真实用户文件和原 shim 不变、所有 CLI 有界退出、fake Agent PID 结束与 scope 来源缓存为空。

## 所有权与证据

scratch 仅在当前仓库 `.cache` 下以 `dco-deploy-` 加随机后缀创建；路径创建后归本操作所有。每个 CLI 有硬超时，supervise 自带有限 duration，硬超时时仅按记录 PID 树处理，不使用进程名。正常完成后删除本次 scratch，不 broad clean。

Consumer-results.json 保存计划 revision/commit、已接受 Inner、全局真实路径、命令参数/返回值、Git 对照和逐场景结果；consumer log 保存简洁摘要。所有目标、Agent 和 marker 都是安全 fixture。安装的 Node/CLI/公共桥接 API 属于单独记录的执行环境，不属于 Pilot tree。最终证据完成后同步新的准确 Outer revision，再 append submitOuter；不记录 acceptOuter。
