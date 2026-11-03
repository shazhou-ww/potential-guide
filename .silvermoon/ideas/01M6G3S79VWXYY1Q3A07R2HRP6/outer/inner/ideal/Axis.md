# Axis 变更对照：Before / After

本构想只跟踪 Task Engine 新架构的 Task Bundle 寻址与交付。
本轮修改目标架构文档，不声称现有协议、SDK、缓存、存储或消费端已完成实现。

Before 指本 IDEA 修订前的 axis 契约，After 指本 IDEA 提出的新架构目标，
不是已经上线的新协议。以下重点展示行为差异，而非运行时代码修改清单。

## Request 会变成什么样

唯一需要改变的引用字段是 `bundle`：从 `{url, digest}` 对象变成完整根 CID 字符串，
或带获取提示的 `{cid, hint}` 对象。不新增 Request 顶层字段，不改变业务输入的组织方式。

```ts
type BundleReference =
  | string
  | {
      cid: string;
      hint: string | string[];
    };
```

字符串只填写根 CID，不填写 IPFS URI；对象的 `hint` 表示一个 gateway 基址 URI
或有序候选 gateway URI 列表，字段名使用 `hint`，不是 `gatewayHint`。

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

### After：无 hint

```json
{
  "requestId": "<ULID>",
  "bundle": "<root-CID>",
  "value": 7,
  "timeoutMs": 10000,
  "matchPolicy": "starts-after-eligible"
}
```

### After：单个 gateway hint

```json
{
  "requestId": "<ULID>",
  "bundle": {
    "cid": "<root-CID>",
    "hint": "https://gateway.example.com"
  },
  "value": 7,
  "timeoutMs": 10000,
  "matchPolicy": "starts-after-eligible"
}
```

### After：多个候选 gateway

