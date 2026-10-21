# 现状追踪与 setting 迁移候选

本文件为 [Idea.md](./Idea.md) 的准备支持材料；规则及行为阻塞项只在 [Configuration.md](./Configuration.md) 维护。依据为本 worktree 源码 `62d16b6fc4af`，未读取设备配置、原工作目录或其他 worktree。下面的行号均指该基线；“候选”不等于实施授权。

## 1. 当前主配置的完整边界

`packages\pguide-cli-core\src\index.ts:73-97,428-695` 集中定义 `PguideConfig`、YAML `parseConfig`、`LoadedConfig`、发现和合并。根必须 `schemaVersion: 2`，未知根字段一律失败，内嵌 agents 已拒绝；所有主配置消费者目前共用全量解析，尚无按 namespace 隔离。

当前读序为用户 `config.yaml` → 从有效 cwd 向上最近项目 `.pguide\config.yaml` → 可选 `--config` 文件 → 三个 `PGUIDE_*` 环境覆盖。每个文件先独立 parseConfig，再合并并重新校验；被项目覆盖的非法用户值目前也不会被隐藏。`reports`、`agentExecutionLimits`、`regulationStrategy`、`objectives` 特例合并一层，其他字段整体替换；`regulationStrategy` 内 probe/quota 对象已是整体替换。sources 主要按根字段，另为 objectives 每个别名记录来源。显式不存在文件报错，用户/项目缺失允许；用户路径遵循 Windows APPDATA 或非 Windows XDG_CONFIG_HOME。

新模型仅两级文件，旧合并不能照搬；语义错误隔离也必须真正改变入口加载策略，不能 `loadConfig` 先全局失败再过滤。中立加载器保留完整 ID/value/source/validation 状态，package 消费声明自己的 namespace 及共享 namespace；不以一个核心 `PguideConfig` 联合类型枚举第三方。兼容候选是在所消费 namespace 内继续检查每个选中层的显式值，再检查有效值；全量 validate 报各层问题，不用覆盖掩盖已知非法值，无关 namespace 才按已确认规则隔离。

## 2. Namespace 所有权与消费者候选

归属均由静态描述显式声明，下表不是从名称推断的运行时算法。`cli-core` 是共享 CLI 基础能力的功能名候选。同 package 的多个命令复用一个 namespace；函数所在 package 不必是 setting owner。

| Namespace | 唯一 owner package | 声明范围 | 实际消费者/边界 |
| --- | --- | --- | --- |
| `cli-core` | `@potential-guide/cli-core` | stateDirectory、保留的展示/语言字段 | 配置展示/校验、stateRoot；probe/regulate 报告目录间接使用；continue 状态定位。不能把未生效的语言/颜色字段说成已生效。 |
| `pguide` | `pguide` | commandDirectories、diagnoseAhpTimeoutMs | 根命令发现、dispatch/help/diagnose；只有 AHP diagnose 消费诊断 timeout。setup sanity 读取命令目录制作受控配置。 |
| `agents` | `@potential-guide/pguide-agents` | defaultAgent | regulate 新任务、setup/self-check configured；Agent CRUD 仍操作独立 agents.yaml。B3 已由主代理按保留现状选定。 |
| `pilot` | `@potential-guide/pguide-pilot` | probe、reportsEnabled、reportDirectory | probe；regulate/continue 共享 probe 和报告；supervise 的 goal/dependency observation 共享 probe timeout，但不读取报告设置或 retry，worker 策略不自动继承。B3 已由主代理按保留现状选定。 |
| `regulate` | `@potential-guide/pguide-regulate` | agentTimeoutMs、quota、permissions、retentionDays | regulate/continue；supervise 继续共享 quota 和 permissions；direct sanity 的超时兼容见 B5。 |
| `supervise` | `@potential-guide/pguide-supervise` | agentTimeoutMs | planner 与被调度的 Agent run 使用同一 supervise 超时，启动时取得。 |
| `objectives` | `@potential-guide/pguide-objectives` | aliases（只兼容旧 source alias） | config list/remove-objective、objectives list/show、objective-declarations 的 selectObjective、supervise resolveObjective。不代替独立 Objective declaration。 |

`config` 是编辑/校验工具，须理解所有已接入描述，不拥有其他 package 的 settings。`cli-runtime`、领域包及生成的 Objective runtime 是下游消费者，不需为了消费共享设置再声明第二个 owner。

## 3. 旧字段 → 完整 ID、默认值与约束

全部新 ID 是技术候选。表中“无默认”指静态描述不注入该 setting；不表示删除旧值。默认对象只在整个 setting 缺失时使用。所有 number 约束保留现有安全整数边界；timer 范围为 `1..2147483647`，允许零时另标。

