# Implementation

本文件为准备阶段种子，全部未完成；B1/B2 已获用户确认，B3/B4 已由主代理按保留现状审查选定，须先收敛 [Configuration.md](./ideal/Configuration.md) 的 B5a/B5b 并完成门限审批才可实施。[Settings.md](./ideal/Settings.md) 是现状和迁移候选证据，不是已授权的生产实现。

## Steps

### I-S01: 落实设置存储与 package 描述

按最终准备结论实现 JSONC、两级作用域、完整 ID 浅合并、整项静态默认和来源展示；接入 package 元数据引用的静态描述及显式注册，不执行扩展获取描述、不新增安装器。核对内置构建与 tarball 的描述交付，复用现有配置入口，避免核心集中枚举扩展类型。

### I-S02: 接入配置消费者与显式迁移

按最终字段映射接入全部直接和间接消费者：根命令、配置工具、regulate/continue/supervise/probe、独立资源及 setup/self-check 的 config show 协议。保留 quota 共享、拆分三个超时、核对 probe/默认 Agent 的共享及存档/刷新/授权边界；更新读写、帮助、生成产物及手工迁移说明，不新增主配置自动迁移命令，不混回独立 Agent 或 Objective 资源。

统一拒绝各命令与包装入口的 --config 及依赖它的主配置 explicit scope；按用户选择彻底移除 setup/self-check subject.configPath，按 B5a/B5b 最终决定同步两个 subjectSchema、helper、投影/输入手工迁移说明及生成物，不保留路径断言。按 B4 保留其他入口和资源救援/迁移，保持 workingDirectory 发现上下文与隔离 fixture，不扩大权限。旧 YAML 及新旧并存明确失败，换文件名不切断独立资源发现。

### I-S03: 验证配置契约与行为保留

按 Settings.md 的证据链做定向测试，覆盖配置、跨组件消费者、间接运行协议、生成产物及 packed 入口，再运行 pnpm check；不在准备阶段执行或预填通过证据。

## Acceptance criteria

### I-AC01: 扩展配置不依赖核心枚举

以独立扩展及 tarball 消费测试证明新增 namespace 和设置无需修改核心全局类型；描述文件随包可定位，根命令和直接 wrapper 一致，归属冲突明确失败，普通配置操作不执行扩展获得描述。验证 B2 已确认的同位置/同身份/同 namespace 升级重校验，无逐版本确认；注册损坏/缺失失败而不降格成未知 namespace。

### I-AC02: 覆盖与错误行为符合契约

通过测试证明完整 ID 浅合并、整项默认及来源可见、不补显式对象字段；消费的非法值明确报错，无关 namespace 语义错误隔离，结构错误不可绕过。验证 B1 已确认的未知 namespace 写入伴随“未验证”警告、已知及结构错误拒绝写入且原文件不变，并覆盖 JSONC 注释编辑与 B4 保留通道。

### I-AC03: 旧配置迁移与消费者行为可验证

以手工迁移样例和消费测试验证三个超时默认/显式复制、supervise 共享 quota、probe 不被缩短、continue 权限重读及存档预算、独立资源发现。按最终 B5a/B5b 验证无 configPath 输入的完整 parse/project/bind/helper 链、旧输入诊断、缺配置判定、目标与 scratch 上下文分离且 fixture 不扩大权限；旧格式/并存/移除入口有明确诊断。定向检查、生成产物检查和 pnpm check 通过，不能以重跑通过掩盖未解释的失败。
