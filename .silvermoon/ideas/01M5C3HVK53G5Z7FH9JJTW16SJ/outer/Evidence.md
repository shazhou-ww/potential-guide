# 本机部署结果与来源

## 验证对象

第三次消费者执行于 `2026-10-20T10:03:52.199Z` 至 `2026-10-20T10:06:20.855Z` 完成，`success: true`，十二个场景全部通过。原始结果为 [Consumer-results.json](./Consumer-results.json)，执行输出为 [Consumer-execution-3.log](./Consumer-execution-3.log)，精简摘要为 [Consumer.log](./Consumer.log)；可重放入口与前置条件见 [Validation-plan.md](./Validation-plan.md)。

- 执行前已同步的计划 commit：`f105ee8caa6fab38a2d6ffac22383563f34040f7`。
- 该 commit 的精确 Outer tree（结果中的 `planRevision`）：`9d0ea341d60885957ac5a66dd172610a62a85dc5`。最终加入结果形成新的部署提交修订；不将最终证据树冒充为执行前计划树。
- accepted Inner：`61ecfc89b1208bca68ca7ec98e8caf2adf4f77ea`；本次仅补 Outer 证据与 ledger，不改 accepted Inner 或产品源码。
- Node `v24.12.0`，全局 `pguide 0.4.0-rc.0`，既有 package junction 指向本 worktree。[Build.log](./Build.log) 记录十二个 workspace build 成功，均为已有 Turbo cache 命中，不声称无缓存编译。
- 独立安装的公共桥接库 `@potential-guide/objective-pilot 0.2.0-rc.0` 的 dist 入口 SHA-256：`6a4440e385058b3b37f1ac4af56bee6230c63db4f5d36ac46f3b118c6093f8c5`。它是已记录执行环境，不属于 fixture Pilot tree。

## 场景与验收映射

下表 ID 对应结果文件的 `scenarios`，各项 `passed` 均为 `true`。命令明细共 46 项；退出码分布为 0×28、2×15、3×1、6×2。非零退出包含明确断言的非法输入、不可取回来源和旧恢复记录负例，不是把每条命令宣称为成功。

| 场景 ID | 观察结果 | 对应条目 |
| --- | --- | --- |
| `global-objectives-wiring-and-user-discovery` | 全局 objectives 元数据和 configured commandDirectories 发现可用 | D-S01、D-AC01 |
| `readonly-discovery-and-explicit-scope` | 列举/详情无检查、Agent 或远程解析；显式作用域且无父级继承 | D-S01、D-AC01 |
| `root-subdirectory-and-two-checkouts` | plain Git consumer 无包清单；根、子目录、两个 checkout 保持不同 subject | D-S01、D-AC01 |
| `input-types-are-orthogonal-to-scope` | 两种作用域均支持 Unit/参数化目标，额外或缺失输入按声明拒绝 | D-S01、D-AC01 |
| `explicit-errors-and-atomic-management` | 非法目标不破坏文件；隔离用户显式迁移保留其他别名 | D-S01、D-AC01 |
| `probe-does-not-repair-and-bounded-regulation` | probe 不修复；受控 regulation 有界完成 fixture 修复 | D-S01、D-AC02 |
| `directory-tree-and-retrieval-commit-are-distinct` | 实际 Git 对照：无关提交保留目录 tree，资源与 References 更新改变 tree | D-S02、D-AC02 |
| `continue-uses-original-binding-and-rejects-old-evidence` | 同名声明/来源更新后仍保留原 commit、tree、subject，旧恢复证据拒绝 | D-S02、D-AC02 |
| `consumer-distinguishes-missing-declarations-and-source-call-failures` | 缺失子声明与来源调用失败均显式报错且不修复 | D-S02、D-AC01 |
| `consumer-discovers-and-supervisor-advances-two-directory-dependencies` | 消费者读取两个目录声明并决定 terminal 阈值；根交接、子目标推进后重新观察根 | D-S02、D-AC02 |
| `installed-continuous-supervise-follows-root-and-dependency-without-portfolio-edits` | 实际全局 supervise 先跟随无关提交，再跟随根脚本和独立依赖更新；portfolio 不变，更新后至少三次 terminal 观察，无根修复 | D-S02、D-AC02 |
| `global-user-data-unselected-target-and-owned-resource-safety` | 原 shim/真实用户文件不变，未选择发布目标不执行，进程与来源缓存释放 | D-S03、D-AC03 |

`gitEvidence` 保留九项来源记录；第七、十一场景另保留变化前后 commit/tree 及连续观察版本表。来源使用操作拥有的本机 fixture，不借真实仓库、模型或发布目标证明部署。

## 接线、清理与隐私

首次接线的 [Wiring-receipt.json](./Wiring-receipt.json) 绑定第二次运行的计划 commit `3a6e2b3174567310fe957da24d0fc9981f9810db` 与 Outer tree `3a7de1c53fc74b391fb7913b15f701d1a7d6633d`，记录仅新增 `pguide-objectives`、`pguide-objectives.cmd`、`pguide-objectives.ps1`。第三次运行的 `globalShimsAdded: []` 表示复用已存在接线，不是首次没有接线。

第三次安全场景实际逐字节比较 27 个既有 pguide 全局命令及真实用户 config/objectives 文件，只持久化“不变”布尔值，不保存真实用户配置内容或其哈希。仅隔离用户 fixture 有别名迁移，不迁移或猜测真实别名。publish sentinel 未产生。

所有 CLI subprocess 有硬超时，持续 supervise 有有限 duration；结束时 active 命令为零。记录的 107 个 fake Agent PID 均已退出。四个已知 shell/consumer cwd 的 `pguide-sources` 缓存为 absent 或 empty。结果 `cleanup.completed: true`，仅删除本次命名 scratch `.cache\dco-deploy-xYEP1Z`。

收尾另做只读小检查：结果十二项成功、计划 commit 的 Outer tree 等于 `planRevision`、当前 Inner 等于 accepted Inner、该 scratch 已不存在、安装桥接入口 SHA-256 仍匹配。没有重跑长消费者验证、读取或展示真实用户配置，也没有清理其他目录。

收尾 `pnpm check` 退出 0，覆盖 format、lint、typecheck、test 与 pack:check；新增结果/日志的常见私钥、GitHub token、模型 token 与 Bearer 模式扫描通过。这不是全面秘密扫描保证，也不替代原始验证的用户数据字节比较。

## 历史与限制

- [Consumer-execution.log](./Consumer-execution.log) 保留第一次 ESM-only 入口解析失败；失败发生于 scratch/接线前。
- [Consumer-execution-2.log](./Consumer-execution-2.log) 与 [Consumer-attempt-2-summary.json](./Consumer-attempt-2-summary.json) 保留第二次清理断言失败，不改写为成功。其错误是验证资源只在启动 shell cwd 查缓存；后续改为检查已知 consumer cwd 的 empty/absent 状态，已先同步资源再执行第三次验证。
- 本机 junction 接线并非 registry 全新安装；未测试其他操作系统、Node 22、真实远程 Git 服务、真实模型或 npm/云发布。fixture 清理后，其临时 Git 对象不能再从原路径获取；持久证据为记录的命令、结果和 OID，可用验证资源新建 fixture 重放，不能声称保留了原临时仓库。
- 此次只是本机授权边界内的部署证据；最终精确 Outer revision 仍需父 agent 审批。未记录 `acceptOuter`，不代替父门限。