| 旧 YAML v2 字段 | 新 setting ID 候选 | 整个 setting 缺失时 | 值约束、消费与迁移注意 |
| --- | --- | --- | --- |
| `schemaVersion: 2` | 不迁成 setting | 无 | 新主配置顶层只有完整 ID；旧格式身份明确拒绝，不能把 schemaVersion 当未验证扩展继续读。命令输出 envelope 的 schemaVersion 独立。 |
| `defaultAgent` | `agents.defaultAgent` | 无默认 | 非空字符串；只引用名称，是否存在由需要 Agent 的命令检查。regulate 无 `--agent` 且缺该值仍报错；supervise planner 不回退它。 |
| `commandDirectories` | `pguide.commandDirectories` | `[]` | 非空路径字符串数组，可为空数组；相对 globals.cwd 解析，保留顺序，不加目录权限授予或 PATH 自动注册。 |
| `defaultLanguage` | `cli-core.defaultLanguage` | 无默认 | 非空字符串；现有解析不验证 BCP47，命令实际使用显式 `--language` 或 Objective manifest 默认，不能顺便改变。 |
| `format` | `cli-core.format` | 无默认 | `markdown/json`；配置可展示但输出目前由 GlobalOptions 控制。CLI 自带 markdown 默认不是此 setting 默认。 |
| `color` | `cli-core.color` | 无默认 | `auto/always/never`；保留存储，现有 CLI global 默认 auto，未从主配置应用。 |
| `logLevel` | `cli-core.logLevel` | 无默认 | `error/warn/info/debug`；保留存储，现有 CLI global 默认 warn，未从主配置应用。 |
| `stateDirectory` | `cli-core.stateDirectory` | 无默认 | 非空字符串；缺失表示使用平台状态目录，非固定静态字符串。现实现 `resolve(config.stateDirectory)` 相对进程 cwd，而非必然 globals.cwd，不在迁移中偷偷改锚点。 |
| `reports.enabled` | `pilot.reportsEnabled` | `true` | boolean；拆成标量避免显式 reports 对象缺字段还回填默认。probe 的 `--no-reports` 优先，regulate/continue 只用配置；supervise 当前不读取它。 |
| `reports.directory` | `pilot.reportDirectory` | 无默认 | 非空字符串；缺失的语义是按状态根定位 reports 资源，不往配置填路径。相对 globals.cwd；probe `--report-dir` 优先。两个 reports 字段独立迁移，原 `reports: {}` 不生成值。 |
| `retentionDays` | `regulate.retentionDays` | 无默认 | 正安全整数；缺失不生成 expiresAt，未设置统一清理天数。只在新 regulation 计算过期时间；continue 不重算已存期限。 |
| `agentExecutionLimits.timeoutMs` | `regulate.agentTimeoutMs` | `1800000` | timer；regulate 的 `--agent-timeout-ms` 优先。有效旧显式值复制；旧 `{}` 不代表显式超时。continue 仍用存档预算而非新默认覆写。 |
| 同一旧 timeout | `supervise.agentTimeoutMs` | `30000` | timer；同时用于 planner 和调度 Agent execution。有效旧显式值复制；不因拆分改成 regulate 默认。 |
| 同一旧 timeout | `pguide.diagnoseAhpTimeoutMs` | `30000` | timer；只限制 AHP inspectAhp 初始化，ACP client.initialize 不加此期限。有效旧显式值复制。 |
| `regulationPermissions` | `regulate.permissions` | `{"ceiling":[],"grants":[]}` | 两个数组均必填；规则 id 唯一，grants 唯一且在 ceiling 内。read/edit resources 必须非空、唯一、绝对路径且无 glob；execute command 非空且无 NUL；规则无额外字段。整体替换，不合并扩大授权。 |
| `regulationStrategy.probe` | `pilot.probe` | `{"timeoutMs":30000,"retry":{"maxRetries":0,"delayMs":0}}` | timeout、retry 及 retry 的两字段都必填，无额外字段；maxRetries 非负安全整数；delayMs 为 `0..2147483647`。regulate 使用完整策略，probe 和 supervise goal/dependency observation 仅 timeout，不能新加 retry 或 worker 继承行为。 |
| `regulationStrategy.quota` | `regulate.quota` | `{"timeoutMs":300000,"maxAgentRuns":10,"maxStallRuns":3}` | **不拆分**。三字段均必填，无额外字段；timeout 为 timer，两个次数为正安全整数；supervise 同源消费。 |
| `objectives` | `objectives.aliases` | `{}` | name 匹配 `^[a-z0-9][a-z0-9-]*$`；值非空 path/Git URI 字符串且不以 `@` 开头。仅 source alias，不猜 inputSchema/subject。原按别名合并改为整个 map 替换，手工迁移须核对丢失的用户别名。 |

描述默认值来源：quota 在 `pguide-regulate\src\commands\regulator.ts:58-62`；probe 在 `objective-regulator\src\index.ts:556-566` 与 `objective-pilot\src\probes.ts:96,138`；空 permissions 在 `objective-regulator\src\index.ts:184-190`；其余见 E1–E6。迁移后主配置适配层从静态描述取默认并显式传给消费者，领域 API 自身的独立默认不得变成第二套配置来源；领域 API 契约不为这次主配置换名而改版。

### 手工迁移不是简单文本替换