```json
{
  "requestId": "<ULID>",
  "bundle": {
    "cid": "<root-CID>",
    "hint": [
      "https://gateway-a.example.com",
      "https://gateway-b.example.com"
    ]
  },
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
这些示例只比较协议形状，不表示同一 `requestId` 可以先提交旧引用再改成新引用；
幂等仍核对完整原始意图，旧记录不自动迁移。

`bundle` 必须引用整个 UnixFS 目录根。读取某个文件则另用标准路径：

```text
Request 的 Bundle 简写：<root-CID>
单文件引用：  ipfs://<root-CID>/resources/config.json
```

单文件路径不是提交 Task 时的 `bundle` 值，不新增 Task 文件读取控制操作。
即使业务输入本身包含文件引用，也由该类型的 Input Schema 决定，不由 Engine 自动添加。

### Hint 与身份的区别

- 三种 After 形式的根 CID 相同时，内容身份相同，hint 不参与内容缓存、共享 preparation
  或 Run 匹配；不存在第二套摘要。
- Hint 是 gateway 基址 URI，不是拼好 `/ipfs/<CID>` 的内容 URL，也不是任意提示对象。
  数组顺序表示偏好，不要求从全部 gateway 获取，不规定串行、并行或重试算法。
- 宿主可以采用 hint，也可以使用其他配置的 gateway 或 IPFS 节点；
  调用方提示不是可信配置或访问授权，采用前仍须遵守宿主网络访问策略。
- 所有获取结果仍验证同一 CID/DAG。Hint 不可用不允许换内容，
  非法 hint 明确报请求错误，不静默当作无 hint 的成功输入。
- 同一 `requestId` 换引用形式、改 hint 或调整候选顺序，仍是原始意图改变，按幂等冲突处理。
  内部可解析为 CID 与候选列表，但不回写原始 Request。

## 寻址与交付对照

本节依据[Task Bundle 契约](../../../../../../docs/axis/task-engine-contracts/task-bundle.md)。

| 变化点 | Before | After |
| --- | --- | --- |
| Request 的 Bundle 引用 | 必须同时提供 `{url, digest}`。 | 根 CID 字符串或 `{cid, hint}`；CID 是唯一内容身份，hint 仅为可选获取提示。 |
| 展示与填写形式 | 自定义 `URL#digest`；还需解析回结构化对象。 | 无 hint 直接填 CID，有 hint 使用对象；单文件链接仍使用 IPFS URI，不再维护 URL/摘要拼合协议。 |
| 获取位置 | 发布 URL 属于必填引用，调用方必须知道某个位置。 | 位置不再必填；可用 hint 提供单个或多个 gateway 候选，宿主决定是否采用，不影响身份。 |
| 内容身份 | 自定义 Git SHA-256 文件树 Digest。 | 标准 UnixFS 目录根 CID，不再维护平行摘要；固定导入参数以保证可复现。 |
| 交付对象 | 文件树打包成 tar.gz，压缩包作为下载对象。 | 文件树直接导入为 UnixFS 目录，传输其 DAG 与文件块，不再要求 tgz。 |
| 构建与发布结果 | 构建目录与 Digest，再打包并取得 URL，组成完整引用。 | 构建目录，再导入取得根 CID；发布环境可附带 hint，CID 生成与发布保留结果明确区分。 |
| 包内单文件读取 | 此交付链路须下载并解包，才能按路径读取内部文件。 | 可按根 CID 加路径直接读取并验证所需 DAG 与文件块，无需先取全包。 |
| Worker 内资源读取 | 只约定本地 Bundle 目录，未定义 context 的资源读取接口。 | 经 Task context 以 Bundle 根相对路径读取内容，不依赖 Worker 的 `__dirname`、工作目录或 gateway 位置。 |
| 完整性验证 | 解包后重算 Git 文件树摘要，与期望 Digest 比对。 | 使用标准 IPFS 实现验证 CID、DAG 链接和块；普通 HTTP 字节响应不能替代验证。 |
| Bundle 合法性 | 内容摘要通过后，还须检查声明、入口、Schema 与文件集合。 | 相同检查保留；CID 验证通过不代表 Bundle 合法。 |
| 共享 Schema | 全部定义收录在 Bundle 内，并纳入完整 Digest；装载不联网补契约。 | 全部定义仍收录在同一目录并受根 CID 约束，离线闭包规则不变。 |
| 完整装载与执行 | 获取完整归档并解包，验证后启动本地只读 `worker.cjs`。 | 完整验证后以 Node 支持的方式装载同一入口；物理位置与资源物化是宿主实现选择，不向业务暴露。 |
| 宿主容量 | 限制下载、解压后总字节数、单文件大小和文件数量。 | 限制传输、文件树总字节数、单文件大小、文件数量及 DAG 遍历预算；超限仍明确失败。 |
| 内容缓存 | 按自定义 Digest 存储完整内容，不同 URL 可复用。 | 可由本地 IPFS 节点承担块缓存与 pin/GC；Engine 负责准入、入口装载和 context 读取，不要求独立内容分发缓存或长期物化目录。 |
| 展示名称 | 名称不是身份；修改名称会改变 Digest。 | 名称仍不是身份；修改名称会改变根 CID，CID 缩写仍不能用于真实操作。 |

交付链路可以概括为：

```text
Before：成品文件树 → Git tree Digest → tgz + 发布 URL → 下载 / 解包 → Digest 验证 → 本地执行
After： 成品文件树 → UnixFS 导入 / 根 CID → IPFS 获取 / 完整验证 → 宿主装载入口 → Worker 经 context 读资源
```

## Engine 初始化：Before / After

初始化决定宿主如何可信地获取 Bundle；Request 的 CID 决定获取哪份内容，
hint 只是候选获取位置。新架构需要可用的通用 IPFS client/access，
但不要求把 HTTP gateway URI 定义为 Engine 的唯一或必填依赖。

### Before：Engine 自带 URL 下载与目录缓存

下面使用[现有 Bundle Engine API](../../../../../../packages/task-engine/src/bundle-engine.ts)
展示变化前的配置形状；`store` 由宿主提供，其他无关配置省略：

```ts
const engine = createTaskEngine({
  store,
  bundleDirectory: bundleCacheDirectory,
});
await engine.start();
```

当前必须配置 `bundleDirectory`；Engine 自建 Bundle 缓存，从 Request 的 URL 获取归档，
解包并验证 Digest。`fetchBundle` 可选，用于替换 HTTP 获取实现；
本机 `file:` 读取仍属于既有获取链路。初始化不需要配置 IPFS 节点或 gateway。

### After：宿主提供通用 IPFS client/access

以下是新架构的逻辑示意，不是已经实现的 API；
初始化参数统一命名为 `ipfsClient`，由可信宿主装配通用 IPFS 客户端，
不是 Bundle 专属读取对象：

