# CLI 输出问题与具体例子

## 阅读说明

以下 24 项来自[实际走查](./output-audit.md)，每项都给出命令与实际输出，不把源码推断当作执行证据。例子使用已归一化的合成 fixture；`<UUID>` 代表实测随机 ID，`<URI>` 简写同一合成 Git 来源，`（空）` 代表零字节。每项链接指向包含 stdout、stderr、退出码和必要 JSON 对照的[样例文档](./output-examples.md)；全部模式见[覆盖矩阵](./output-coverage.md)。

P1 表示影响用户判断结果、定位问题或脚本消费；P2 表示内容和风格统一。它们不是安全漏洞分级。期望是后续规范化的方向，不是当前已实现行为；涉及机器字段、流、退出码或参数兼容性的调整必须先明确迁移方案。

## F01 · P1 · Objectives 默认和 Markdown 实际仍是 JSON

命令：`pguide-objectives list`、`pguide-objectives show sample`。

```text
{
  "objectives": [
    {
      "description": "Audit **label** | multiline\nsecond line",
```

这是实际输出开头的截取；后面包含完整 inputSchema、subject、文件路径和 revision，而不是供人扫描的列表。显式 `--format markdown` 仍如此；主入口也复现。

期望：列表显示名称、描述、作用域、来源及 legacy 标识；详情分区展示 schema/表达式，不整段打印 envelope。多条、跨作用域同名和特殊字符不能靠读 JSON 区分。