1. 先列每个旧作用域的显式字段、旧合并后的有效值和来源，再按上表迁移。只在已加载的旧有效 timeout 有显式值时复制三份；不得将旧 regulate 的 fallback `1800000` 误复制成 supervise/diagnose 的默认。旧对象为空及仅某作用域提供字段要分别核对。
2. quota/probe/permissions 原有完整对象照搬；`reports` 分为两 setting。项目 `objectives` 原按别名叠加，新 map 整体替换；若要保留原有效别名，手工在项目新对象中明确列出需要保留的条目，不能让加载器恢复深合并。
3. 旧 `--config` 独有值只能由人选择归入用户或最近项目文件，不能偷偷创造第三层。旧 CLI 覆盖不是默认迁移进文件的值；`PGUIDE_*` 仍生效时来源必须区分（B4）。本次设备部署只迁用户配置，不擅自展开项目迁移。
4. 默认 Agent 引用不搬其 profile；模型 `gpt-5-mini`、工具权限/参数/凭据引用仍位于独立 Agent 或其 provider 配置。probe `90000` 是已要求保留的本机有效值，不是新的全局默认。不要以默认 `30000` 省略它。
5. 配置的 permissions 与 Agent 自身权限/confirmations 不能互相替代。除用户已确认的三超时拆分、两级浅合并及旧入口退出外，迁移遇到无法保留的实际行为须停止交主代理确认。

## 4. 所有主配置消费链及保留边界

| 入口 / 代码证据 | 当前行为 | 迁移注意 |
| --- | --- | --- |
| 根 `pguide` discover / help / dispatch / diagnose（E2） | commandDirectories → PATH → 部分 bundled fallback；同优先级不同路径冲突；configured 优于 PATH；跳过 PATH 中与 cwd 相同目录。dispatch 先执行 `--pguide-command-metadata`；JSON help 也调用外部 metadata。 | setting 描述发现独立于命令发现；“不执行命令拿描述”不等于移除已存在的命令协议探测。无关 namespace 语义错误不能在 dispatch 前全量阻断。 |
| `pguide diagnose agent`（E2） | 指定 profile，不用 defaultAgent；AHP 有主配置 timeout，ACP 无这条 timeout。 | 三超时拆分只改 AHP 路径；不能新增 ACP 30 秒期限。 |
| `pguide-config`（E3） | show/path/validate/get/list-objectives 和所有写入先 loadConfig；get 将点号拆路径，set/unset 禁止带点号；edit 先 stringify 后启动 VISUAL/EDITOR，再 parse/stringify 原子写回。 | 改完整 ID 操作及注释保留；B1 已确认允许未知 namespace 值写入并警告“未验证”，已知错误及结构错误仍拒绝写入，原文件不变；不添 force。 |
| `pguide-regulate` 新任务（E4） | defaultAgent 或 --agent；读取 state、retention、超时、permissions、strategy、aliases、报告；profile、预算、策略、语言、源绑定写入 regulation v3。 | 当前配置规则不等于存档格式；保持持久化预算/绑定，避免把既有存档当新主配置迁移。 |
| `pguide-continue` / run（E4） | 从当前 stateRoot 找存档；加载 agents 但使用保存的 profile；当前 permissions 每次重读，存档权限只作审计；用存档 timeout/probe/quota、历史 stall 计数及 pinned sources；报告用当前配置。 | 不能用新 defaultAgent/new defaults 覆盖存档，不恢复旧授权快照，不能复位累计 stall。不自动重迁或替换源 commit/tree。 |
| `pguide-supervise`（E5） | planner 必填；启动时取 timeout、共享 quota，probe timeout 用于绑定 goals/dependencies；权限可刷新。refresh 重读 Agent、配置、portfolio，更新 goals 的 probe 和 permissions；独立 dependency resolver 仍闭包引用启动配置，quota/Agent timeout 也非自动热更新。 | 保留共享 quota 和权限、原刷新边界；不误称全部 settings 动态生效。不赋予 planner 默认 Agent 回退，不把配置 probe 传播进原本没传策略的 worker。 |
| `pguide-probe`（E6） | aliases/selectObjective；只消费 probe.timeoutMs，不消费 retry；报告设置、--report-dir/--no-reports；--language 或 Objective 默认。 | 即使描述含 retry，也不把 CLI probe 改为重试。scaffold/validate 本身不 loadConfig；根 dispatcher 仍有命令发现。 |
| `objective-declarations` / `pguide-objectives`（E7） | --pilot 可经旧 alias 解析；--objective 从独立 declaration 选择；objectives list/show 同时报旧 aliases。migrate 显式读取旧主配置并移除 alias。 | 保留 alias 只读/移除行为；独立迁移 `--legacy-config` 需要旧解析专用路径，不能删除或被新主解析拒绝误伤（B5）。 |
| `objective-pguide-setup` / `objective-pguide-self-check`（E8） | 通过 `config show --format json` 消费主配置（不是 TS import）；要求 config.schemaVersion=2；读取 defaultAgent、commandDirectories、旧 timeout；context.cli 总传 --config。setup sanity 写隔离 schemaVersion=2 配置；direct sanity 用显式旧 timeout 与剩余 outer budget 的 min。 | 用户选择彻底删除 subject.configPath，不保留路径断言；输入迁移及文件存在性门槛见第 9 节/B5。同步运行协议、subjectSchema/声明投影及生成产物；保留预算/权限规则，不机械套用 30 秒或泄漏真实用户 state。 |
| `cli-runtime` / `objective-pilot` evidence 与 probes（E9） | 主命令传 probeTimeoutMs/reportOptions；环境控制 evidence 禁用、状态目录、probe runtime 元数据。supervise 经 bindPilot，不消费报告 setting；独立 evidence fallback 用环境/系统目录。 | 不将所有运行元数据变成 settings，也不新增 supervise 报告开关继承。 |

