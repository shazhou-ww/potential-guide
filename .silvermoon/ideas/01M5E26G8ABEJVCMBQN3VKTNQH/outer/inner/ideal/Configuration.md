# 主配置准备规则与行为阻塞项

本文服务于 [Idea.md](./Idea.md)。状态仍为 preparing / downstream / unsubmitted；以下区分用户已确认规则、技术候选和需用户决定的行为，不授权实施。详尽现状、旧新映射及源码索引集中在 [Settings.md](./Settings.md)，不在多处重复维护。

## 已确认：存储与合并

- JSONC 是唯一新主配置；用户级使用系统用户配置目录的 `config.jsonc`（Windows 为 `%APPDATA%\pguide\config.jsonc`），项目级从命令有效工作目录向上只选最近的 `.pguide\config.jsonc`，不叠加祖先项目配置。
- 顶层 key 是完整 setting ID，点号不是对象路径。用户级后叠加项目级，按 key 浅合并；同 key 的对象、数组整体替换，不深合并或拼接。
- 显式对象不补字段默认：必填缺失报错，可选缺失含义由描述明确。仅整个 setting 在两级均缺失时，才采用所属 package 静态描述中已通过约束校验的整个默认值。可选且无默认的 setting 保持缺失；必需项在相关命令消费时缺失则报错。
- 默认值不写回，来源可见；消费者不得另藏 setting 默认值。
- 移除所有主配置 `--config` 入口及依赖它的 `config --scope explicit`；旧入口明确报错并说明两级替代方式，不能静默忽略。其他 CLI、环境、凭据和独立资源入口不因本项自动删除。
- 应读取位置出现旧 YAML 主配置时拒绝并要求手工迁移；新旧并存失败，不选择其中一份、不普通读取时改写。只提供手工迁移说明，不新增主配置迁移命令；迁后旧文件移出发现位置。

## 已确认：归属、描述与校验

- namespace 按 package 功能后缀约定，package 显式声明所有权，核心不从包名猜。不同 package 冲突失败，同 package 多命令可共用。第三方新增设置不修改核心全局类型。
- 描述为随 package 交付的静态 JSON，由 package 元数据引用；内置随构建接入，第三方由外部工具安装后显式接入一次。描述与设置值的两个作用域无关，不逐项目注册。
- 不新增安装器，不通过执行扩展获得描述，不因 PATH 命令发现自动信任描述；描述接入不授予执行权限。载体已确认，不再列为待定。
- 未加载 namespace 描述的值保留并标未验证。已知 namespace 中未知 key 或非法值是错误，保留原文不静默忽略。
- 全量 `config validate` 报全部问题；已知描述的语义错误导致失败，未知描述本身不导致失败，但不可把未验证项称为已验证。
- 命令校验其相关 namespace，包括共享消费；无关 namespace 语义错误不阻断。JSONC 语法、重复 key、namespace 冲突等结构错误不可通过“无关”绕过。

### B1、B2：用户已确认，不再待定

- **B1 写入：** 允许 `config edit/set/unset` 保留及写入未知 namespace 的值，明确警告“未验证”，不称为验证成功；已知 namespace 的非法值/未知 key 及结构错误仍拒绝写入，原文件不变。此为已明确批准的写入政策变化，而不是从读取容忍推导的授权。
- **B2 接入与升级：** 按原建议使用用户配置目录中的独立接入记录（候选名称 `settings-packages.json`），保存 package 身份与安装根目录，读取元数据指向的包内静态 JSON 并校验身份、namespace、描述和默认值。同位置、同身份、同 namespace 升级重新校验后使用，无需逐版本确认；身份/namespace 改变须重新显式接入。相同根目录重复发现去重，冲突的同 package 描述失败。
- 注册记录损坏，或已注册 package/描述缺失、损坏时明确失败；这是描述装配失败，不能降格为未知 namespace 或按无关语义错误跳过。未注册 namespace 的值仍保留为未验证。既有不读取主配置的资源救援通道按 B4 保留。接入不授予执行权限，不增加签名服务、hash 审批链或安装器。

## 已确认：共享、迁移与部署边界

- 第一版 quota **保持一个共享对象，不拆分**；supervise 继续消费。具体候选为 `regulate.quota`，三个必填字段及默认值见映射表。
- Agent 执行超时拆为 regulate、supervise、`pguide diagnose agent` AHP 初始化三个独立 setting。旧 `agentExecutionLimits.timeoutMs` 有有效显式值则分别复制到三者；没有则分别保持 `1800000`、`30000`、`30000` 毫秒。不改变 ACP 诊断或独立 probe 预算。
- Agent 完整定义、Objective 声明继续独立；默认 Agent 只存名称引用，不嵌入连接、模型、工具授权或秘密。换主配置文件名不能切断独立资源定位，也不重新迁移已独立资源。
- 部署由主代理在后续阶段使用已验收 worktree build，全局安装 pguide 及全部包装入口，备份后手工迁移实际本机配置；逐字段核验默认 Agent、`gpt-5-mini`、工具权限、probe `90000` 毫秒及独立资源。准备阶段不读取设备秘密、不更换全局入口、不改设备配置、不发布 npm。

## 技术命名候选（不作为新的行为批准）

