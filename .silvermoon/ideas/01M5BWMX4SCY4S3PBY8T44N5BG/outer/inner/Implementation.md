# Implementation

本次实现遵循已接受的 ideal；设计依据见 [依赖设计](./ideal/Dependency-design.md) 与 [修改清单](./ideal/Change-map.md)，实现与验证证据见 [Evidence](./Evidence.md)。

本子会话是唯一实施方，在隔离 worktree 编写代码、测试、文档并提交实施证据。用户委托父会话 `ahp-session:/b0e812dd-21f1-4a27-90f2-937b307ef1ea` 独立 review 并决定全部后续 gate 的 accept/reject；实施方只记录准确已同步 revision 的 submitInner，不自批 acceptInner/acceptOuter，也不自行进入尚未接受的下一阶段。该分工不改变已接受 ideal。

## Steps

### I-S01: 替换问题与观察协议

移除静态 prerequisite；在现有 objective-pilot 包导出层级判断和依赖 probe，贯通问题、观察、校验和摘要；不新增包或 check 子命令，测试 fixture 使用新协议，不迁移两工程现有 Objective 定义。

跨进程复用 process probe 的 Node IPC 通道：脚本通过 source-bound probe 请求拥有 Git 快照的组合层，组合层执行同一层级判断与 probe API，将同次来源版本证据贡献到当前观察作用域。stdin 仍只有 subject，stdout 仍是 CheckResult Envelope；不使用 report、布尔中转或嵌套 CLI。非 Node 执行器保留原三管道协议。递归栈、截止时间和总预算保留在拥有观察的进程，并将取消传到动态来源准备及外部探针，等待实际清理。

### I-S02: 贯通治理交接与依赖调度

实现依赖交接结果、多依赖等待、逐消费者阈值恢复及动态目标运行时绑定，保留权限与取消边界。

Planner 通过内部注入的精确版本 resolver 与释放回调绑定来源；CLI 复用现有 Git checkout/runtime 生命周期。实例以 Objective ID 与 canonical subject 合并，保存各消费者最低层级；满足全部当前要求后重新观察消费者。实际等待图检测环，根替换与删除回收孤立实例，保留共享及显式注册目标；原 revision 反馈不创建依赖。

最新可信消费者 observation 撤销已消失或改变的要求，更新 demand revision 后重新治理/交接，不能因旧等待压住仍有内部工作的新观察；B 改为 C 与共享所有权均有独立回归。快照脚本的 bare import 由现有 Node process adapter 的单一库映射 preload 绑定，不假设临时 checkout 含 node_modules。

### I-S03: 完成协议替换与回归验证

更新直接相关文档、测试和示例，验证已删除的 prerequisite 字段及旧问题输出明确拒绝、未变化的非依赖行为不变；不升级无关 Manifest 版本或执行真实定义迁移。

## Acceptance criteria

### I-AC01: 问题协议可验证

通过库函数与 Pilot 定向测试证明 true/false 判断及 probe 转换正确、观察归属固定、两种问题结构严格、未知外部状态不伪装为业务阻塞。

证据覆盖非字典序、相等/高于/低于/terminal、单次观察、成功和失败依赖的版本贡献、中间层级与同层聚合，以及旧字段/旧输出拒绝、冲突版本和取消。

### I-AC02: 依赖闭环可恢复

通过 Regulator、Planner、Coordinator 与既有 CLI 集成测试证明零 Agent 交接、共享阈值恢复、循环诊断和过期结果隔离；跨进程证据回传必须有实际验证，不以进程内示例替代。

实际 Node 子进程测试证明递归/深度/总预算和取消清理；临时双 Git 仓库测试证明来源固定、版本贡献和清理；supervise CLI 端到端测试证明动态外部运行时加载、零 Agent 交接、提供者修复及消费者重新观察。另验证多依赖、各消费者阈值、根配方替换、共享保留、实际等待环和迟到隔离。

### I-AC03: 核心协议与消费方验证完整

以修改清单的覆盖检查和定向测试证明消费方与非依赖回归正确，并执行 `pnpm check`；若既有 Objective 定义尚未手动迁移导致检查阻塞，明确记录原因，不伪造通过或引入兼容层。

不修改真实 Objective 的定义、检查实现或派生产物；setup 的 nonce sanity-fixture 是允许更新的测试 Objective，只更新其内部问题判别字段。真实 monorepo 与 setup 的旧失败输出仍按新协议拒绝；Evidence 逐项列出由此造成的三项集成阻塞，与本次核心/CLI 回归结果分开。未执行 npm 发布，也不把本阶段测试当作现实世界部署验收。