领域包 `objective-regulator`、`objective-portfolio-supervisor` 不直接加载主配置；由 CLI 适配器传策略/预算/权限。`pguide-regulate\src\regulation-process.ts` / `regulation-worker.ts` 经 IPC 执行 supervise 的显式 task，不重新读取主配置来覆盖 supervisor 预算。特别是 `objective-portfolio-supervisor\src\coordinator.ts:339-347` 只传 target/quota/agentExecutionLimits 构造策略，没有传配置 probe；worker 的 `probeTimeoutMs` 取 input.spec.strategy.probe（缺失则领域/运行时原默认生效），这与 supervise 自己 observation 使用配置 timeout 是两个边界。不能借配置整理顺便修成全链共享。这些边界必须用消费测试而非仅 parser 测试验证。

## 5. CLI / 环境入口：删除已批准项，其余不自动删除

| 入口 | 现状及候选处理 |
| --- | --- |
| `--config`、主配置 `--scope explicit` | 已确认移除。共同 `extractGlobals`、root `globalArguments/topLevelFlag`、所有直接包装入口及帮助都要明确拒绝；包括 `--config=value` 这类旧拼法也不能被宽松命令静默丢弃。`--` 后属于被转交的参数，不擅自扫描并删除 payload。 |
| `--cwd` | 保留有效工作目录用于项目发现、命令目录和资源上下文；当前 --config 自身相对进程 cwd，迁后无此入口。不要把所有现存相对 state 路径顺便改为相对 --cwd。 |
| `--format`、`--color`、`--log-level`、`--help/--version` | 保留现有提取与转发；默认 markdown/auto/warn，值校验仍在 globals。配置中同类字段并未被用于 globals，若要激活是新增行为（B4）。 |
| `PGUIDE_FORMAT`、`PGUIDE_LANGUAGE`、`PGUIDE_STATE_DIRECTORY` | 当前文件之后覆盖并参加解析，sources 为 environment。前两项只改变已加载值，不自动控制输出/语言；STATE_DIRECTORY 实际影响状态/报告。推荐保留运行时覆盖，不叫第三配置文件层（B4）。 |
| `APPDATA`、`XDG_CONFIG_HOME`、`LOCALAPPDATA`、`XDG_STATE_HOME`、HOME/USERPROFILE | 原系统用户/状态目录回退保持；不能因 config.jsonc 改名重定向 agents.yaml/objectives.yaml。 |
| `PATH`、Windows 命令扩展、`VISUAL/EDITOR` | 保留命令发现/执行以及用户显式编辑器启动；“不执行扩展获取描述”不禁止用户主动 config edit。 |
| regulate `--agent/--agent-timeout-ms/--language`，supervise `--planner/--execute/--duration-ms` | 保留原覆盖/必填及执行边界；duration 是 supervise 会话期限，不是 Agent timeout；不自动迁成 setting。 |
| probe `--report-dir/--no-reports`，probe/regulate/continue `--report` | 前两项只在 probe 接受，后者是结果输出文件而非 evidence 目录；regulate/continue 不能因为共用 helper 就开始接受前两项。 |
| `--pilot/--objective/--scope/--input-file/--subject-file/--revision/--target` | 保留原各命令允许集合、Objective 定位和 pinned source 规则；非主配置 scope（agents user/project、objectives user/directory）不删除。 |
| `agents/objectives --from/--legacy-config` | 保留独立资源读写/迁移职责；不恢复主配置覆盖层，不自动重复迁移。专用旧解析和 configPath 调整见 B5。 |
| `PGUIDE_PROBE_TIMEOUT_MS/PROBE_TEMP_DIR`、`PGUIDE_EVIDENCE_CONTEXT/EVIDENCE_DISABLED`、`PGUIDE_TIMINGS` | 运行时/证据/诊断元数据，不是新的主配置作用域；继续原校验及传播。不要把 probe 环境期限误当第四个 Agent timeout setting。 |
| ACP transport.env、AHP authentication 的 tokenEnv/resources 引用 | 属于独立 Agent 资源；AHP 当前声明环境变量名，不新增 keychain 主配置字段。不得扫描真实值写进新主配置或证据。外部 provider 自身凭据存储、环境隔离和工具授权按原边界保留。 |

**项目写目标的易混淆现状：** `config --scope project` 当前写 `globals.cwd\.pguide\config.yaml`，不是 loadConfig 找到的最近祖先文件（E3:21-25）；B4 已选定仍用同规则改后缀。这可能创建新的最近层，应显示实际目标，不改成编辑祖先。

**资源救援不等于忽略坏配置继续执行：** 根命令对 `agents migrate/path/--help` 有 bundled 直达通道，不先 discover/loadConfig（E2:473-490）；直接 `pguide-agents` 的资源 CRUD 也不读取主配置。`complete`、顶层 version 及 wrapper metadata/help 有相应独立路径。B4 已选定保留这些通道；普通消费命令不能用它们绕过结构错误。

## 6. 独立资源定位与旧格式拒绝

