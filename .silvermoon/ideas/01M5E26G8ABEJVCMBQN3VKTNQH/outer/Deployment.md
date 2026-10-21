# Deployment

本文件仅为准备阶段种子，全部未完成；设备操作与全局安装由主代理在后续已验收实现上执行，本次不执行。

## Steps

### D-S01: 安装迭代后的本机全局构建

部署阶段确认准确的已验收实现 revision，使用当前隔离 worktree 的本地 build 全局安装 pguide 及全部包装入口：config、agents、objectives、probe、scaffold、validate、regulate、continue、supervise。核验入口和静态描述实际解析到该构建，不读取或复制原工作目录的未提交文件，不发布 npm。

### D-S02: 手工迁移本机用户级配置

先在设备本地备份并重新核对实际用户配置及来源，再按已确认的字段映射手工迁移；只操作明确的用户级配置，不默认迁移项目配置或重建已独立的 agents.yaml、objectives.yaml。逐字段核对默认 Agent、gpt-5-mini、工具权限、三个超时及 probe 90000 毫秒等原有效值；模型/权限所在独立资源不搬进主配置。移出旧发现文件前确认备份，不扩大授权。备份和秘密值不得进入仓库或证据文档。

备份并定点手工移除实际 setup/self-check 声明投影中的 configPath，连同确实依赖它的 inputSchema properties/required/输入值或直接 subject 文件；保留其余内容、权限与通用 schema 身份，不重建 objectives.yaml、不运行资源 migrate。按 Settings.md 第 9 节核对自动发现能保留原有效值，再配套使用新已验收 source 验证；不修改旧 pinned snapshot 或存档。

### D-S03: 验证全局入口与迁移结果

从根命令和直接全局包装入口运行配置校验、描述发现、诊断及必要的非破坏性消费验证，对迁移前后有效值与来源逐字段比较；未知描述项明确标未验证，不把它们称为校验通过。确认独立 Agent、Objective 资源仍可使用，记录脱敏证据及本地安装/配置可恢复条件。

定点输入迁移使用新已验收 source 静态验证相关声明的 inputSchema、投影及新 subjectSchema 匹配，核验 workingDirectory 的实际发现来源与新 snapshot；不把删除字段自动当作授权运行额外付费 sanity。

## Acceptance criteria

### D-AC01: 全局命令使用目标本地构建

通过全部全局入口解析位置、描述来源与构建 revision 核对证明使用已验收的目标构建，不依赖原工作目录的并发修改，也没有 npm 发布。

### D-AC02: 本机配置手工迁移保持有效行为

以本机校验、逐字段比较和独立资源检查证明用户级 JSONC 生效、旧文件已移出发现位置，默认 Agent、gpt-5-mini、工具权限、三个超时及 probe 90000 毫秒保留；不能用新默认覆盖旧显式值。未批准的配置变化明确失败或停止。

以相关目标条目的最小脱敏差异及新已验收 source 的静态绑定验证证明只移除了退役输入及其专属约束，未扩大作用域、权限或改写其他 Objective；setup/self-check 的文件存在性判定与实际来源一致，用户/最近项目至少一份实际 config.jsonc，不能以默认值或独立 Agent 文件替代。

### D-AC03: 部署证据脱敏且可恢复

以非破坏性全局命令验证、来源检查与本地备份存在性证明部署结果和恢复条件，不提交设备秘密或配置原文。