证据：[单条](./output-examples.md#objectives-one)、[详情](./output-examples.md#objectives-show)、[多条与 legacy](./output-examples.md#objectives-many-legacy)、[主入口](./output-examples.md#dispatch-normal-objectives)。

## F02 · P1 · 同为列表，空态约定不一致

```text
pguide-objectives list
{
  "objectives": [],
  "legacyAliases": []
}

pguide-agents list
{}

pguide-config list-objectives
No registered Objectives.
```

前两者退出 0，但缺少“已成功查找、没有条目”的语义；配置列表已有自然语言空态。`{}` 本身不是执行失败，但看不出作用域与下一步。

期望：空列表说明查找范围，并给出相关 list/set/help 方向；保持 JSON 空数组/对象契约。

证据：[Objectives 空态](./output-examples.md#objectives-empty)、[Agents 空态](./output-examples.md#agents-empty-list)、[配置列表](./output-examples.md#config-list-objectives)。

## F03 · P2 · Agent 列表和详情都是原始 YAML，详情还不显示所选名称

命令：`pguide-agents show fixture`，实际输出开头：

```text
profile:
  type: acp
  connection:
    protocolVersion: "1"
  transport:
    type: stdio
```

完整输出还有 Node 命令、参数和 source，但没有标题或 `fixture` 名称。`list` 直接输出以 profile 名称为键的 YAML；详情和列表缺少不同的信息密度。

期望：列表摘要便于扫描；详情先明确名称、类型、作用域、来源，再展开配置。保留脱敏和查看原始配置的能力，不把 YAML 本身一概禁止。

证据：[list](./output-examples.md#agents-list)、[show](./output-examples.md#agents-show)。

## F04 · P2 · 写入结果的动作、名称、范围和路径没有统一回执

```text
pguide-objectives set sample --scope directory --from <FIXTURE>\declaration.json
set: sample (<FIXTURE>\repo\objectives.yaml)

pguide-agents set fixture --scope project --from <FIXTURE>\profile.json
project: <FIXTURE>\repo\.pguide\agents.yaml

pguide-config set defaultAgent fixture --scope explicit
Updated <FIXTURE>\config.json.
```

Agents 的 set/remove/edit 使用同一种“scope: path”，不能从结果区分执行了什么、影响哪个 profile；Objectives 用命令原词，config 用过去式。scaffold 只确认创建路径，未在结果提示生成内容仍需完善和验证。

期望：统一表达动作结果、目标身份、范围、落盘位置；迁移另保留备份位置。只在实际有下一步时提示，不重复整份帮助。

证据：[Objectives set](./output-examples.md#objectives-set)、[Agents set/remove/edit](./output-examples.md#agents-set)、[配置 set](./output-examples.md#config-set)、[scaffold](./output-examples.md#scaffold-create)。

## F05 · P1 · config edit 成功完全静默，显式 JSON 也没有结果

命令：`pguide-config edit --scope explicit`；另实际运行 `--format markdown` 和 `--format json`。

```text
exit: 0
stdout: （空）
stderr: （空）
```

使用合法配置与返回 0 的合成编辑器，确认成功写回。相同编辑器下 `agents edit` 有写入回执。这是 126 次显式 JSON 调用中唯一没有可解析结果的场景。

期望：人类模式说明保存完成及目标文件；JSON 返回标准成功对象；编辑器自有输出与最终机器结果的分流也需明确。失败或取消不能输出保存成功。

证据：[config edit 三模式关键输出](./output-examples.md#config-edit)、[agents edit 对照](./output-examples.md#agents-edit)。

## F06 · P2 · config show 人类输出缺少配置来源

命令：`pguide-config show`，实际输出：

```text
schemaVersion: 2
defaultAgent: fixture
stateDirectory: <FIXTURE>\state
regulationStrategy:
  quota:
    timeoutMs: 4000
    maxAgentRuns: 2
    maxStallRuns: 1
```

JSON 同时返回 `config` 和 `sources`，默认仅有合并后的 YAML。用户不能判断 `defaultAgent` 来自哪个文件；`config path` 只列路径，不能解释字段覆盖。

期望：保留配置原文的可读性，同时提供有效来源/覆盖说明；不要把标题混入用于原值消费的 `config get`。

证据：[show 的默认/JSON 对照](./output-examples.md#config-show)、[path](./output-examples.md#config-path)。

## F07 · P1 · diagnose 摘要缺失其主要诊断内容

```text
pguide diagnose
pguide diagnosis: ok
Node: v24.11.1
Commands: 9
```

实际发现的命令名、来源、可执行文件、配置位置都没有出现在人类输出。JSON 已有 `config`、`commands`、`conflicts`，但文字的“9”无法辅助排查。

期望：用明确分区呈现关键环境、配置和命令来源；不能让用户必须换 JSON 才能开展正常诊断。

证据：[diagnose](./output-examples.md#diagnose)。

## F08 · P1 · diagnose agent 成功结果与不检查 Agent 完全相同

```text
pguide diagnose agent fixture
pguide diagnosis: ok
Node: v24.11.1
Commands: 9
```

与 F07 的三行相同，尽管确实启动本地 ACP fixture 并获得 initialize 结果；JSON 含 Agent 名称、来源、类型与初始化信息。

期望：显示本次检查了哪个 Agent、协议与初始化结果，并明确“初始化成功”不等于“认证和修复已验证”。

证据：[默认/JSON 对照](./output-examples.md#diagnose-agent)、[提取字段](./output-examples.md#machine-field-comparison)。

## F09 · P1 · 命令冲突的诊断只显示 conflicts，不显示冲突对象

```text
pguide diagnose
pguide diagnosis: conflicts
Node: v24.11.1
Commands: 8
```

两个配置目录各提供一个 `pguide-probe.cmd`，实测退出 2。JSON 的 `conflicts.probe` 有两个路径，但上述摘要不显示 `probe` 或路径；直接调用冲突命令反而会列出冲突路径。

期望：诊断时直接列出命令、冲突候选和如何检查配置目录；帮助中的冲突提示与实际调用错误保持术语和信息一致。

证据：[diagnose 冲突](./output-examples.md#diagnose-conflict)、[实际分派错误](./output-examples.md#dispatch-conflict)、[help 冲突](./output-examples.md#help-conflict)。

## F10 · P1 · probe 有缺口时只给概述，丢失身份、问题引用和可执行指引

```text
pguide-probe --pilot <URI> --subject-file <FIXTURE>\subject.json --no-reports
# Observation

Current level: `initial`

Synthetic marker is absent.
```

此处不是 scaffold 的 TODO：fixture 的问题页已明确包含正文 `Create the synthetic marker and re-run the observation.`，人类输出仍只有 description。JSON 保留 current Objective 身份、问题 ref 等信息。只看输出无法知道问题 ID、关联检查或如何打开参考内容。

期望：显示 Objective 身份与当前层级、具体问题、必要引用及下一步；可以提供查看完整参考的方法，不强制把任意 Pilot 正文全部内联。退出 0 的观察成功不等于已经达标。

证据：[有意义的问题样例](./output-examples.md#probe-actionable-gap)、[JSON 字段投影](./output-examples.md#machine-field-comparison)。

## F11 · P2 · terminal 输出保留空缺口布局，没有明确完成结论

```text
pguide-probe --pilot <URI> --subject-file <FIXTURE>\subject.json --no-reports
# Observation

Current level: `terminal`


```

用户需要知道 `terminal` 的协议含义；空 gapSummary 仍产生多余空行。与 regulate 的 `target-reached` 和 config validate 的完整句子不一致。

期望：明确写出“观察成功、Objective 已完成/没有阻塞问题”，省略空分区；统一空行、结尾换行和结果标题。

证据：[terminal](./output-examples.md#probe-terminal)、[regulate 完成](./output-examples.md#regulate-terminal)。

## F12 · P1 · regulate/continue 的耗尽摘要没有原因、进展或继续方式

```text
pguide-regulate --pilot <URI> --subject-file <FIXTURE>\subject.json --target terminal --agent fixture
Regulation <UUID>: exhausted.

pguide-continue <UUID>
Regulation <UUID>: exhausted.
```

二者实测退出 5。第一次 JSON 显示 iterations 为 1、stalledRuns 为 1、当前层级仍是 initial，文字中均无对应信息。用户不知道是停滞还是其他配额耗尽，也不知道该检查哪份记录或如何继续。

期望：显示目标与当前位置、停止原因、必要次数/额度、记录位置与合法下一步；不能把“本次命令执行结束”表述为 Objective 达成。

证据：[regulate](./output-examples.md#regulate-stalled)、[continue](./output-examples.md#continue-stalled)、[机器计数](./output-examples.md#machine-field-comparison)。

## F13 · P1 · supervise 摘要不能表达目标是否完成及为何还有待执行任务

```text
pguide-supervise --portfolio-file <FIXTURE>\portfolio.json --planner fixture
Planned 1 goals; 1 queued demands.

pguide-supervise --portfolio-file <FIXTURE>\portfolio.json --planner fixture --execute --duration-ms 300
Supervised 1 goals; 1 queued demands.
```

两者退出 0。fixture 有一个缺口目标、没有执行资源；有限时执行结束仍有排队任务。摘要没有目标名、当前层级、排队原因、停止边界或资源说明；`1 goals` 的单复数也不自然。

期望：区分“计划已生成”“执行周期结束”“目标达成”，展示待执行/失败摘要及必要资源提示。正常到期退出 0 不在本次审计中判为业务 bug，不直接改退出码。

证据：[plan](./output-examples.md#supervise-plan)、[execute](./output-examples.md#supervise-execute)、[机器队列字段](./output-examples.md#machine-field-comparison)。

## F14 · P1 · 同一观察调用失败的措辞与错误类别不一致

相同 check 返回 `status: 502, message: "Synthetic check invocation failed"`：

```text
pguide-probe ...
Pilot invocation failed: Synthetic check invocation failed

pguide-regulate ...
Error: Probe invocation failed: Synthetic check invocation failed

pguide-supervise ...
Error: Observation failed for audit: Synthetic check invocation failed
```

进程分别退出 6、6、70；JSON 的 supervise 状态为 `internal-error`，regulate 为 `regulation-error`。这会让用户将可归因的观察失败误读为监督器内部崩溃，也混用 Pilot/Probe/Observation 术语。

期望：统一人类错误结构，保留根因与出错目标；检查分类是否准确。若必须改变机器类别或退出码，单独明确版本和兼容方案，不在展示重构中悄悄改变。

证据：[probe](./output-examples.md#probe-invocation-failure)、[regulate](./output-examples.md#regulate-invocation-failure)、[supervise](./output-examples.md#supervise-observation-failure)。

## F15 · P1 · 不存在的 Objective 与名称歧义使用相同错误和错误指引

```text
pguide-objectives show unknown
Error: show requires one unambiguous name; specify --scope.

pguide-objectives show sample
Error: show requires one unambiguous name; specify --scope.
```

第一条没有匹配项，第二条实际存在 user/directory 同名项；二者都退出 2。对不存在的名称重复加 `--scope` 并不能解决问题。

期望：区分缺名称、名称不存在与多作用域歧义；不存在时引导 list，歧义时列出候选 scope/来源并给准确调用。

证据：[不存在](./output-examples.md#objectives-unknown-name)、[歧义](./output-examples.md#objectives-ambiguous)。

## F16 · P1 · 面向人的错误与迁移器错误使用不同输出流

```text
pguide-validate pilot <FIXTURE>\absent
stdout: Error: Missing objective.yaml. Legacy pilot.yaml is not read: ...
stderr: （空）

objective-contract-migrate
stdout: （空）
stderr: Explicit --format, --input and --output are required.
```

第一条为输出片段，完整内容还包含迁移指引。普通 CLI 文字错误写到 stdout，迁移器写到 stderr。显式 JSON 错误也使用 stdout，但那可能是既有 envelope 契约，不能简单一起迁走。

期望：明确各模式的数据/诊断流规则；人类诊断应有一致约定，机器 envelope 和原文出口应可稳定消费。任何流的变更必须评估重定向用户并提供迁移说明。

证据：[validate 缺失](./output-examples.md#validate-missing)、[迁移缺参数](./output-examples.md#migration-invalid)。

## F17 · P1 · config 帮助示例仍推荐已退役、必定拒绝的命令

`pguide-config --help` 的 Examples 含：

```text
pguide config add-agent local .\agent.yaml --scope user
pguide config add-objective health .\objective --scope user
```

`pguide-config add-agent --help` 同样给出退役命令的用法和示例。实际执行这些子命令时拒绝并提示改用 `pguide agents set` 或 `pguide objectives set/migrate`。上方虽然有 Retired 描述，主要示例仍把用户引向死路。

期望：主要示例全部使用受支持命令；退役入口只保留准确迁移指引，不推荐再执行旧命令。帮助标题也不应继续暗示 Agent profile 归 config 管理。

证据：[config 总帮助](./output-examples.md#help-config)、[Examples 原文](./output-examples.md#config-help-example-section)、[退役命令帮助](./output-examples.md#config-help-retired)；实际拒绝退出码见矩阵中的 `config-retired-*`。

## F18 · P2 · probe 帮助将可替代的参数写成必选

`pguide-probe --help`：

```text
Usage: pguide probe (--objective <name> | --pilot <directory|Git URI|legacy-alias>) [options]

Required:
  --pilot <source>        Committed path, Git URI, or registered Objective name
```

Usage 声明二选一，Required 却只列 `--pilot`。用户按帮助叠加 `--objective` 与 `--pilot` 会触发互斥错误。

期望：Required 明确选择来源的互斥关系；选项、默认值、作用域语义与真实解析器一致。

证据：[probe 帮助](./output-examples.md#help-probe)。

## F19 · P2 · Agents 帮助的全局选项信息和操作级细节不统一

```text
pguide-agents show --help
Usage: pguide agents list|show|set|remove|edit|validate|path|migrate [name]

  --format markdown|json
  --color auto|always|never

pguide-probe --help
  --format <format>       markdown | json (default: markdown)
  --color <mode>          auto | always | never (default: auto)
```

这里仅截取各份帮助相关行。`agents show --help` 与 `agents --help` 实测完全相同，没有 show 专属用法、未知名称或来源语义的说明；config 已有操作级帮助。Agents 相比 probe/objectives 的全局选项缺少默认值，参数占位和缩进也不同。不能据此声称 Agents 的两次帮助彼此不同。

期望：共享帮助事实，按需提供操作帮助，保留必要 scope 解释，统一标题、参数占位、缩进与默认值；不把内部存在多个函数当作已确认问题，实际输出差异才是证据。

证据：[总帮助](./output-examples.md#help-agents)、[show 帮助](./output-examples.md#subhelp-agents)。

## F20 · P1 · JSON help 的内容与文字帮助严重不对等

```json
{
  "schemaVersion": 1,
  "command": "supervise"
}
```

这是 `pguide-supervise --help --format json` 的完整输出。probe 的 JSON `options` 仅有 `--pilot,--subject-file,--language,--revision,--report`，缺少文字帮助已有的 `--objective,--scope,--input-file,--report-dir,--no-reports`。Agents 的 JSON 又提供 subcommands/resourceSchema，结构深度不一致。

期望：机器帮助可发现当前支持的用法、选项、默认值及约束，与文字帮助共享真实定义；增补字段需说明兼容边界，不为了“统一”删除已有字段。

证据：[supervise](./output-examples.md#help-supervise)、[probe](./output-examples.md#help-probe)、[agents](./output-examples.md#help-agents) 的 JSON 对照。

## F21 · P2 · 迁移器复用 --format 表达不同语义，JSON 帮助用法不可推广到执行

```text
objective-contract-migrate --help
objective-contract-migrate --format manifest|declarations|portfolio --input <file> --output <new-file> ...

objective-contract-migrate --help --format json
```

第二条实际成功返回 JSON help，第一条的 `--format` 却表示输入文档种类，而非其他 CLI 的显示格式。用户不能由 JSON help 推断 `--format json` 可用于实际迁移。

期望：帮助明确区分迁移类型、报告显示格式和产物文件格式；定义一致且不冲突的机器帮助入口。保留旧迁移参数兼容，不直接挪用已有 `--format`。

证据：[help](./output-examples.md#migration-help)、[JSON help](./output-examples.md#migration-help-json)、[有效迁移](./output-examples.md#migration-manifest-valid)。

## F22 · P2 · 迁移成功无回执，输出格式由扩展名决定但结果未说明

```text
objective-contract-migrate --format manifest --input <FIXTURE>\legacy-manifest-valid.json --output <FIXTURE>\migrated-manifest.json
exit: 0
stdout: （空）
stderr: （空）
```

已检查产物存在并可解析；declarations 与 portfolio 的成功也无回执。重复写同一输出路径时才有 EEXIST 错误。用户看不到已保存位置、迁移类型、产物格式或输入保持未变的确认。

期望：若这是面向人的管理 CLI，提供明确回执及可选机器结果；若有意保持静默工具语义，应在帮助明确。不能把迁移产物本身的 schema 当作该工具的结果 envelope。

证据：[manifest](./output-examples.md#migration-manifest-valid)、[拒绝覆盖](./output-examples.md#migration-manifest-existing)、[declarations](./output-examples.md#migration-declarations-success)、[portfolio](./output-examples.md#migration-portfolio-success)。

## F23 · P1 · validate 对未知选项仍报告成功，成功回执可能误导

```text
pguide-validate pilot <FIXTURE>\repo\objective --bogus
Valid Objective Pilot: file:///<FIXTURE>/repo/objective/
```

退出 0，默认/Markdown/JSON 三种均如此。用户可能误以为其请求的选项已经生效；这不是单纯排版差异，而是影响输出可信度的相邻问题。

期望：就此明确规范化边界：不识别的参数不能产生无保留的“已按请求验证成功”。后续是否拒绝未知参数需要单独明确行为兼容；不要顺手扩展为无关业务重构。

证据：[未知选项](./output-examples.md#validate-unknown-option)、[正常验证对照](./output-examples.md#validate-valid)。

## F24 · P2 · 输入错误的文字输出仍暴露内部校验形状，合法选项提示不足

```text
pguide-probe --pilot <URI> --subject-file <FIXTURE>\subject.json --no-reports
Error: Invalid subject for <URI>: [{"instancePath":"","keyword":"required","message":"must have required property 'name'"}].

pguide-probe --pilot <URI> --subject-file <FIXTURE>\subject.json --language zh-CN --no-reports
Error: Unsupported language zh-CN for <URI>.
```

第一条是要求 name 的合成 subjectSchema，缺字段时直接内联 AJV 对象数组，用户必须从很长一行里解析字段和原因；第二条 fixture 仅支持 en-US，报错没有告知支持哪些语言。两者均实测退出 2，不是业务失败被当成功。

期望：人类模式清晰显示输入字段/位置、约束与修正方向；已知合法值应可发现。JSON 保留结构化证据，不把所有局部 JSON 示例一概移除；保留现有输入 guidance。

证据：[schema 错误](./output-examples.md#probe-schema-guidance)、[语言错误](./output-examples.md#probe-language-zh)。

## 不应作为缺陷修复的例外

- `config get` 的标量原值及对象 YAML、配置详情的必要原文，不应为了统一标题而被污染。
- `complete` 默认输出 shell 脚本，`--pguide-command-metadata` 固定 JSON，check/runtime 固定 envelope，报告文件是机器产物；它们不是“默认 JSON 不友好”的同类 bug。
- 固定协议可通过 envelope.status 表达失败而进程退出 0。实测 health/setup/self-check 的非法 JSON 为 status 400，monorepo 为 502；应按协议边界理解，不能仅看退出 0 就报告“假成功”。
- 观察、调节、监督的 schemaVersion 和顶层结构服务不同领域；不要求扁平成一个通用对象。统一的是展示层、帮助和可消费约定。
- 多行描述、Markdown 特殊字符、动态 ID 和长路径需要后续测试，本轮没有把尚未实现的表格转义或换行问题虚构成已复现缺陷。