- `agentsPaths`（E10）向上搜索：遇最近主配置锚点立即选该 `.pguide` 目录；若完全没有主配置锚点，才用已发现的最近 agents.yaml，再无则有效 cwd 的 `.pguide`。因此更近的“仅 agents.yaml”可能被更远的主配置锚点覆盖，不能简化成“永远最近 agents.yaml”。候选加入新文件锚点识别，普通主配置加载仍拒绝旧/新并存；B4 的资源救援继续保留旧锚点定位，但不解析旧文件作运行主配置，不能偷偷移动资源范围。
- 用户 Agents 路径为 `dirname(userConfigPath())\agents.yaml`；project 同名 profile 整体覆盖 user，资源读取拒绝 symlink/非普通文件。名称、原格式、秘密引用、迁移锁/备份边界保持；主配置 `--config` 从来不是第三个 Agent scope。
- Objective declaration 用户路径为同用户目录的 `objectives.yaml`，directory scope 是 **有效 cwd 下的 `objectives.yaml`**，不是 `.pguide\objectives.yaml`，不随主配置向上查找。这里不要套用 Agent 搜索规则。参见 E7:61-95。
- 旧主配置发现以原来读的位置和最近项目锚点为依据：遇到最近旧 `config.yaml` 不能越过它偷选更远新 `config.jsonc`；同目录新旧并存必须失败。不能因查找新后缀而把旧文件当不存在；未被选择的更远祖先也不应新增“逐层叠加”。
- `agents migrate --legacy-config` 的旧 YAML 只供显式独立资源迁移，`objectives migrate` 同理；普通 `config show/validate` 仍拒绝旧格式。这不是新增主配置自动迁移命令。

## 7. 描述发现与打包可行性候选

元数据名称候选及已确认 B2 注册信任策略见 Configuration.md。同位置/同身份/同 namespace 升级重校验而不逐版本确认；记录损坏或已注册 package/描述缺失、损坏明确失败，不降格成未注册 namespace。描述最少须表达 owner namespace、完整 ID、类型/约束、整个 setting 的静态默认、可选缺失语义和说明；复杂对象可用静态 schema 表达，但不允许可执行校验模块或远程 schema 拉取。namespace 名候选使用现有命令风格 `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`，ID 以显式 namespace 加 `.` 开头，不创建嵌套对象。静态描述自身、默认值和 package 身份要先验证，再用来解释两个值作用域。

内置构建从所属 package 元数据收集静态描述，生成可随入口交付的描述集合；不靠执行 `--pguide-command-metadata`，不靠任意当前目录中的 package 或 PATH 猜归属。第三方按已确认 B2 以明确安装根目录接入；定位失效时报告恢复办法，不扫描网络、npm 缓存或全盘寻找替代 package。

打包必须实际验证的边界（均为后续实施，不在准备阶段生成产物）：

- `packages\pguide*\package.json` 的 `files` 主要只含 dist/README，构建主要是 `tsc -b`；源码旁新增 JSON 不保证进 tarball。元数据引用须指向实际打包文件，复制/生成任务纳入现有 workspace build/Turbo，不增加第三方运行时安装器。
- `pguide` 的 runtime dependencies 有 agents/config/objectives/pilot，却把 regulate/supervise 留在 devDependencies；`scripts\release-packages.mjs:84-99` 禁止把 regulate/supervise 变成 pguide runtime dependencies。共享静态描述接入不能破坏分层或通过导入命令实现拉入它们；直接 wrapper 与根入口必须获得一致的已接入内置描述。
- 全部主包装入口：`pguide`、`pguide-config`、`pguide-agents`、`pguide-objectives`、`pguide-probe`、`pguide-scaffold`、`pguide-validate`、`pguide-regulate`、`pguide-continue`、`pguide-supervise`。`objective-contract-migrate` 是另一个独立文档迁移 bin，不是旧主配置 `--config` 包装入口。
- `scripts\check-packages.mjs`、`check-package-consumers.mjs`、`verify-deployment.mjs` 及 package 测试中大量 v2/--config fixtures 须迁移，另保留明确拒绝旧入口的负例。不能只在 monorepo 源码可读时通过，须从 tarball 消费验证描述及 CLI。
- setup runtime 由 `scripts\build-setup-runtime.mjs` bundle；self-check runtime 由 `scripts\build-self-check-runtime.mjs:76-82` 从 `objective-pguide-setup\src` 复制生成。修改源头后用现有构建刷新产物，不手改 generated 文件；对应 Objective subject schema/README/references 中 configPath、旧字段说明与预算要一致。

## 8. 后续验证证据边界

准备阶段只做文档布局校验，不执行这些测试，不把下列列项记为完成：

- 配置层：`pguide-cli-core\test\config.test.ts`、`pguide-config\test\config-command.test.ts`，覆盖两级浅合并/完整 ID、整项默认及来源、显式对象必填、未知 namespace、已知未知 key、JSONC 重复/语法、旧/新文件发现、未验证保存（B1）。
- 消费与资源：`pguide\test\cli.test.ts`、`regulator-cli.test.ts`、`regulation-process.test.ts`、`supervisor-cli.test.ts`、`ahp-cli.test.ts`、`objectives.test.ts`、`pguide-agents\test\agents.test.ts`，特别验证三个 timeout 默认/复制、共享 quota/probe、continue 权限重读、独立资源锚点及所有旧入口拒绝。
- 间接调用：`objective-pguide-setup\test\setup-objective.test.ts`、`objective-pguide-self-check\test\runtime.test.mjs` 和生成产物 check，验证 config show 协议、configPath 彻底移除及输入迁移、隔离 fixture、direct sanity 不缩预算/放权。运行元数据测试与 packed 消费覆盖 E8/E9。
- 实施最终运行 `pnpm check`。部署另在主代理批准后核验全局命令、设备实际配置、默认 Agent/模型/权限/probe90秒及资源；本文件没有任何本机已迁移或验证成功的证据。

