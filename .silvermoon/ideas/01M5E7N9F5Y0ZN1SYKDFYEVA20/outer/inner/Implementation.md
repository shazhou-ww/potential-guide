# Regulation Coordinator 双意图与可恢复状态实施

实施依据是已接受的 [简化设计](./ideal/Design.md)，idealRevision 为 `3b28786c179ac731856a6bb12dd9426d3c6d8982`。旧参考目录与 [Verification.md](./Verification.md) 不构成本次实现证据。

## 实现入口与范围

- [RequestModel](../../../../../packages/regulation-coordinator/src/requests.ts)：不可变 Objective、Revision、Target、Request，单命令纯归约、准确引用解析与快照验证。
- [CoordinatorModel](../../../../../packages/regulation-coordinator/src/state.ts)：Host 内连续事件前缀、不可变启动与资源事实、生命周期、观察、故障、依赖和本地需求关闭；第二个纯 reducer 及重放校验。
- [双 Behavior 运行时](../../../../../packages/regulation-coordinator/src/coordinator.ts)：资源第一参数，完整请求状态第二参数，输出可订阅状态与当前快照；单串行调度器，副作用在归约器外执行。
- [观察投影](../../../../../packages/regulation-coordinator/src/views.ts)：Host、Objective、Target、Request、Run 五层数据，保留跨 Host 来源，不增加独立可写缓存。
- [本地存储](../../../../../packages/regulation-coordinator/src/store.ts)：profile 级 OS 文件锁、原子快照替换、损坏及已初始化快照缺失的明确拒绝。
- [包文档与接入约束](../../../../../packages/regulation-coordinator/README.md)：公开 API、runner 与恢复适配协议、输入和清理语义。

新 API 采用显式 `coordinator` 入口，旧 `regulationCoordinator` 五命令入口、Supervisor/Planner/Portfolio 接线不变。这里交付观察数据而不是前端页面；没有实现中央传输、跨 Host 请求协调、发布权威或迁移旧服务，也没有发布 npm。

## 本轮确定的实施选择

### 身份与事实

- requestRef 由调用方提供，不用执行 Host 加局部序号冒充共享身份；同引用同规范化内容是重投，同引用异内容显式拒绝，同值新引用保留新请求。依赖派生也有自己的 Request；共享 provider 可以直接引用已存在请求。
- 当前接入格式复用精确 PilotSpec。Objective key 来自 repository/directory，Target 加 subject，Revision 加完整 commit；使用带类型前缀的 SHA-256 与不依赖 locale 的 JSON 属性顺序。新 source 字符串语法及别名合并不在本轮实施。
- 请求投影 revision、Host 事件 revision 与请求身份分开。完整 schemaVersion 1 前缀可以 JSON 往返并重建验证；不支持静默压缩或版本迁移，不从裁剪后的历史猜测水位。
- HostBindingRevision 身份由 Host 与固定 binding 值确定；capacity 更新复用原 binding 版本，配置变化产生新版本。完整资源版本的成员与容量保存在追加事实中；Run 固定引用 hostBindingRevisionId 和启动资源版本，后续配置不改写它。

### 本地执行与恢复

- 同一 Target 在本 Host 同时至多一个未确认退出的 Run，跨 Host 的贡献分别保留。外部请求按 priority 与本地接收顺序调度；新外部请求替代同 Target 的旧本地需求，不宣称是全局请求顺序或全局满足决定。
- `initial` 不启动业务执行，并停止旧本地调用；其他替代请求先等待旧调用排空。资源缩容、停用或换配置不虚报旧调用已退出，不用期望并发覆盖实际占用。
- 每次 Run 的启动意图先持久化，再调用 runner。runner.start 同步抛错须保证未启动外部执行；返回 handle 后的失败由 result 报告。result settlement/成功 kill 须确认真实终止，abort 只是请求。
- 单次 timeout 从持久化的启动时间计算，恢复不重置；时钟回退保守视为不能延长额度。maxAttemptsPerRequest 限制本地重入次数，maxDependencyRequests 限制每个根需求可达的依赖请求总量，不引入共享总预算或 harness grants/ceiling。
- 终结、必要的本地关闭和依赖安装作为同一次存储提交；循环、超限或坏引用拒绝整批依赖，不留下部分 provider。provider 成功只允许 consumer 以新 Run 再观察，不能直接完成 consumer；共享 provider 在任一有效 consumer 仍需要时保留，失去需求后停止。
- 恢复使用原 Run 身份、固定请求、binding 及限制；runner.recover 返回 attached、已确认 ended 或 unknown。unknown 保留占用并阻止重复工作，不把历史 running 当作存活或退出证明。
- mandatory onError 是存储自身故障也能使用的出口。存储失败停止新调度；已知活跃 handle 在 scope 清理中仍请求终止。kill 无法确认时清理失败并保留 profile 锁，不伪报成功释放所有权。
- profile 冲突空间不按 hostId 分裂，OS SQLite exclusive 文件锁持有至安全清理完成；不是检查锁文件存在。首次持久化标记防止后续丢失快照时从空状态启动。适配器针对本地文件系统，不承诺网络文件系统锁、跨设备克隆身份防冲突或任意掉电场景的外部执行原子性。

