# 独立目标验证

## 契约与版本

本次执行遵循运行前已同步的 Deployment 契约树
`71dd6bff6dfb369a0c155ac15d109fb7def2f595`。步骤与验收标准没有扩展；
以下是 D-S01/D-S02 及 D-AC01/D-AC02 的外部结果，不改变已验收 Inner World。

- 已验收 implementationRevision：`a27454928d7ef289f36c3b0bbb17903e42374f7d`。
- 父会话 acceptInner：primary `0089cc198eea48911e3421434e1d5a61d1617d36`。
- 可信检查器与独立真实目标均固定源码 commit：
  `65c14f1dff3e169c917d2cf67c093d2a16e59df4`，包含上述准确实现修订。
- 两个 checkout 由普通 `git clone --no-hardlinks --no-checkout` 创建，并
  `git checkout --detach` 到相同准确 commit；不是实施工作树，不是虚构 fixture revision。
- 控制机 Windows，Node `v24.11.1`、pnpm `11.22.0`，NRM 为 microsoft。
- checker 与 target 分开；checker 源码 clean，target 不安装依赖、不执行 scripts。
  checker 构建产物从同 revision 的可信构建按包复制到 target 的 ignored dist，
  明确作为已构建文件证据，不把配置脚本存在当作产物存在。

## 检查器准备与真实入口

会话目录下的 `outer-checker` 是可信构建位置，`outer-target` 为独立真实目标，
`outer-browser-worker` 为不含生产配置的隔离修复样例；准确绝对路径在
[执行摘要](./external-evidence/validation-summary.json)中。

准备命令：

```powershell
git clone --no-hardlinks --no-checkout <local-repository> <outer-checker>
git -C <outer-checker> checkout --detach 65c14f1dff3e169c917d2cf67c093d2a16e59df4
git clone --no-hardlinks --no-checkout <local-repository> <outer-target>
git -C <outer-target> checkout --detach 65c14f1dff3e169c917d2cf67c093d2a16e59df4
pnpm install --frozen-lockfile --offline --store-dir D:\.pnpm-store\v11
pnpm build
git remote set-url origin https://github.com/shazhou-ww/potential-guide.git
```

第一次 offline restore 使用 C 盘默认 store 时因 effect 缓存缺失失败；明确改为
此前已验证的 D 盘 store 后 26 个依赖全从缓存恢复，未访问官方 registry，
未禁用 TLS/供应链策略。可信 checker 的全量 build 9/9 通过。
本地 clone 的 origin 最初是 Windows 文件路径，不是 Git Objective 支持的
HTTPS/file URI；真实 CLI 明确拒绝该入口而没有成功回退。仅修正该独立 clone
的 origin 为 canonical HTTPS 身份后继续；源码仍是相同本地准确 commit。
这不会 fetch/push 或修改目标文件。

每次观察均运行两个文档入口：

```powershell
node <outer-checker>\objectives\pnpm-monorepo\check.mjs deliveries --subject-file <subject.json>
node <outer-checker>\packages\pguide\dist\bin.js probe --config <isolated-config.json> --pilot <outer-checker>\objectives\pnpm-monorepo\pilot.yaml --revision 65c14f1dff3e169c917d2cf67c093d2a16e59df4 --subject-file <subject.json> --format json
```

后者是实际 pguide dispatcher → command discovery → pguide-probe extension →
已提交本地 Git snapshot → 两层 process probes，不是直接调用测试内存 resolver。
专用 config 只声明隔离 commandDirectories/stateDirectory，shim 指向可信 checker
的真实 probe extension；不需要 Agent、用户认证或模型调用。
完整实际命令参数、cwd、退出码、pguide 版本与每个 Subject 均记录在执行摘要。

## 目标与修复方式

真实目标使用[已提交多包需求示例](../../../../objectives/pnpm-monorepo/examples/repository.json)，
通过整体交付准备检查，但保留 `onlineVerified:false` 与四项范围外 limitations。
隔离目标是一个 browser+Worker 多角色合包和一个内部 universal 支撑包，
两个交付物均为 preview，browser 显式引用实际 Worker 服务，Worker 仅声明
虚构非秘密 DB 资源名称；初始内容另有真实本地 Git commit 记录。

