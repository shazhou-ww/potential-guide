# Axis 变更对照：Before / After

本构想只跟踪 Task Engine 新架构的 Task Bundle 寻址与交付。
本轮修改目标架构文档，不声称现有协议、SDK、缓存、存储或消费端已完成实现。

Before 指本 IDEA 修订前的 axis 契约，After 指本 IDEA 提出的新架构目标，
不是已经上线的新协议。以下重点展示行为差异，而非运行时代码修改清单。

## Request 会变成什么样

唯一需要改变的引用字段是 `bundle`：从 `{url, digest}` 对象变成标准 IPFS URI 字符串。
不新增 `cid`、`digest`、`gateway` 或 IPFS 节点地址字段，也不改变业务输入的组织方式。

### Before

```json
{
  "requestId": "<ULID>",
  "bundle": {
    "url": "https://example.com/task.tar.gz",
    "digest": "sha256:<64 位小写十六进制摘要>"
  },
  "value": 7,
  "timeoutMs": 10000,
  "matchPolicy": "starts-after-eligible"
}
```

### After

```json
{
  "requestId": "<ULID>",
  "bundle": "ipfs://<root-CID>",
  "value": 7,
  "timeoutMs": 10000,
  "matchPolicy": "starts-after-eligible"
}
```

以上为形状示例，`<ULID>`、摘要与 `<root-CID>` 均为占位，不是可直接提交的有效值。
`value` 是示例 Bundle 的业务输入字段，不是新增的 Engine 通用字段；
业务字段仍由该 Bundle 的 Input Schema 定义，本次不将其改成额外的 `input` 包装。
`requestId`、`timeoutMs`、`matchPolicy` 以及可选 `eligibleAt`、`seriesId` 的语义不因 IPFS 改变，
示例省略的可选字段也不被自动补写。
两段示例只比较协议形状，不表示同一 `requestId` 可以先提交旧引用再改成新引用；
幂等仍核对完整原始意图，旧记录不自动迁移。

`bundle` 必须引用整个 UnixFS 目录根。读取某个文件则另用标准路径：

```text
Bundle 根引用：ipfs://<root-CID>
单文件引用：  ipfs://<root-CID>/resources/config.json
```

单文件路径不是提交 Task 时的 `bundle` 值，不新增 Task 文件读取控制操作。
即使业务输入本身包含文件引用，也由该类型的 Input Schema 决定，不由 Engine 自动添加。

## 寻址与交付对照

本节依据[Task Bundle 契约](../../../../../../docs/axis/task-engine-contracts/task-bundle.md)。

| 变化点 | Before | After |
| --- | --- | --- |
| Request 的 Bundle 引用 | 必须同时提供 `{url, digest}`。 | 只提供 `ipfs://<root-CID>`，CID 同时承担内容身份与获取入口。 |
| 展示与填写形式 | 自定义 `URL#digest`；还需解析回结构化对象。 | 直接使用标准 IPFS URI，不再维护这套拼合协议。 |
| 获取位置 | 发布 URL 属于引用，调用方必须知道某个位置。 | 引用不绑定位置，节点、网关和连接方式由宿主配置。 |
| 内容身份 | 自定义 Git SHA-256 文件树 Digest。 | 标准 UnixFS 目录根 CID，不再维护平行摘要；固定导入参数以保证可复现。 |
| 交付对象 | 文件树打包成 tar.gz，压缩包作为下载对象。 | 文件树直接导入为 UnixFS 目录，传输其 DAG 与文件块，不再要求 tgz。 |
| 构建与发布结果 | 构建目录与 Digest，再打包并取得 URL，组成完整引用。 | 构建目录，再导入取得 CID 与 IPFS 引用；CID 生成与发布保留结果明确区分。 |
| 包内单文件读取 | 此交付链路须下载并解包，才能按路径读取内部文件。 | 可按根 CID 加路径直接读取并验证所需 DAG 与文件块，无需先取全包。 |
| 完整性验证 | 解包后重算 Git 文件树摘要，与期望 Digest 比对。 | 使用标准 IPFS 实现验证 CID、DAG 链接和块；普通 HTTP 字节响应不能替代验证。 |
| Bundle 合法性 | 内容摘要通过后，还须检查声明、入口、Schema 与文件集合。 | 相同检查保留；CID 验证通过不代表 Bundle 合法。 |
| 共享 Schema | 全部定义收录在 Bundle 内，并纳入完整 Digest；装载不联网补契约。 | 全部定义仍收录在同一目录并受根 CID 约束，离线闭包规则不变。 |
| 完整装载与执行 | 获取完整归档并解包，验证后启动本地只读 `worker.cjs`。 | 获取并验证完整文件树，再物化到本地只读目录启动同一入口；不改成远程代码执行。 |
| 宿主容量 | 限制下载、解压后总字节数、单文件大小和文件数量。 | 限制传输、文件树总字节数、单文件大小、文件数量及 DAG 遍历预算；超限仍明确失败。 |
| 内容缓存 | 按自定义 Digest 存储完整内容，不同 URL 可复用。 | 复用 IPFS 块缓存，完整装载与物化按根 CID 复用，不另建 URL/Digest 寻址体系。 |
| 展示名称 | 名称不是身份；修改名称会改变 Digest。 | 名称仍不是身份；修改名称会改变根 CID，CID 缩写仍不能用于真实操作。 |

