# Package 主配置规范

本文服务于 [Idea.md](./Idea.md)，与 [Settings.md](./Settings.md) 的字段映射、消费边界和源码依据共同定义本项准备范围。B1/B2 的写入与注册政策、B5a/B5b 的存在性门槛与定点输入迁移已由用户确认；B3/B4 由主代理按保留现状审查选定。技术名称和约束按这些决定固定，当前无未决行为问题；本规范不代替准确构想门限或实施、部署执行授权。

## 存储、作用域与默认值

- JSONC 是唯一新主配置。用户级使用系统用户配置目录的 `config.jsonc`（Windows 为 `%APPDATA%\pguide\config.jsonc`）；项目级从命令有效工作目录向上只选最近的 `.pguide\config.jsonc`，不叠加祖先项目配置。
- 顶层只放完整 setting ID，不携带旧 `schemaVersion: 2`；点号是名称的一部分，不是对象路径。用户级后叠加项目级，按 key 浅合并；同 key 的对象、数组整体替换，不深合并或拼接。
- 显式对象不补字段默认：必填缺失报错，可选缺失含义由描述明确。仅整个 setting 在两级均缺失时，才采用所属 package 静态描述中已通过约束校验的整个默认值。可选且无默认的 setting 保持缺失；必需项在相关命令消费时缺失则报错。
- 默认值不写回，来源可见；消费者不得另藏 setting 默认值。stateDirectory/reportDirectory 缺失仍不注入 setting，由描述说明按平台/状态根定位资源的缺失语义；展示时区分计算的资源路径与静态默认来源，不伪造固定 JSON 默认路径。

## Package 所有权与静态描述

- namespace 按 package 功能后缀约定并显式声明，核心不从包名猜。名称使用 `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`；完整 ID 以所属 namespace 加 `.` 开头。同 package 多命令可共用，不同 package 冲突失败。第三方新增设置不修改核心全局类型。
- 完整 setting ID、owner/consumers、默认值和字段约束以 Settings.md 第 2、3 节为统一清单。描述文件名为 `settings.json`，由 `package.json` 的 `pguide.settings` 指向实际随包交付的包内相对路径；静态 JSON 以 `schemaVersion: 1`、`namespace`、`settings` 表达，package 身份以元数据 `name` 核对。描述版本、命令输出 envelope 版本均不是主配置 setting。
- 内置描述随构建接入；第三方由外部工具安装后，按明确安装根目录显式接入一次。用户配置目录中的独立 `settings-packages.json` 保存 package 身份与安装根目录；它不属于两级设置值配置，不逐项目注册。
- 接入只读本地元数据指向的包内静态 JSON，验证身份、namespace、描述及默认值。同位置、同身份、同 namespace 的升级重校验后使用，无需逐版本确认；身份/namespace 改变须重新显式接入。相同根目录重复发现去重，冲突的同 package 描述失败。
- 注册记录损坏，或已注册 package/描述缺失、损坏时明确失败；不能降格为未知 namespace，也不能按无关语义错误跳过描述装配失败。不扫描网络、npm 缓存或全盘寻找替代 package。
- 不新增安装器，不执行扩展获取描述，不因 PATH 命令发现自动信任描述，不拉取远程 schema；描述接入不授予执行权限，不增加签名服务或 hash 审批链。既有命令协议探测与显式编辑器调用保持原职责。

## 校验与编辑

- 未加载 namespace 描述的设置保留并标未验证。已知 namespace 中未知 key 或非法值是错误，保留原文而不静默忽略。
- 全量 `config validate` 报全部问题；已知描述的语义错误导致失败，未知描述本身不导致失败，但不能把未验证项称为已验证。
- 命令检查其相关 namespace，包括共享消费。在相关 namespace 内先校验每个选中层的显式值，再校验有效值，不能以覆盖隐藏非法值；无关 namespace 语义错误不阻断命令。JSONC 语法、重复 key、namespace 冲突等结构错误不可通过“无关”绕过。
- `config edit/set/unset` 允许保留及写入未知 namespace 值，并明确警告“未验证”；已知 namespace 非法值/未知 key 及结构错误仍拒绝写入，原文件不变，不新增 force 绕过。
- JSONC 编辑保留原始文本以及未编辑 key 的注释、顺序，以局部修改代替整文件 YAML stringify。`get/set/unset` 操作完整 ID，不作点路径访问；`set` 的值使用 JSONC 值语法。