```ts
const engine = createTaskEngine({
  store,
  ipfsClient,
});
await engine.start();
```

该能力只处理 CID、DAG 节点与链接、UnixFS 路径及文件内容，复用标准 IPFS 获取与验证，
不理解 `task.yaml`、Bundle 格式、Task 或 Run。宿主配置连接与网络访问策略；
通用 pin/保留能力可由底层提供，但活动内容保护的生命周期由 Engine 协调。
Engine 负责将根节点解释为 Bundle、执行准入、装载入口及向 Worker 提供 SDK 的 context 读取能力，
不能因为获取实现被注入就跳过声明、文件集合或容量校验。
其具体接口、配置字段与资源所有权在实施阶段落实，不提前固定实现类或启动外部服务。

| 变化点 | Before | After |
| --- | --- | --- |
| 获取依赖 | Engine 自带 URL/文件获取；可选 `fetchBundle` 替换 HTTP 获取。 | 宿主装配只处理节点与内容的标准 IPFS client/access，不把 gateway URI 当作唯一接口。 |
| 默认获取位置 | 必填 Request URL 决定下载位置。 | 默认 IPFS 获取路径由初始化能力配置；Request 可额外提供 gateway hint。 |
| 是否必须传 gateway | 原链路不使用 IPFS gateway。 | 不必；gateway 是获取能力的一种实现，本地节点、远程可验证网关或嵌入式 IPFS 都可作为实施选择。 |
| 本地 gateway 场景 | 没有原生 IPFS 获取与验证配置。 | 宿主可让访问能力连接已配置的本地 IPFS 节点/gateway；不代表 Engine 自动安装、启动或管理节点。 |
| 内容缓存 | `bundleDirectory` 是 Engine 自维护的内容缓存目录。 | 块缓存复用 IPFS 节点/实现，不要求独立 Bundle 分发缓存；可选入口文件与物化目录不是业务路径契约。 |
| 初始化配置错误 | 校验既有可信配置，错误明确报告。 | 缺少有效获取能力或配置无效时明确报初始化错误，不把 Request hint 当作可信初始化的替代。 |
| 网络内容暂不可用 | URL 获取失败按提交失败处理。 | 合法初始化不承诺每个 CID 可获取；节点离线、缺块或读取失败按实际操作明确报告，不要求初始化时预取所有 Bundle。 |
| 重启与生命周期 | 固定数据域、恢复持久事实并管理 Worker 生命周期。 | 相同规则保留；访问能力与可选目录配置不改变数据域身份，也不自动重演旧 Run。 |

使用 gateway 的第一版实现可以要求配置默认 gateway，但那是该实现的配置要求，
不是 Engine 核心契约要求。无论选哪种后端，均必须满足同一 CID/DAG 验证、
完整准入、容量限制和 Run 资源保护边界。
上述示例的 `store` 只为展示当前 API；[职责入口](../../../../../../docs/axis/task-engine-responsibilities.md)
中逻辑初始化 `openTaskEngine({ dataDomain, ipfsClient })` 的数据域绑定语义不因引入 IPFS 改变，
也不表示要同时建立第二套初始化入口。

### 初始化能力与 Request hint 的分工

| 输入 | 来源与用途 | 不承担的职责 |
| --- | --- | --- |
| IPFS client/access | 由可信宿主初始化装配；提供节点/内容获取、验证及通用保留能力，执行宿主访问策略。 | 不解释 Bundle、Task 或 Run，不提供 Bundle 专属读取协议，不把 gateway 地址当作内容身份。 |
| Request 的根 CID | 调用方明确指定不可变 Bundle 内容。 | 不保证内容留存，也不指定必须使用的节点或网关。 |
| Request 的 hint | 调用方提供单个或有序候选 gateway，获取层可按宿主策略采用。 | 不初始化访问能力，不提供访问授权，不修改宿主配置，不绕过 CID 验证。 |

只提供 CID 的 Request 必须能通过初始化配置的获取能力处理；
带 hint 的 Request 仍经过同一能力与策略，不能成为另一条未经校验的获取通道。
这也是 context 不需要暴露 gateway 的原因：业务只读当前 Bundle 的相对路径内容，
后端选择与连接细节留在宿主获取层。

### IPFS 节点、Engine 与 Task context 的分层

