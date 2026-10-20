# 独立 Agent 定义与管理入口

## 问题

Agent 连接资源与普通 CLI 偏好混在主配置中，导致定义校验、管理命令和执行依赖耦合。依据[总构想 C-01、C-03](../../../../01M5CR0X2B4R2C6K3183Y1T3SQ/outer/inner/ideal/Schemas.md)拆出独立实施候选。

## 结果

Agent 定义迁入独立 agents.yaml，提供 pguide agents 管理入口，治理、监督及诊断统一按名称取得有效定义；主配置仅保留默认名称等普通选项。

## 边界

- 初期只做用户级与项目级：文件在对应原主配置目录的 agents.yaml，项目级同名完整 profile 覆盖用户级，不深合并；保持默认名称引用及 ACP/AHP 校验、凭据引用、脱敏和现有授权边界。
- 旧内嵌 agents 明确拒绝并提供显式迁移，不覆盖未知文件，不通过深合并拼接不同协议的 profile。
- 文件顶层采用 `$schema` 与 agents 名称映射，URI 为 `https://shazhou-ww.github.io/potential-guide/schemas/agents/v1.json`。管理入口包含 list/show/set/remove/edit/validate/path/migrate，复用既有校验、原子写入和脱敏。本项不顺带把主配置改为 JSONC，不冻结扩展配置描述协议。

## 验收标准

- 独立 Agent 文件具备明确公共契约、离线校验和一致管理入口，主配置不再承载完整 Agent 定义。
- 用户/项目作用域、同名选择、默认名称引用和来源展示行为明确，所有执行消费者使用同一有效定义。
- 迁移保留定义与凭据引用，旧格式明确失败，非法或冲突配置不损坏现有文件、不扩大权限。