交付链路可以概括为：

```text
Before：成品文件树 → Git tree Digest → tgz + 发布 URL → 下载 / 解包 → Digest 验证 → 本地执行
After： 成品文件树 → UnixFS 导入 / 根 CID → IPFS 获取 / DAG 验证 → 本地物化 → 本地执行
```

## 受理、匹配、恢复与观察对照

| 文档 / 变化点 | Before | After |
| --- | --- | --- |
| [职责边界](../../../../../../docs/axis/task-engine-responsibilities.md)：类型装载 | Engine 通用获取、校验、缓存和装载，不要求预注册类型。 | 获取改为 IPFS、装载前本地物化并保护活动内容；不要求预注册，不扩展为任意 IPFS 资产管理。 |
| [Request 受理](../../../../../../docs/axis/task-engine-contracts/request-admission.md)：准入 | 校验 URL/Digest，获取验证 Bundle，再按其 Schema 校验每个 Request。 | 校验 IPFS 根引用与 CID，获取验证完整 Bundle；逐请求校验及 preparing/accepted/rejected 结果不变。 |
| [Request 受理](../../../../../../docs/axis/task-engine-contracts/request-admission.md)：共享 preparation | 相同 Digest 可共享获取验证，不合并 Request、token 或 Task。 | 相同根 CID 可共享，节点/网关不参与身份；仍不合并请求，也不预先决定 Run 共享。 |
| [Run 匹配](../../../../../../docs/axis/task-engine-contracts/run-matching.md)：类型身份 | 用精确 Bundle 内容身份约束匹配，不依赖获取 URL。 | 精确身份统一为根 CID；不同 CID 不共享，相同 CID 仍须满足 Input、可信边界与时间条件。 |
| [持久化恢复](../../../../../../docs/axis/task-engine-contracts/persistence-recovery.md)：请求与运行事实 | 保存原 URL/Digest，恢复和执行必须满足原 Digest。 | 保存原 IPFS 根引用与 CID，恢复读取同一内容，不绑定原节点/网关，也不换用其他 CID。 |
| [历史内容保留](../../../../../../docs/axis/task-engine-contracts/task-bundle.md#历史-bundle-内容保留) | 历史保留 URL/Digest，不承诺永久留存内容；缺失时依赖它的操作失败。 | 历史保留 CID，不承诺永久递归 pin；缺块或无提供者时明确失败，不改写历史。 |
| [历史内容保留](../../../../../../docs/axis/task-engine-contracts/task-bundle.md#历史-bundle-内容保留)：活动工作保护 | 淘汰历史缓存不能破坏仍在 preparation 或执行的内容。 | 同样保护活动工作，覆盖 IPFS 块与本地物化目录；pin、租约或副本是保留机制，不是额外身份。 |
| [观察契约](../../../../../../docs/axis/task-engine-contracts/observation.md)：身份追溯与筛选 | 能追溯实际 Bundle 内容身份；名称与获取 URL 不能替代它。 | Run 类型身份与类型筛选使用相同 CID 语义，不新增 Bundle 文件变化事件或 IPFS 资产订阅。 |
| [历史草稿](../../../../../../docs/axis/task-engine.draft.md) | 保留历史时期 Bundle digest、URL 等陈述。 | 只补充指向新 CID 契约的说明，不改写历史整理或将其作为新规范。 |

## 明确保留的行为

| 项目 | Before / After 均保持 |
| --- | --- |
| 原始 Request 与幂等 | 保存原始意图及省略语义；同一 `requestId` 下的意图改变仍冲突。 |
| 受理前 preparation | 先验证完整 Bundle 与 Input，再创建 Task；不计入 Task 超时预算，不是 Run 内业务准备。 |
| Bundle 内容契约 | `task.yaml` 字段、`$schema` 协议选择、共享 Schema 离线闭包与自包含 `worker.cjs` 不变。 |
| 文件与执行边界 | 安全路径、拒绝链接/特殊文件、完整准入、只读使用及本地 Worker 执行不变。 |
| Task / Run 行为 | 生命周期、时间、取消、终止、共享匹配的其他条件、数据域独占、Revision、分页与订阅不变。 |
| 历史事实 | 不依赖 Bundle 内容的历史读取不因内容淘汰失效；获取内容不等于重跑旧 Run。 |

## 排除范围与实施边界

- 不改既有 Checker/Objective/Probe 业务制品的 Git 摘要、URL、归档或业务输入，
  也不将业务字段中的浮动引用自动改成 IPFS。
- 不建设通用 IPFS 资产目录或生命周期产品，不引入来源授权、保密承诺、IPNS 最新版解析
  或按需远程加载业务代码，不提供新旧引用双轨兼容。
- 本轮仅修订文档；后续才落实 IPFS 实现、可复现导入参数、宿主配置与新架构消费链路。

后续实施须将新架构的协议、SDK 构建发布、宿主装载缓存、持久身份和消费端统一接到标准 IPFS 实现。
UnixFS 导入参数须固定并可复现；单文件读取须验证根到文件的 DAG，而完整准入仍验证全部文件。
CID 不是现有 Git 文件树摘要的改名；旧库与旧制品不因本构想自动迁移。
发布与宿主环境分别承担内容保留及活动工作保护，历史 CID 留存不等于永久可获取。