```text
IPFS client/access：CID、DAG 节点/链接、UnixFS 内容获取与验证、通用 pin
        ↓
Engine 装载层：将根节点解释为 Bundle，校验声明/文件树，协调活动保护与 Worker 启动
        ↓
Task SDK / context：可信绑定当前 Bundle，向业务提供相对路径内容读取
```

这里的“节点”指 CID 标识的内容 DAG 对象，不是某台服务机器。
底层不增加 `openBundle`、Bundle Schema 校验或 Run 租约语义；
context 的 `bundle.readFile(...)` 是 SDK 的领域封装，而不是 IPFS client 的接口。
实际连接可以是本地 IPFS 服务、gateway 或嵌入式实现，不另造一套节点访问工具。

## Worker 如何访问 Bundle 内容

业务回调只知道“当前 Run 所属 Bundle”和其中的相对路径，不知道文件在宿主哪里。
以下是 SDK 访问契约示意，不表示方法已经实现：

```ts
const bytes = await context.bundle.readFile("resources/config.json");
const config = JSON.parse(new TextDecoder().decode(bytes));
```

| 变化点 | Before | After |
| --- | --- | --- |
| 路径基准 | Bundle 有本地目录，但缺少统一业务读取接口。 | 相对于当前 Bundle 逻辑根，不相对于进程工作目录或入口物理目录。 |
| 获取细节 | 本地文件布局可能成为业务自行读取的依赖。 | SDK 封装读取，宿主选择本地内容或 IPFS 后端；业务不拼接 gateway 或感知目录。 |
| 内容归属 | 从已装载 Bundle 读取。 | Context 可信绑定当前 Run 的根 CID；读取参数与业务 Input 不能切换 CID。 |
| 读取结果 | 依赖业务自行选择文件系统访问方式。 | 异步返回文件内容，不返回物理路径、句柄或 gateway；不存在、越界、获取/验证失败明确报错。 |
| 活动资源 | 本地目录需受保护。 | IPFS 内容、可选本地文件及在途读取均遵守 Run 停止、保护与释放边界。 |

Node Worker 不能原生以 IPFS URI 作为入口。宿主仍须采用 Node 支持的方式装载
自包含 `worker.cjs`，但不要求业务通过入口目录寻找资源。
资源是否落地、是否保留物化目录或经本地 gateway 读取，属于实现选择。
Gateway 是读取入口，真正的块缓存、pin 和 GC 由其背后的 IPFS 节点承担。
Context 封装不取消准入前的完整 Bundle 验证，也不承诺 Node Worker 是安全沙箱。

### 是否必须写本地物化文件

不必将“写本地 Bundle 文件”作为读取或启动的强制环节；以下说明可选实现，
并不表示已经选定、实现或验证了完整 SDK 的无文件启动方案。

| 内容 | 内存 / 流读取方式 | 必须保留的边界 |
| --- | --- | --- |
| Bundle 内资源 | IPFS 读取为字节或流，由 context 封装；可以不写本地资源文件。 | 固定根 CID、相对路径检查、容量与停止约束、活动内容保护、明确读取错误。 |
| Worker 代码 | 获取并验证自包含 `worker.cjs`，读入有界内存，再以 Node 支持的源码方式启动。 | 完整有效源码与编码、独立 Worker、SDK 握手和退出协议；不能直接把 IPFS URI、流或字节数组交给 Worker 构造器。 |
| 完整准入 | 遍历并验证全部 Bundle 文件与声明，可逐文件处理，不要求形成持久物化目录。 | 不能只验证入口或把完整文件树验证延迟到业务执行；流式读取不取消整包验证。 |

CommonJS 可以使用 `new Worker(source, { eval: true })` 从内存源码启动；
本轮仅用独立 Node 探针验证了这种启动方式能执行源码并接收内存字节，
不是生成的 Task SDK Worker 全链路验收。
实施时仍须检查生成入口、自包含依赖、通信握手、错误栈与诊断定位；
本构想不要求物理文件位置，也不以源码启动引入远程动态代码或外部依赖加载。
资源流可以有背压，不应为读取大文件默认将整个 Bundle 一次性聚合到内存；
现有 context `readFile` 示例返回 `Uint8Array`，是否另提供流式 SDK 方法在实施时确定。
不写业务物化文件不等于全系统无磁盘：IPFS blockstore 与 Engine 持久事实仍可使用磁盘。