## 9. 彻底移除 setup/self-check configPath：最小输入迁移候选

用户已选择“彻底移除”，不是保留路径断言。本节只追踪源码及提出准备候选，未读取设备配置或设备上的 Objective 声明。剩余行为决定仅为 Configuration.md 的 B5a/B5b。

### 9.1 configPath 实际承担的语义

| 位置 | 现状及移除影响 |
| --- | --- |
| 两个 package 的 `objective.yaml:2-8`、setup `src\contract.mjs:27-62` | manifest 的 subjectSchema 为 `additionalProperties:false`，configPath 在 properties 和 required 中；helper 还要求它是目标机绝对路径（SSH 用 POSIX 判断）。即使只做 installation，subjectValue 也先要求该字段，但 installation 不读取其文件。新 manifest 与 helper 必须一起去掉 required/properties/允许字段及该位置的路径校验；尤其当前 `required.slice(0,3)` 不能在删字段后照留，否则会把 pguide 对象当路径，须明确只校验 workingDirectory/scratchDirectory。旧字段在新契约中应给明确退役诊断，不能仅改 schema 而留下 helper 要求。 |
| setup `src\configuration.mjs:4-44` | 先检查安装，然后 `lstat(subject.configPath).isFile()`；ENOENT → configuration-missing，非普通文件 → configuration-invalid；其他 IO 错误走外层错误处理。随后 help/config show/agents show 使用 workingDirectory 和 configPath。这里既有“指定文件必须存在”的门槛，又有“作为 explicit 层覆盖”的行为；删参数不等于已决定是否取消存在性门槛（B5a）。 |
| setup `src\execution.mjs:231-244` | context.cli 的第二参数为配置路径，默认 subject.configPath；调用命令加 `--config <path> --cwd <context> --format json`。configPath 不改变实际 child cwd（默认独占 scratch），也不决定 Agent scope。新内部调用只传操作参数及发现 cwd，不增加改名后的配置路径参数。 |
| setup `src\sanity.mjs:20-45,62-88` | 自己创建的 sanity-config.json 是另一个 explicit override，不是 subject 原文件；probe/regulate 的 context.cli 会改传它，以独占 fixture 仓库作 --cwd。因此删除 subject 字段与移除内部 arbitrary-file overlay 要一起做；新 fixture 配置放仓库的 `.pguide\config.jsonc`。 |
| setup `src\runner.mjs:16-48,56-92`、`src\direct-sanity.mjs:15-29` | sanity 前重新 configured；setup 需 allowSanity，self-check 无该输入/门，执行一次 direct repair，不嵌套 regulate。direct repair 间接使用配置选中的 Agent 与显式旧 timeout，不直接读取 configPath。删除字段不改这些预算、授权、重试及执行次数。 |
| setup `ssh-target.mjs:48-87,91-104` | SSH payload 将 subject 去掉 target/userHome 后传给 B，当前 configPath 随 subject 原样传递并在 B 使用；不上传 A 的配置。新 payload 不含该字段，仍只用 B 的 workingDirectory/用户环境发现；不新增从 A 传配置、HOME 或 token 的能力。 |
| 生成物/文档/fixtures | setup runtime bundle、self-check runtime/src 的四处共享源码副本都须由现有生成脚本更新；两个 README、setup bootstrap/configuration/configuration-missing references、setup-objective.test.ts、pilot-packages.test.mjs、verify-deployment.mjs、self-check-docker\verify.mjs 的 subjects/命令要同步。配置保护测试仍须比较原文件未变，不因删路径输入删掉保护断言。 |

同名变量并不都属于本输入：`objective-monorepo-standard\src\delivery-worker.ts` 的 configPath 是 delivery 配置定位，`pguide-config\test` 中许多 configPath 只是测试文件变量；不做仓库范围机械删除。package 自带的两个 `objectives.yaml` 都是 monorepo standardize 声明，Unit input、不是本机 setup/self-check 调用声明，不能误改。

### 9.2 三种 schema / source 身份不能混为一谈