## 共享设置与既有入口

依据用户的代理门限审批授权，主代理对 B3/B4 选择保持既有行为，不作为新增功能授权：

- `agents.defaultAgent` 归 `@potential-guide/pguide-agents`，由 regulate 和 setup/self-check 共用；只引用名称，不嵌入连接、模型、授权或秘密。不让 supervise 的 `--planner` 或 diagnose 自动采用它。
- `pilot.probe` 归 `@potential-guide/pguide-pilot`；regulate 消费 timeout+retry，probe 及 supervise 的 goal/dependency observation 只消费原 timeout。不新增重试，不把该策略扩展到原本未传入的 supervise worker。
- `regulate.quota` 保持一个共享对象，不拆分，supervise 继续消费。三个必填字段及默认值见 Settings.md；permissions 仍整体替换，continue 继续重读当前权限，不恢复存档授权。
- 超时使用三个独立 setting：`regulate.agentTimeoutMs`、`supervise.agentTimeoutMs`、`pguide.diagnoseAhpTimeoutMs`。旧 `agentExecutionLimits.timeoutMs` 有有效显式值则分别复制；没有则保持 `1800000`、`30000`、`30000` 毫秒。ACP 诊断和独立 probe 预算不变，存档及 refresh 边界按 Settings.md 保留。
- 保留 `PGUIDE_FORMAT/LANGUAGE/STATE_DIRECTORY` 的原运行时覆盖及 environment 来源，不称为第三文件作用域；其余 CLI、凭据入口和不读取主配置的资源救援通道保持。`format/defaultLanguage/color/logLevel` 不因重构而激活原本未生效的消费。
- `config --scope project` 仍写有效 cwd 下的新配置位置，显示实际目标，不改为编辑最近祖先文件。独立资源 scope、路径、授权和救援边界不随主配置换名改变。

## 旧格式与 setup/self-check 输入迁移

- 移除所有主配置 `--config` 入口及依赖它的 `config --scope explicit`；明确报错并说明两级替代方式。应读取位置出现旧 YAML 时拒绝并要求手工迁移，新旧并存失败，不跳过最近旧文件去选更远新文件，不普通读取时改写。只提供手工迁移说明，不新增主配置迁移命令；迁后旧文件移出发现位置。
- setup/self-check 新 subject 契约彻底移除并拒绝 `configPath`，不保留路径断言或可选兼容字段。同步移除 subjectSchema、helper、内部 CLI 参数和相关投影中的依赖；发现上下文仍是目标机用户目录与 `workingDirectory`，scratch 不成为被诊断对象。
- configuration 阶段要求自动发现的用户/最近项目位置至少存在一份实际 `config.jsonc`；两处都无文件报 `configuration-missing`，存在但无效报 `configuration-invalid`。默认值、预期路径字符串或独立 Agent 文件不能替代主配置文件存在证据。此门槛属于 setup/self-check，不新增到普通主配置加载器。
- 外层 `objective/v1.json`、`objectives/v1.json` 身份不升级；inputSchema 校验原始输入，subjectSchema 校验投影结果，按实际声明处理，保留其余 required/类型/范围约束。
- 部署备份后，仅定点手工移除相关 setup/self-check 声明投影的 configPath，以及确实依赖该字段的 inputSchema/输入；保留其他值、权限、名称、URI、预算及目录语义。不重建 objectives.yaml，不运行资源迁移，不改旧 pinned snapshot 或存档。使用新已验收 source 做静态投影/绑定及后续验证；完整步骤见 Settings.md 第 9 节。
- setup fixture 在自有 `.pguide\config.jsonc` 中显式保持原 bounded 设置及有效权限，不继承扩大授权；self-check 保留一次 direct sanity、不嵌套 regulate、不新增授权门或重试。独立 `agents/objectives migrate --legacy-config` 仍使用专用旧 YAML 读取，不恢复主配置运行覆盖层，也不自动重迁资源。

## 部署边界

由主代理在后续已验收 worktree build 上全局安装 pguide 及全部包装入口，备份后手工迁移实际本机配置和上述指定输入。逐字段核验默认 Agent、`gpt-5-mini`、工具权限、三个超时、probe `90000` 毫秒及独立资源；模型/权限所在资源不搬入主配置。准备阶段不读取设备秘密、不更换全局入口、不改设备配置，不发布 npm。实际状态若超出已确认范围，停止并交主代理处理，不扩大授权。