完整 setting ID、namespace owner/consumers、静态默认和约束以 Settings.md 的表为唯一候选清单。普通技术选择：描述文件名 `settings.json`，元数据 `package.json` 的 `pguide.settings` 指向包内相对路径；描述以 `schemaVersion: 1`、`namespace`、`settings` 表达，package 身份以该元数据的 `name` 核对。主配置候选不再携带旧 `schemaVersion: 2`，顶层只放完整 setting ID；描述版本与命令输出 envelope 的版本不是主配置 setting。

JSONC 编辑推荐保留原始文本、未编辑 key 的注释/顺序，以局部修改替代整文件 YAML stringify；完整 ID 的 `get/set/unset` 不作点路径访问，`set` 的值改为 JSONC 值而不是 YAML。此为新格式的技术候选；未验证内容的写入已按 B1 获准。

保留系统资源目录定位的候选：stateDirectory/reportDirectory 缺失仍不注入 setting 值，由描述说明“按平台/状态根定位资源”的缺失语义，展示时区分计算的资源路径与静态默认来源；不把依赖机器环境的路径伪造成固定 JSON 默认。

## 主代理审查：保持既有行为

依据用户对本 idea 的代理门限审批授权，B3、B4 按源码证据选择不改变既有行为的兼容方向，不作为新增功能授权：默认 Agent 与 probe 的 owner 命名采用下表候选，但保留现有消费者和传播边界；除已明确移除的主配置入口外，保留现有 CLI、环境覆盖和不读取主配置的资源救援通道，不激活当前仅存储的展示/语言设置。项目写目标仍为有效 cwd 下的新配置位置，并展示目标。后续用户已确认 B1、B2；B5 的输入契约迁移仍须用户确认，不能以代理审批替用户决定。

## 已由主代理审查选定：B3、B4

| ID | 已选定的保留边界 | 具体契约 |
| --- | --- | --- |
| B3 | 默认 Agent 与 probe 保持共享归属及原消费边界 | `agents.defaultAgent` 归 `@potential-guide/pguide-agents`，regulate 与 setup/self-check 共同引用；不让 supervise 的 `--planner` 或 diagnose 自动采用它。`pilot.probe` 归 `@potential-guide/pguide-pilot`，regulate 消费 timeout+retry，probe 及 supervise 的 goal/dependency observation 只消费现有 timeout，不新增重试，也不顺便把该策略传入 supervise worker（目前未传）。不借换名拆成各命令独立配置或扩大消费。 |
| B4 | 其他运行入口及配置修复路径按现状保留 | 保留 `PGUIDE_FORMAT/LANGUAGE/STATE_DIRECTORY` 运行时覆盖（不算第三文件作用域，来源为 environment）、其余 CLI/凭据入口和现有配置独立的资源修复路径。`format/defaultLanguage/color/logLevel` 当前多数只存储/展示，不顺手激活。`config --scope project` 仍写有效 cwd 下的新文件并显式展示目标。不把不读取主配置的救援命令变成主配置消费者。独立 `agents/objectives migrate --legacy-config` 保留专用旧 YAML 读取，既不恢复主配置覆盖层，也不自动重迁资源。详见 Settings.md 入口表。 |

## B5：彻底移除 configPath，输入契约迁移仍待确认

用户已选择彻底移除 `subject.configPath`，不再推荐“保留为路径断言”、可选旧字段或改名后的第三层入口。最小候选及源码依据见 Settings.md 第 9 节：从 setup/self-check 的 subjectSchema、运行时校验、内部 CLI 参数、示例及相关声明投影移除该字段；配置发现仍使用目标机用户目录与 `workingDirectory`，不把 scratch 改成被诊断对象。外层 `objective/v1.json`、`objectives/v1.json` 的身份不因 package 自有 subject 字段变化而升级；`inputSchema` 与投影按实际目标声明逐项处理。

以下仅两项仍需主代理询问用户，其他保留现状的技术适配不再包装成问题：

| ID | 用户决定 | 最小推荐 |
| --- | --- | --- |
| B5a | 去掉指定路径后，setup/self-check 的 configuration 阶段是否仍要求至少存在一份实际主配置文件？ | 推荐要求自动发现的用户/最近项目位置至少一份存在，两处都无文件仍报 `configuration-missing`；存在但无效报 invalid。这样保留“配置已落地”的检查目的，不因静态默认或独立 Agent 文件存在就宣称完成。另一选择是允许零主配置文件，只要求有效默认/值及 Agent 就绪；这是取消旧存在性门槛的行为变化。 |
| B5b | 是否批准新 snapshot 明确拒绝旧 configPath 输入，并在后续部署备份后只手工修改相关本机 Objective 声明及其输入，使它们与新契约配套？ | 推荐新契约不兼容旧字段、不静默忽略；只移除目标声明 subject 输出的 configPath、仅为它服务的 inputSchema properties/required/依赖和输入值（如存在），保留其余约束、名称、URI、权限、预算与目录语义。不重建 objectives.yaml、不运行资源 migrate、不改旧 pinned snapshot 或存档。先静态验证投影，再切换新已验收 source revision/入口；只改实际涉及的文件，发现额外身份/权限变动则停止。 |

B1/B2 已获用户确认，B3/B4 已由主代理按保留现状审查选定；B5a/B5b 未决定前，准备仍未收敛，不提交门限或开始生产代码。本轮未读取本机 objectives.yaml 或配置，部署中的定点改动也尚未获准执行。
