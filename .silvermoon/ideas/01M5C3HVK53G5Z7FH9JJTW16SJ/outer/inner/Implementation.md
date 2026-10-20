# Implementation

实现依据为已验收的 [上下文目标设计](./ideal/Context-objectives.md) 与 [身份影响矩阵](./ideal/Identity-impact.md)。逐项证据、可重放验证和迁移边界见 [Verification.md](./Verification.md)。

## Steps

### I-S01: 定义声明与上下文绑定

实现严格声明校验、显式 inputSchema 与 Unit 输入、直接 JSONata subject 投影及技术栈无关的上下文。Pilot 来源以目录为单位，区分可取回的 commit 与目录 tree 内容版本，并明确资源边界及外部版本证据。

目录 ID 替换是跨包协议改造，必须逐项处理 [身份影响矩阵](./ideal/Identity-impact.md)，包括资源解析、公共 API、观察与依赖证据、来源缓存、持久化和仓库自有消费方，不仅更新声明加载器。

规范化 ID 使用末尾 `/`，仓库根目录为 `#/`；资源 URI 保留实际文件路径。Git 来源将 `version` 定义为目录 tree，`source` 独立记录 `kind: git-tree`、repository、directory、commit、tree 和 repositoryTree。后者为同时 materialize 的目录外仓库支持内容提供独立、保守的版本证据，不声称覆盖环境、网络或动态安装；链接和子模块明确拒绝。

父审查后的修订采用保守 Unit 充分条件并验证 `{}`，不得把可由 patternProperties 扩展的对象误判为 Unit。context 根相对路径为 `"."`；Git 缺失/超时/访问/解析故障与非法 origin 都明确报 context-error，只有可识别的非仓库与缺少 origin 配置才能使用各自明确边界，不对不支持的 SCP-like 来源伪造 file 身份。

### I-S02: 接入 CLI 发现与运行入口

为用户级和目录级目标列举、管理、选择、probe 和 regulate 复用统一绑定逻辑；从运行配置分离用户级声明，明确旧来源别名的迁移与命令退役方案，保留直接 Pilot 调用语义，恢复使用原绑定而非重新发现。

使用可发现的 `pguide-objectives` 扩展承载 list/show/set/remove/migrate。查询默认展示用户级和当前目录级声明；写操作要求明确作用域与完整声明，原子校验保存。旧 config.objectives 保持来源别名语义，add/update 命令退役；显式迁移先保存声明再删除所选旧别名，其他注册不丢失。直接 `--pilot` 不改成声明选择，Git manifest ID 明确拒绝；只有本地名称恰为 pilot.yaml 的入口可在 CLI 边界转换。

恢复记录升级到 schemaVersion 3，保存声明来源摘要、上下文、输入、subject、root 与所有已绑定依赖的 commit/tree 表；continue 不重新发现名称，也不把远程 HEAD 替换为原依赖。旧记录与缺失/伪造来源证据明确拒绝。

### I-S03: 贯通身份迁移与依赖更新

结合依赖问题协议接入 Behavior 来源更新和绑定替换，完成新旧 ID、版本证据与恢复记录的迁移或明确拒绝。逐项覆盖影响矩阵，更新仓库自有 Pilot 消费方、脚本、测试、示例和相关公共文档，不修改其他 Idea 的历史契约。

单个 withPilot 生命周期缓存已解析定义与固定快照；跨进程 RegulationInput、派生 goal 与 worker 保留完整来源绑定表。Supervisor 刷新边界重新绑定根及已发现依赖，失效旧观察/等待需求并递增 revision；迟到反馈按 revision 隔离，来源失败显式中止监督而不声称已更新。消费者阈值、Agent 权限与声明仍相互独立。

连续 CLI 来源更新回归同时覆盖无关提交、根检查脚本修改与仅依赖仓库修改，保持 portfolio 不变。runtime 按 Pilot 与完整依赖 bindingRevision 隔离并保留至边界替换完成，不提前用新 runtime 服务旧 goal；刷新后的 worker 同样携带已解析依赖的精确 commit/tree 表。

## Acceptance criteria

### I-AC01: 声明和实例绑定可验证

定向测试覆盖根目录、无包清单目录、多 checkout、输入类型与作用域正交、Unit 唯一值、直接 JSONata 及两层 schema 校验；证明无技术栈假设或跨实例错误合并。验证脚本或资源变化改变目录版本，而无关提交不改变它，外部依赖有独立证据。

### I-AC02: CLI 行为一致且可恢复

集成测试证明清单拒绝 target、发现不执行检查或 Agent、用户级和目录级查询保留来源且同名不静默覆盖、旧注册迁移无数据丢失、声明入口与直接入口绑定一致、治理层级来自调用请求或消费者、输入和版本冲突显式报错、继续运行保持原始绑定。

### I-AC03: 依赖闭环与既有行为通过验证

以身份影响矩阵逐项对应改动与测试，证明目录 ID 在入口、观察、依赖图、缓存和恢复中一致，tree 版本不被当作 commit；验证多目标交接、单次快照一致性和来源更新后的重新绑定/观察，旧反馈不能放行新需求。旧输入和记录有明确、可测试的迁移或拒绝行为；执行 pnpm check，不以双身份兼容链或遗漏仓库自有消费方规避失败。
