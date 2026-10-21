# 默认输出审计

## 结论与证据边界

2026-10-21 检查当前仓库的所有自有命令输出入口，并用本机 `pguide 0.4.0-rc.0` 做只读复现。运行结果仅记录输出形态，不保存真实用户配置、Agent 配置或完整 Objective 声明。涉及写入、启动 Agent 或运行 Pilot 的分支以源码检查为依据，未执行这些操作。

这不是全局默认被改成 JSON：[`extractGlobals`](../../../../../../packages/pguide-cli-core/src/index.ts) 默认选择 `markdown`，[`writeResult`](../../../../../../packages/pguide-cli-core/src/index.ts) 在该模式直接打印调用者提供的第三个参数。缺陷在具体命令的展示分支。当前参数是 `--format markdown|json`，不是 `--json`。

## 命令清单

| 命令 | 当前默认输出与检查方式 | 判断及统一优化方向 |
| --- | --- | --- |
| `objectives list`、`objectives show <name>` | [源码](../../../../../../packages/pguide-objectives/src/index.ts)共用 `JSON.stringify({ objectives, legacyAliases }, null, 2)` 作为 Markdown。实测 list 默认及显式 Markdown 都可解析为 JSON，顶层为 `objectives,legacyAliases`；显式 JSON 额外含 `schemaVersion`。show 同一路径，未单独运行。 | **已确认同根问题，优先修复两者。** list 优先展示名称、描述、作用域、来源和 legacy 标识，空态给出可执行提示；show 分层展示声明详情，schema 和表达式可用代码块，但不整段倾倒输出对象。保留歧义拒绝及作用域选择。 |
| `agents list/show/path/migrate` | [源码](../../../../../../packages/pguide-agents/src/bin.ts)以 YAML `stringify` 展示 profile、来源、路径或迁移结果；实测 list/path 为文本，非 JSON。 | **相关可读性问题，不是同根 JSON 缺陷。** list 缺少面向扫描的摘要和专用空态；show 应先概括类型、来源等关键项，再展示必要配置；path/migrate 提供清晰标签和结果。不得减弱既有脱敏。 |
| `config show/get/path/list-objectives` | [源码](../../../../../../packages/pguide-config/src/bin.ts)：show 和对象型 get 为 YAML，标量 get 为原值；path 为带标签路径；list-objectives 为文字条目且已有空态。实测 show 为 YAML，list-objectives 为明确空态。 | **合理例外与现有先例。** show/get 的配置内容可保留 YAML/原值，不把“结构化内容”一概当缺陷；show 的来源信息目前仅在 JSON 中，可考虑用清晰分区呈现，避免污染 get 的原值用途。复用 list-objectives 的文字摘要和空态原则，不混淆 legacy alias 与声明式 Objective。 |
| `diagnose [agent <profile>]` | [源码](../../../../../../packages/pguide/src/bin.ts)仅摘要状态、Node 版本、命令数量；实测无 Agent 模式为三行文本。完整命令路径、冲突、配置路径及 Agent 初始化详情在 JSON 中。 | **相关信息不足。** 人类输出应直接指出冲突位置、有效来源和 Agent 就绪结果；无需为了理解失败再切换 JSON。Agent 模式仅静态检查。 |
| `probe` | [源码](../../../../../../packages/pguide-pilot/src/commands/pilot.ts)：成功显示当前层级及 gapSummary，调用失败显示 message；未运行 Pilot。 | **已有文字输出，纳入一致性检查。** 验证问题、依赖和下一步是否足以支持用户判断；不假设所有 Pilot 都提供相同自然语言内容，也不更改观察协议。 |
| `regulate`、`continue` | [源码](../../../../../../packages/pguide-regulate/src/commands/regulator.ts)共用执行结果展示，仅给 regulation ID 和 attempt.status；未启动执行。 | **相关摘要过少。** 给出停止原因、目标/当前进展、必要报告位置及适用的继续方式；不得把失败、停滞或取消写成成功，不输出敏感会话内容。 |
| `supervise` | [源码](../../../../../../packages/pguide-supervise/src/commands/supervisor.ts)仅显示目标数和排队需求数；失败事件决定非零退出码但未在该摘要展开；未启动执行。 | **相关摘要过少。** 展示计划/执行模式、关键需求、失败与停止原因，避免数量摘要掩盖失败；不倾倒完整事件流。 |
| `scaffold`、`validate pilot` | [源码](../../../../../../packages/pguide-pilot/src/commands/pilot.ts)已有创建结果或验证成功文字，错误由公共入口格式化；仅静态检查。 | 未发现同类整段 JSON 问题；作为回归范围，保留产物路径、明确失败和退出码。 |
| `objectives set/remove/migrate`、`agents set/remove/edit/validate`、`config validate/set/unset/remove-objective/edit` | 对应命令已有简短结果；`config edit` 成功后直接返回、无结果摘要。已退役 config 子命令给出迁移错误。仅静态检查。 | 无同根 JSON 缺陷；检查写入确认的一致性、编辑完成反馈和迁移提示，不改变编辑器交互或写入行为。 |
| 顶层与各命令 `--help`、`--version`、错误 | [公共入口](../../../../../../packages/pguide-cli-core/src/index.ts)及[主入口](../../../../../../packages/pguide/src/bin.ts)已有文字模式，JSON 显式选择。错误 guidance 中有 JSON 代码块。 | 保持人类帮助与结构化帮助分离。局部 JSON 示例/代码块不是整段原始输出缺陷；错误信息和输入 guidance 仍须保留。 |
| `complete`、`--pguide-command-metadata`、`--report`/报告文件 | complete 默认是 shell 脚本（已实测）；命令元数据固定 JSON；报告文件为机器产物。 | **有意的机器/原文出口，排除统一美化。** 不给可执行补全脚本添加标题，不改发现协议或报告 schema。 |

## 统一输出约定与验证目标

1. 默认保持 `markdown`，与显式 `--format markdown` 的内容一致；列表、详情、诊断/执行结果分别提供合适的信息层级，而不是统一包一层标题或统一改成表格。关键失败和下一步不能只存在于 JSON。
2. 优先解决 objectives 的真实缺陷，再统筹 Agent 资源、配置来源和诊断/执行摘要。长 schema、subject 表达式和配置原文使用必要的分区与代码块；保护现有脱敏，不新增交互 TUI、隐式分页或 TTY 自动切换输出格式。
3. `--format json` 单独输出可解析的既有完整对象，保持 schemaVersion、字段含义和退出码；人类提示不得混入机器结果。兼顾重定向、非 TTY、长值、多行文本和 Markdown 特殊字符。
4. 测试覆盖默认/显式 Markdown/JSON、空/单/多条、跨作用域歧义、legacy alias、来源、失败和脱敏；通过主入口及独立命令验证一致性。不要仅断言“不是 JSON”，还应断言用户需要的关键信息存在。

## 现有测试缺口

[`objectives.test.ts`](../../../../../../packages/pguide/test/objectives.test.ts) 的管理调用显式传 `--format json`，没有保护 list/show 的人类展示分支。[`cli.test.ts`](../../../../../../packages/pguide/test/cli.test.ts) 已有结构化帮助、诊断、补全及分派测试，可作为输出兼容性的回归基础。后续实施补充人类输出断言，而非用修改 JSON 快照代替修复。
