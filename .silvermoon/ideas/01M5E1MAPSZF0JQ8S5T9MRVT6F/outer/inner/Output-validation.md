# CLI 输出改造验证

## 实施范围与审阅结论

在用户授权主 Agent 负责技术审批后，三个实现 Agent 分别负责资源与诊断、观察与执行、帮助与迁移；主 Agent 负责共享输出工具、结构化输入错误、交叉集成和最终验证。没有新增依赖、渲染框架、交互 TUI、隐式分页或 npm 发布。

本文件记录本地实现证据，不代表 npm 已发布，也不冒充真实 Agent、TTY、POSIX 或全部外部业务分支验证。Ideal World 的原始审计与样例保留为改造前基线，不覆盖历史问题证据。

## 24 项问题的处置

| 问题 | 处置与可观察结果 |
| --- | --- |
| F01 | Objectives list 为名称/描述/范围/来源摘要，show 分层展示声明；默认和 Markdown 不再整段输出 JSON。 |
| F02 | Objectives、Agents 和 legacy alias 列表有明确空态、查找范围与适用下一步。 |
| F03 | Agent 列表与详情分离，详情明确所选名称、类型、范围和来源；保留脱敏后的配置内容。 |
| F04 | 写入/编辑/迁移回执包含动作、目标、范围和文件；迁移保留备份，scaffold 提示后续完善与验证。 |
| F05 | config edit 成功有保存回执；JSON 返回 schemaVersion/status/path，编辑器输出移到 stderr，失败不报保存成功。 |
| F06 | config show 展示有效配置及字段来源；get 的标量/对象原值用途不变。 |
| F07 | diagnose 展示环境、配置和实际命令来源/路径。 |
| F08 | diagnose agent 展示检查对象、协议和初始化结果，明确不等同于认证或修复证明；人类初始化详情按 profile 脱敏。 |
| F09 | 冲突诊断显示命令及候选路径，直接分派错误和帮助使用同一冲突事实。 |
| F10 | probe 显示 Objective 身份、当前位置、问题引用/指导和下一步，不输出敏感依赖 subject 或 Agent 会话。 |
| F11 | terminal 明确说明完成、没有阻塞问题和无需修复，不输出空缺口分区。 |
| F12 | regulate/continue 显示目标、当前位置、停止原因、额度/次数、持久化位置和继续方式。 |
| F13 | supervise 区分计划、执行周期结束和目标完成，说明未完成目标、队列、资源、待处理原因与结束边界；处理数量单复数。 |
| F14 | **兼容处置**：统一人类根因与目标上下文，保留既有 probe/6、regulation-error/6、supervisor internal-error/70 等机器分类与退出码，不在展示改造中重定义领域协议。 |
| F15 | 不存在与跨作用域歧义分开报错，不存在引导 list，歧义列出候选 scope/来源。 |
| F16 | **兼容处置**：普通命令的结果/错误 envelope 保留 stdout，迁移默认错误保留 stderr；README 明确边界，不破坏现有重定向。 |
| F17 | config 主帮助和退役入口只推荐受支持的 agents/objectives 替代命令，去掉误导性旧示例。 |
| F18 | 帮助正确声明 --objective 与 --pilot 二选一及其互斥输入边界。 |
| F19 | Agents/Objective 操作帮助与总帮助共享定义和全局选项默认值。 |
| F20 | JSON help 补充 description/usage/sections/optionDetails/globalOptions/constraints/examples，保留已有 options/types/subcommands/resourceSchema。内置 diagnose/complete 也有结构化帮助。 |
| F21 | 迁移 --format 仍选择文档种类，新增 --output-format 选择回执显示格式；旧 JSON help 用法仍可用。 |
| F22 | 三类迁移成功均有回执，明确输入不变、输出位置和产物格式；JSON 回执与产物内容分开，保留不覆盖与 pinned evidence 边界。 |
| F23 | **有意行为修正**：validate --bogus 不再报告成功，返回 invalid/error、退出 2；不再输出成功的 objectiveId。 |
| F24 | 类型化输入错误携带 schema 问题或支持的语言；CLI 分层展示字段/约束/下一步，同时保留原机器错误文本、分类和退出码。嵌套调节错误与清理失败不丢失根因。 |