## 受理、匹配、恢复与观察对照

| 文档 / 变化点 | Before | After |
| --- | --- | --- |
| [职责边界](../../../../../../docs/axis/task-engine-responsibilities.md)：类型装载 | Engine 通用获取、校验、缓存和装载，不要求预注册类型。 | 获取改为 IPFS，宿主装载入口并提供 context 读取与活动内容保护；不要求预注册，不扩展为任意 IPFS 资产管理。 |
| [Request 受理](../../../../../../docs/axis/task-engine-contracts/request-admission.md)：准入 | 校验 URL/Digest，获取验证 Bundle，再按其 Schema 校验每个 Request。 | 校验多态引用、CID 和 hint，按宿主访问策略获取验证完整 Bundle；逐请求校验及 preparing/accepted/rejected 结果不变。 |
| [Request 受理](../../../../../../docs/axis/task-engine-contracts/request-admission.md)：共享 preparation | 相同 Digest 可共享获取验证，不合并 Request、token 或 Task。 | 相同根 CID 可共享，节点/网关不参与身份；仍不合并请求，也不预先决定 Run 共享。 |
| [Run 匹配](../../../../../../docs/axis/task-engine-contracts/run-matching.md)：类型身份 | 用精确 Bundle 内容身份约束匹配，不依赖获取 URL。 | 精确身份统一为根 CID；不同 CID 不共享，相同 CID 仍须满足 Input、可信边界与时间条件。 |
| [持久化恢复](../../../../../../docs/axis/task-engine-contracts/persistence-recovery.md)：请求与运行事实 | 保存原 URL/Digest，恢复和执行必须满足原 Digest。 | 保存原多态引用、hint（如有）与根 CID；恢复可按宿主策略利用 hint，但不绑定原节点/网关，也不换用其他 CID。 |
| [历史内容保留](../../../../../../docs/axis/task-engine-contracts/task-bundle.md#历史-bundle-内容保留) | 历史保留 URL/Digest，不承诺永久留存内容；缺失时依赖它的操作失败。 | 历史保留 CID，不承诺永久递归 pin；缺块或无提供者时明确失败，不改写历史。 |
| [历史内容保留](../../../../../../docs/axis/task-engine-contracts/task-bundle.md#历史-bundle-内容保留)：活动工作保护 | 淘汰历史缓存不能破坏仍在 preparation 或执行的内容。 | 同样保护活动工作，覆盖 IPFS 块、可选本地文件及 context 读取；pin、租约或副本是保留机制，不是额外身份。 |
| [观察契约](../../../../../../docs/axis/task-engine-contracts/observation.md)：身份追溯与筛选 | 能追溯实际 Bundle 内容身份；名称与获取 URL 不能替代它。 | Run 类型身份与类型筛选使用相同 CID 语义，不新增 Bundle 文件变化事件或 IPFS 资产订阅。 |
| [历史草稿](../../../../../../docs/axis/task-engine.draft.md) | 保留历史时期 Bundle digest、URL 等陈述。 | 只补充指向新 CID 契约的说明，不改写历史整理或将其作为新规范。 |

## 明确保留的行为

| 项目 | Before / After 均保持 |
| --- | --- |
| 原始 Request 与幂等 | 保存原始意图及省略语义；同一 `requestId` 下的意图改变仍冲突，包括新引用形式、hint 或候选顺序的改变。 |
| 受理前 preparation | 先验证完整 Bundle 与 Input，再创建 Task；不计入 Task 超时预算，不是 Run 内业务准备。 |
| Bundle 内容契约 | `task.yaml` 字段、`$schema` 协议选择、共享 Schema 离线闭包与自包含 `worker.cjs` 不变；context 读取能力属于 SDK/宿主接口新增，不改声明字段。 |
| 文件与执行边界 | 安全路径、拒绝链接/特殊文件、完整准入、只读使用及 Node Worker 隔离不变，不承诺固定资源目录布局。 |
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
SDK 新增 context Bundle 读取接口及宿主支持；若需扩展 Worker 通信协议，
必须遵守既有 `$schema` 协议版本规则，不原地改写已有协议。
CID 不是现有 Git 文件树摘要的改名；旧库与旧制品不因本构想自动迁移。
发布与宿主环境分别承担内容保留及活动工作保护，历史 CID 留存不等于永久可获取。