修复由验证驱动脚本显式完成，不是检查器自行修复：

1. 已知用途的应用文档放在根目录，得到 file-responsibility 的位置、规则、
   `apps/app/docs` 建议和引用维护提示；保留内容移动并更新该明确 assignment 后复查。
2. 移除允许的 app→shared 依赖方向，得到 dependency-direction；恢复允许映射后复查。
3. Browser 部署 JSON 环境/产物目录与需求错配，得到 browser-deployment；恢复一致后复查。
4. Worker main 指向不存在入口且缺失 DB binding，得到 worker-entry/worker-binding；
   恢复原入口及环境 binding 后复查。
5. Worker 切到 production 而 browser 仍 preview，虽然包关联存在仍得到
   service-environment；恢复同环境后复查。

每轮检查前后对目标除 `.git` 外的全部文件内容计算 SHA-256 清单摘要，
同时对比完整 `git status --porcelain --untracked-files=all`；主动修复之间允许文件变化，
每次**观察本身**必须不改变任何目标文件或 Git status。
摘要的 before/after 不仅比较配置文件，也覆盖 ignored 既有产物。

## 证据索引与边界

- [全部实际命令、版本、状态和逐次哈希](./external-evidence/validation-summary.json)
- [验证驱动脚本](./external-evidence/outer-validation.mjs)
- [真实目标报告](./external-evidence/repository-report.json)
- [真实目标 Pilot 结果](./external-evidence/repository-pilot.json)
- [隔离正例报告](./external-evidence/isolated-pass-report.json)
- [隔离最终需求契约](./external-evidence/isolated-contract.json)
- [执行完成断言](./external-evidence/validation-complete.txt)

原始逐次报告与 Pilot 结果均在同级 external-evidence；报告中的规则、需求 ID、
包身份和修复提示与执行摘要逐项对应。所有 state pass 仅指 delivery-preparation；
未执行真实 npm 发布、Cloudflare 部署、数据库迁移、在线 OIDC 登录、生产秘密读取
或付费资源操作。隔离 scripts 的 MUST_NOT_EXECUTE 标记只作为观察元数据；
驱动只启动可信 CLI 与 Git，不运行这些 scripts。

实际结果为 12/12 次观察全部符合断言，57 条记录命令退出码均为 0；
真实 pguide 版本为 `0.4.0-rc.0`，Pilot `versions` 全部指向真实源码 commit
`65c14f1dff3e169c917d2cf67c093d2a16e59df4`：

| 观察 | 报告 | Pilot level |
| --- | --- | --- |
| repository | pass | terminal |
| isolated-pass | pass | terminal |
| structure-fail | fail | initial |
| structure-repaired | pass | terminal |
| dependency-fail | fail | structured |
| dependency-repaired | pass | terminal |
| browser-config-fail | fail | structured |
| browser-config-repaired | pass | terminal |
| worker-config-fail | fail | structured |
| worker-config-repaired | pass | terminal |
| service-environment-fail | fail | structured |
| service-environment-repaired | pass | terminal |

真实目标哈希覆盖 538 个文件；隔离初始目标 15 个文件，加入并修复文档后 16 个文件。
全部 12 轮内容摘要和 Git status 在观察前后完全一致；失败观察与成功观察
均没有修改目标。隔离目标由驱动主动修复后可能 dirty，这不被当成观察器的副作用，
也不掩盖在 beforeStatus/afterStatus 中。
驱动的重放前置条件是同级已准备的 outer-checker/outer-target 独立 checkout；
持久脚本不是产品入口，也不会自动克隆、安装或构建未授权目标。

实施中全量 `pnpm check` 的同 6 项先存 setup 失败仍保留在 Inner 证据，
父会话已独立复现并审查；本阶段仅新增外部证据和 ledger，不修改产品代码，
未重复九分钟的无关全量测试。Outer 结论不声称这些先存失败消失。
