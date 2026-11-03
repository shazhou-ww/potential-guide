# Axis 影响范围

本构想只跟踪 Task Engine 新架构的 Task Bundle 寻址与交付。
本轮修改目标架构文档，不声称现有协议、SDK、缓存、存储或消费端已完成实现。

## 直接修订

以下链接相对于本文件指向仓库的当前架构契约。

| 文档 | 受影响的契约 |
| --- | --- |
| [Task Bundle](../../../../../../docs/axis/task-engine-contracts/task-bundle.md) | 根 CID 与标准 IPFS URI、UnixFS 目录交付、取消 URL/Digest 与 tgz、单文件读取、构建导入、完整验证、本地物化、容量与内容保护。 |
| [职责边界](../../../../../../docs/axis/task-engine-responsibilities.md) | 通用装载职责与 CID 术语；节点/网关属于宿主配置，文件读取不新增 Task/Run 控制接口。 |
| [Request 受理](../../../../../../docs/axis/task-engine-contracts/request-admission.md) | Request 使用 IPFS 根引用，共享 preparation 按 CID；原始意图幂等与逐请求 Input 校验保持不变。 |
| [持久化恢复](../../../../../../docs/axis/task-engine-contracts/persistence-recovery.md) | 保存原 CID、恢复时获取同一内容；历史引用不承诺永久 pin，不能自动转换旧域事实。 |
| [Run 匹配](../../../../../../docs/axis/task-engine-contracts/run-matching.md) | 根 CID 是类型内容身份，不同 CID 不共享；节点或网关位置不参与匹配。 |
| [观察契约](../../../../../../docs/axis/task-engine-contracts/observation.md) | Run 类型身份可追溯至 CID，类型筛选沿用相同身份语义，不扩展为 IPFS 资产事件。 |
| [历史草稿](../../../../../../docs/axis/task-engine.draft.md) | 仅补充新契约优先的引用说明，不改写原历史整理。 |

## 不变与排除

- `task.yaml` 字段与 `$schema` 协议选择、共享 Schema 离线闭包、`worker.cjs` 自包含、
  本地只读执行与 Bundle 文件集合规则不变。
- Task 生命周期、取消与 Run 终止、数据域独占、事件 Revision、分页和订阅契约不变；
  IPFS 获取仍属于受理前 preparation，不是 Run 内业务准备或 Task 超时预算。
- 不改既有 Checker/Objective/Probe 业务制品的 Git 摘要、URL、归档或业务输入，
  也不将业务字段中的浮动引用自动改成 IPFS。
- 不建设通用 IPFS 资产目录或生命周期产品，不引入来源授权、保密承诺、IPNS 最新版解析
  或按需远程加载业务代码，不提供新旧引用双轨兼容。

## 实施边界

后续实施须将新架构的协议、SDK 构建发布、宿主装载缓存、持久身份和消费端统一接到标准 IPFS 实现。
UnixFS 导入参数须固定并可复现；单文件读取须验证根到文件的 DAG，而完整准入仍验证全部文件。
CID 不是现有 Git 文件树摘要的改名；旧库与旧制品不因本构想自动迁移。
发布与宿主环境分别承担内容保留及活动工作保护，历史 CID 留存不等于永久可获取。