- **Manifest 外层身份：** 两个 `objective.yaml` 使用 `.../schemas/objective/v1.json`，是通用 Objective 文档格式；configPath 只在 package 自有 subjectSchema 中。当前 subjectSchema 没有单独 `$id`、`version` 或 `$schema`。移除该属性和 required 项改变的是这个 Objective 的 subject 契约，不要求把通用 manifest schema 升成 v2。
- **声明外层身份：** 设备 `objectives.yaml` 仍是 `.../schemas/objectives/v1.json`；条目只支持 description/objective/inputSchema/subject，不存在条目版本字段（`pilot-protocol\src\objectives.ts:23-79`）。不回退到 schemaVersion，不重跑文档格式 migration。
- **inputSchema：** 它校验 `--input-file` 的原始输入，subject 是 JSONata 投影结果，后者还需通过 manifest.subjectSchema（同文件 `projectObjective/bindObjective:81-147`）。仅当某声明的 inputSchema 真正包含/依赖 configPath 才修改其 properties、required、依赖与实际输入；不能因 subject 有该字段就声称每个 inputSchema 都有。若投影仅硬编码路径，最小修改只删投影属性，inputSchema 原封不动。
- inputSchema 可省略，缺省为 Unit `{const:{}}`；只有 Unit 可省略输入，其他输入仍须 `--input-file`。移除唯一的 configPath 输入若使 schema 变为 Unit，是否可省略输入沿用现有判定，不能把仍含其他必填字段的 schema 一并清空。`compileInputSchema` 按内容缓存，以 Draft 2020-12 编译，只接受本地 `#/$defs/` 引用，不要求 schema `$id`/版本（`validation.ts:187-243`）。设备若有自行命名的 `$id` 或嵌套条件/引用，部署时按实际内容审查，不臆造新 URI、不用字符串替换破坏约束。
- **执行身份：** 新 subjectSchema/runtime 改变 Git source tree/revision（`pilot-protocol\src\definition.ts:21-56`）；新调用须使用包含新契约的已验收源码快照。旧 pinned revision/continue 存档仍指旧契约，不能改存档 subject/commit/tree 来伪装迁移成功。声明内容修订也会改变其文件 revision（`objective-declarations\src\index.ts:66-76`），不靠一个虚构的 inputSchemaVersion 切换。

### 9.3 删除字段后的发现上下文与隔离（保留现状，不另设审批问题）

1. **诊断目标仍是 workingDirectory。** configured 的 help/config show/agents show 全部显式传同一个目标 `--cwd subject.workingDirectory`，读取目标用户级与最近项目级配置及原独立资源。真实 child cwd 仍可在 scratch，Agent 操作 cwd 仍在独占 task/fixture；不能误用 process.cwd() 或 scratch 查被诊断配置。外层运行此 Objective 的 probe cwd 与 subject.workingDirectory 是两个上下文：前者决定外层 probe 预算，后者决定被诊断目标，不自动合并。路径/来源展示应可核对两者。
2. **用户目录/环境入口不改义。** 当前 userHome 只设置 HOME/USERPROFILE；Windows APPDATA、非 Windows XDG_CONFIG_HOME 等仍可能优先，不能把 userHome 升级成新的配置根选择器。PGUIDE_FORMAT/LANGUAGE 在 helper 中继续清除，PGUIDE_STATE_DIRECTORY 继续指向独占 state，已有 Git 隔离仍保留。SSH 仍用 B 的用户环境，不把 A 的配置或认证带过去。
3. **setup fixture 改成真正项目配置，不复制真实配置文件。** 在自有仓库 `.pguide\config.jsonc` 明确设置已选择的 Agent 名、解析为绝对路径的命令目录、独占状态目录、原有 bounded quota/Agent timeout/probe timeout+retry。相邻 agents.yaml 仍只放原选定 profile 的副本，不改 provider/工具授权或凭据引用。下层用户配置仍存在，故须核对新旧 fixture 实际权限原对象：显式冻结原有有效 `regulate.permissions`（缺失为空 ceiling/grants），不合并、不新造规则、不把绝对授权资源重写成 fixture 路径来自动授予权限。若新旧有效权限无法等价保留，应失败交主代理处理，不能为让测试通过放宽。
4. **禁止因路径迁移恢复外部写入。** 原 `PGUIDE_EVIDENCE_DISABLED=1` 继续生效，fixture 可显式 `pilot.reportsEnabled:false` 表达同一意图；不能继承用户 reportDirectory 后写真实报告位置。--cwd fixture 指向最近自有项目层，不借用祖先项目配置；仍保持独占 scratch/state 清理及不改真实用户主配置的测试。这里仅列已需要隔离的字段，不引入安装器/通用 sandbox/新权限系统。
5. **self-check 不变成 setup。** 保留 direct sanity 的一次 allow_once/marker 检查边界，不嵌套 regulate，不添 allowSanity 门、不自动 allow_always。配置显式 regulate 超时与原剩余 outer budget 取限；缺失时原 outer budget 不因 supervise/AHP 的 30000 默认被压缩。setup 自身仍需原 allowSanity 授权。

B5a 推荐通过配置加载器/路径报告的实际读取来源判断“至少一份文件存在”；不能仅因 `paths.user` 返回预期路径字符串就算文件存在，也不能以默认值的 package source 代替文件证据。零文件方案若被选定，须同步 configuration-missing 的语义/文档/测试，不悄悄删掉原检查。此为仍待用户选择的唯一运行行为分歧。

### 9.4 本机已有声明的最小手工迁移候选（B5b 待授权）