具体兼容决策见[实现契约](./Implementation.md#compatibility-decisions)。F14/F16 是明确保留兼容性的处置，不将它们写成机器协议已经统一。

## 自动化证据

- [资源、诊断与编辑器测试](../../../../../packages/pguide/test/resource-output.test.ts)：7 项，覆盖空态、scope/来源、写入/迁移、编辑器流隔离、诊断/冲突/初始化及人类结果脱敏。
- [观察与执行测试](../../../../../packages/pguide/test/execution-output.test.ts)：7 项，覆盖 probe、terminal、调用失败、调节/继续、额度、队列与结束边界、嵌套输入错误，以及不输出敏感 subject/会话内容。
- [帮助集成测试](../../../../../packages/pguide/test/help-output.test.ts)：3 项；[输入错误集成测试](../../../../../packages/pguide/test/input-output.test.ts)：2 项。四份 CLI 输出套件合计 19 项通过。
- [共享输出工具测试](../../../../../packages/pguide-cli-core/test/output.test.ts)和[帮助元数据测试](../../../../../packages/pguide-cli-core/test/help-metadata.test.ts)，覆盖 Markdown/ANSI/多行/代码围栏、默认值与帮助内容一致性。
- [领域输入错误测试](../../../../../packages/objective-pilot/test/input-errors.test.ts)与现有 Pilot 测试合并运行，10 项通过；错误仍是兼容的 ObjectiveConfigurationError，message 不变。
- [迁移 CLI 测试](../../../../../packages/pilot-protocol/test/migration-cli.test.ts)，实际验证三类成功产物、人类/JSON 回执、帮助、错误、拒绝覆盖和 pinned evidence。
- [既有源清理测试](../../../../../packages/pguide/test/pilot-source.test.ts)补充 humanMessage/cleanup 双重失败断言，单项复跑通过；清理失败不会被友好文案遮蔽。
- [配置命令回归](../../../../../packages/pguide-config/test/config-command.test.ts)8 项通过。原来的 legacy list 文字快照按有意的新展示更新为名称、位置、来源分行断言，JSON 深比较保持不变。

共享 config/help/output 合并测试 24 项通过；help/output/migration 合并测试 13 项通过，包含重复运行的共享用例，不将这些数字简单相加冒充独立测试总数。最终额度单复数与 ASCII 分隔符另有聚焦回归通过。

## 421 次实测重放与前后对照

在同一 Windows/Node 环境，重放原审计脚本的 431 次调用，按原规则排除 10 次 fixture 调试/选项覆盖调用，得到 **421 次有效调用、169 个场景**。使用新的隔离配置、本地 Git Pilot、本地 ACP fixture，未运行真实 Agent 或访问远程业务仓库。

对照检查通过：

- 126 次显式 JSON 均可解析，config edit 的静默结果已补齐。
- 440 次既有顶层字段保留断言通过，既有 schemaVersion 保持；JSON 语义与嵌套字段另由各领域回归测试覆盖。
- validate 未知选项是唯一预定的退出/结果形状修正：`success/objectiveId/0 -> invalid/error/2`。验证器明确检查新的错误 envelope，而不是把成功字段缺失错误地当作回归。
- 其他场景的退出码与基线一致；版本、命令发现元数据、补全脚本、16 个 check/runtime 协议入口的完整 stdout 与基线相同。
- 普通 JSON stderr 与基线一致；编辑器有内容时的专门 stderr 分流另由集成测试验证。
- 原来的整对象 JSON 空态已变为人类说明；Agent 初始化和冲突对象可见；terminal 有完成结论；schema/语言失败有具体指引；迁移成功不再静默。

这不是“421 次全部退出 0”：其中包含预期错误、停滞和不存在记录等场景，检查的是每个场景应有的退出码和输出契约。改造前全部模式及命令见[原覆盖矩阵](./ideal/output-coverage.md)，不覆盖其历史记录。

## 仍保留的验证边界

未将 fixture 当作真实认证/修复证明，未声称已经验证交互编辑器、TTY 宽度、屏幕阅读器、POSIX 或第三方扩展。工作树入口、协议包装器和下述八类隔离包消费已验证；真实外部交付和发布仍属于 Deployment，不提前勾选其 ledger。

## 全库检查与技术门限

- `pnpm build`：20 个 workspace 构建通过。
- `pnpm check`：layers、format、lint、typecheck 和 39/40 个 workspace 构建/测试任务成功，最终退出 1；唯一失败是改造前已复现的 [Supervisor 跨进程能力反馈用例](../../../../../packages/pguide/test/supervisor-cli.test.ts)，仍为 `Planner did not acknowledge capability feedback.`。pguide 完整套件结果为 106 通过、1 失败、1 跳过，未删除、跳过或放宽该既有失败。
- 首次全量检查发现 legacy alias 文字快照与有意的新格式不同，已改成有意义的分行内容断言；配置命令 8 项回归通过，重跑全量不再有该失败。
- 因全量在既有失败处停止，独立补跑后续检查：根 scripts 测试 **36/36 通过**；`pnpm run pack:check` **退出 0**。
- pack:check 实际通过 main、pilot、regulation、supervision、objectives、config、agents、combined **八类隔离 tarball 消费**，不仅检查编译文件存在。
- `silvermoon check --worktree` 通过；提交前继续验证 staged 候选。文档链接、锚点和 ledger 镜像单独校验。
- 保留并记录原有的非致命诊断：Biome 对缺失 `config` 路径的诊断，以及 monorepo CJS 构建中的 `import.meta` 警告；没有为输出改造顺手变更这些既有构建/测试问题。

主 Agent 的技术门限结论：本次 24 项输出改造的专项测试、421 次重放、机器兼容检查和隔离包消费通过，可以交付本地实现；完整仓库基线仍有上述独立失败，**不能表述为全库全绿或 npm 已发布**。不把这个结论写成未经同步的 Silvermoon `accept*` 事实。

## 改造后实测样例

以下摘自本轮真实子进程捕获，并非预期模板。普通命令额外传入隔离的 `--cwd <FIXTURE>\repo --config <FIXTURE>\config.json`；`<FIXTURE>`/`<UUID>` 仅归一化路径与随机值。较长诊断截取前 18 行并明确标注；本节未列出的 stderr 均为空。

### objectives-one

```text
pguide-objectives list
```

进程退出码：0；stdout：

````text
# Objectives

- Scope: user and directory
- Context: `<FIXTURE>\repo`

## `sample`

- Description: Audit \*\*label\*\* \| multiline second line

- Scope: directory
- Source: `<FIXTURE>\repo\objectives.yaml`
````

### agents-empty-list

```text
pguide-agents list
```

进程退出码：0；stdout：

````text
# Agents

- Context: `<FIXTURE>\repo`
- Scopes: user and project (project profiles replace same-name user profiles)
- user file: `<FIXTURE>\user\pguide\agents.yaml`
- project file: `<FIXTURE>\repo\.pguide\agents.yaml`

No Agent profiles found. Use `pguide agents set <name> --from <profile.yaml> --scope user|project` to add a profile.
````

### config-edit

```text
pguide-config edit --scope explicit --format json
```

进程退出码：0；stdout：

````text
{
  "schemaVersion": 1,
  "status": "updated",
  "path": "<FIXTURE>\\config.json"
}
````

### diagnose-conflict

```text
pguide diagnose
```

进程退出码：2；stdout：

````text
# pguide diagnosis

- Status: command conflicts found; resolve before dispatch
- Node: `v24.11.1`
- Context: `<FIXTURE>\repo`
- Discovered commands: 8

## Configuration

- user: `<FIXTURE>\user\pguide\config.yaml`

- explicit: `<FIXTURE>\config.json`

## Commands

- `agents`
  - Source: configured
  - Executable: `<FIXTURE>\commands\pguide-agents.cmd`
[截取：其余输出未列出]
````

### probe-schema-guidance

```text
pguide-probe --pilot <URI> --subject-file <FIXTURE>\subject.json --no-reports
```

进程退出码：2；stdout：

````text
Error: Invalid subject for `git+file:///<FIXTURE>/repo#objective/`.

Input issues:
- `/`: must have required property 'name' (`required`)

Next: correct the subject fields against subjectSchema and retry --subject-file <path> or stdin.
````

### migration-manifest-valid

```text
objective-contract-migrate --format manifest --input <FIXTURE>\legacy-manifest-valid.json --output <FIXTURE>\migrated-manifest.json
```

进程退出码：0；stdout：

````text
Migration completed.
Kind: manifest
Input: <FIXTURE>\legacy-manifest-valid.json (unchanged)
Output: <FIXTURE>\migrated-manifest.json
Artifact format: json
Existing files were not overwritten; pinned source evidence was not rewritten.
````