### 观察数据与非目标

- 视图完整地从同一 Host 事件前缀重算；没有另一个可独立写入的物化视图。多个 Host 合并时保留来源，冲突的共享实体/请求明确拒绝。
- Target 的最近 Probe 按 Host 内事实顺序保留成功或失败；失败不显示旧成功为最新结果，也不允许旧成功直接证明本次达标。Run 保留变化时间线及固定 Request 关系。
- contact 与最新上线版本由中央联系/发布观测显式提供，不能从空闲业务事件或 Git OID 推断；缺失时保持未知。已知发布信息必须引用匹配的 ObjectiveRevision。
- 共享 Request 的全局 satisfaction 在没有协调协议时保持 undetermined；同时展示各 Host 的执行结果、本地关闭与依赖，不把本地完成冒充全局完成。
- 无浏览器页面、中央同步传输或真实 Agent provider 集成。runner 使用真实资源身份授权；测试 runner 与真实子进程证据的证明范围分别披露。

## Steps

### I-S01 — 收敛实体、观察需求与函数契约

以本文件记录的身份、资源版本、事件前缀与 runner 边界落实已接受设计；两个纯 reducer 及五层观察数据不沿用旧 SQL 或旧 Host 内请求身份。

### I-S02 — 实现执行、可重算状态与恢复

公开双 Behavior 入口串行组织请求、资源、runner 和持久化；验证有限依赖、真实终止与恢复，保留旧入口及服务接线。

### I-S03 — 验证行为与兼容性

运行源码与测试类型检查、Coordinator 全部测试、隔离打包消费和 pnpm check；区分新实现证明与既有基线限制。

## Acceptance criteria

### I-AC01 — 实体与函数契约一致

类型与测试证明固定版本、Request/Run/Host 归属、binding 版本、双输入和纯归约成立；同值新请求、重投冲突、坏引用及恢复篡改均有明确结果。

### I-AC02 — 执行、状态与恢复正确

同版本重建与观察投影一致；测试证明终结与依赖提交原子、未核实执行不释放占用、初始目标不启动业务、共享 provider 不被单侧撤销错误清理、恢复不重复启动或重置 timeout。

### I-AC03 — 交付与兼容可复查

源码与测试类型、Coordinator 测试、打包 ESM/声明消费有本次结果；旧入口回归测试仍通过，全仓既有失败单独披露，不将全仓检查写成已通过。

## 验证证据

- [请求模型测试](../../../../../packages/regulation-coordinator/test/requests.test.ts) 覆盖纯归约、身份稳定、固定 commit、同值新请求、重投、依赖来源、initial/terminal 和恢复篡改。
- [新运行时测试](../../../../../packages/regulation-coordinator/test/behavior.test.ts) 覆盖双输入调度、资源配置固定、容量与停止、超时、Probe 失败、循环与超限拒绝、共享依赖、损坏/缺失存储、OS 锁及恢复。
- 真实子进程测试重关联已有 child process，按原持久化 timeout 终止并等候进程退出；证明外部进程的终止边界，不证明某个真实 Agent 服务或跨 Host 网络协议。
- 每个事件前缀都可恢复并重算相同视图；容量变化复用 binding 版本，配置变化不重写旧 Run。
- `pnpm --filter @potential-guide/regulation-coordinator typecheck`、`pnpm exec tsc -p tsconfig.test.json --pretty false` 与变更文件 Biome 检查通过。
- `pnpm --filter @potential-guide/regulation-coordinator test`：64/64 通过（原调度器 34、请求模型 8、新运行时/投影/存储 22），没有未完成或跳过的测试。
- `pnpm pack:check` 已验证旧入口、新 Behavior 入口、模型命名空间的公开 ESM 和声明类型，隔离 consumer 实际获取并清理空 Coordinator scope。
- 最初 `pnpm check` 复现此前两条 setup 集成测试的 `installed`/`verified` 差异。整合并行 primary 更新 `e4474abbeb62825426e3dbbbe25ad02e69c924fa` 后，这两条定向测试已通过。
- 整合后的 `pnpm check` 在未修改的 check-host 用例 `real startup and published Host crashes recover once without replaying old tasks` 上发生 `Shared Check Host readiness timed out`；单独复跑同一用例仍在约 20 秒超时。因此不宣称全仓检查已通过，也未修改该独立包测试或放宽超时掩盖基线问题。