- 部署时才从准确 user/directory scope 找到真正引用两个 Objective 的目标条目，备份实际文件；准备阶段不读取设备文件，也不假定条目名称、表达式、inputSchema 或秘密内容。主配置迁移不自动重建独立资源。
- 若 JSONata subject 只写了 `"configPath": "旧路径"`，只移除该输出属性；若写成 `input.configPath`，同步删专属 inputSchema.properties.configPath、required 中这一项及相关输入文件属性。若投影整体转交 input、使用 merge 或本地 `$defs`，须证明最终 subject 不再输出该 key，局部改投影/被引用的对应约束而不是清空整个 schema。保留所有其他 required/范围/类型约束。
- 直接 `--subject-file`/stdin 的输入同样移除这个属性；声明的 `--input-file` 与最终 subject 是两类文件，不混改。用户级 objectives.yaml 与 effective cwd 的 directory objectives.yaml 路径保持原位置；不搬到 `.pguide`、不新增默认绑定、不重新运行 agents/objectives migrate。
- 最小范围允许改目标条目的投影和确实依赖该字段的输入约束/输入值；若原 configPath 指向自动发现范围以外的文件，**仅删字段不能保留有效配置**，须先由主代理按两级配置规则手工核对/迁移该文件有效值，不能改 workingDirectory/userHome 去偷偷恢复原 explicit 层。模型、工具权限、probe90秒等照常逐字段核对。
- 新 snapshot 拒绝旧 configPath（候选，不静默忽略）；实现提供明确退役指引，包括从新 subject/声明投影移除字段。先静态 parse/project/bind 验证声明及 target subjectSchema，更新实际调用的已验收 source revision，再做已授权的非破坏性设备验证；不为验证迁移自动启动额外付费 sanity。保留备份与原 revision 的配套恢复条件，不改旧存档或宣称旧 snapshot 支持新 subject。

## 源文件索引

路径相对当前 worktree；不是其他 idea 文档，也不依赖设备配置快照。

| 证据 | 文件及关键范围 |
| --- | --- |
| E1 | `packages\pguide-cli-core\src\index.ts:73-108,137-145,428-695,719-726,766-817,882-919,945-988`：类型、约束、发现、合并、环境、报告/state、globals、retention、wrapper；`src\permissions.ts:1-65`：权限结构约束。 |
| E2 | `packages\pguide\src\bin.ts:29-175,178-206,270-307,342-390,435-505`：命令发现/协议执行、globals 转发、diagnose、资源救援。 |
| E3 | `packages\pguide-config\src\bin.ts:21-34,73-141,143-213`：路径、读写、点路径限制、editor、旧 alias；`src\help.ts`：对外帮助。 |
| E4 | `packages\pguide-regulate\src\commands\regulator.ts:58-99,337-350,388-419,479-486,531-618,622-720`：共享 quota、持久化/continue、权限、超时、报告；`src\regulation-process.ts`、`regulation-worker.ts`：supervise IPC task 边界。 |
| E5 | `packages\pguide-supervise\src\commands\supervisor.ts:73-124,225-305,377-442,515-605`：绑定、planner、Agent task、共享 quota/probe/permissions 与 refresh；`packages\objective-portfolio-supervisor\src\coordinator.ts:339-347`、`packages\pguide-regulate\src\regulation-worker.ts:135-141`：worker 未继承配置 probe。 |
| E6 | `packages\pguide-pilot\src\commands\pilot.ts:34-94,106-150`：probe 参数、报告、语言；`packages\objective-regulator\src\index.ts:184-214,556-566`；`packages\objective-pilot\src\probes.ts:96,138-179`：默认、probe 元数据。 |
| E7 | `packages\objective-declarations\src\index.ts:61-95,284-330`；`packages\pguide-objectives\src\index.ts:22-104`：资源路径、选择、legacy alias、迁移直接调用 parseConfig。 |
| E8 | `packages\objective-pguide-setup\src\configuration.mjs:4-44`、`execution.mjs:139-160,231-244`、`contract.mjs:27-62`、`sanity.mjs:20-45,62-88`、`direct-sanity.mjs:15-29`；`scripts\build-setup-runtime.mjs`、`build-self-check-runtime.mjs:76-82`：间接消费者与生成来源。 |
| E9 | `packages\cli-runtime\src\pilot-source.ts:156-162,517-529,594-628`；`packages\objective-pilot\src\evidence.ts:73-80,186-203,287`：运行时选项、状态/报告 fallback 与 evidence 环境。 |
| E10 | `packages\pguide-cli-core\src\agents.ts:60-134,172-219`；`packages\pguide-agents\src\bin.ts:28-50,104-151`：锚点搜索、独立资源安全读写、旧资源迁移。 |
| E11 | `packages\pguide\package.json`、`packages\pguide-cli-core\package.json`；`scripts\release-packages.mjs`、`check-packages.mjs:98-128`、`verify-deployment.mjs:331-385,729-809,850-888`：入口/打包/旧 fixtures；根 `package.json`：现有 check/build 链。 |
| E12 | `packages\objective-pguide-setup\objective.yaml:2-8,23-24`、`packages\objective-pguide-self-check\objective.yaml:2-8`；setup `src\contract.mjs:27-62`、`configuration.mjs:4-44`、`execution.mjs:139-160,231-244`、`runner.mjs:16-48,56-92`、`ssh-target.mjs:48-104`：必填字段、文件门槛、发现/真实 cwd、SSH 语义。 |
| E13 | `packages\pilot-protocol\src\objectives.ts:23-147`、`validation.ts:187-243`、`definition.ts:21-56`；`packages\objective-declarations\src\index.ts:61-76,284-352`：schema 身份与输入/投影分层、声明来源、Unit、snapshot。 |
| E14 | setup `test\setup-objective.test.ts:301-312,1131-1150`；两个 package 的 `objectives.yaml`、README；`scripts\build-self-check-runtime.mjs:76-105,142-164`、`pilot-packages.test.mjs:109,151`、`verify-deployment.mjs:725-810`、`self-check-docker\verify.mjs:12-61`：缺文件负例、非目标 standardize 声明、生成物及调用迁移范围。 |
