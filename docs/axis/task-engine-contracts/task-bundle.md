---
frozen: false
---

# Task Bundle、类型装载与运行库

本契约补充 TaskType 的交付、引用、装载与执行边界，记录 Task Bundle 的设计共识，
不表示当前代码已经实现这些能力。不以现有 Check/Probe 制品格式或本地模块注册 API
反向限制本契约。以下定义成品目录、声明文件与生成入口的目标格式；
公共 SDK 和构建工具已提供实现；具体参数与通信编码见
[SDK 文档](../../../packages/task-sdk/README.md)和[Worker 协议](../../task-bundle-worker.md)，
不将这些实现细节反向限定为全部架构契约。迁移方案仍需按明确授权处理。
本文只定义通用 Task Bundle 与 Task SDK；Check/Probe 的描述逻辑、业务入口和专用 SDK
留待独立业务文档定义，不作为 Engine 核心契约的一部分。
IPFS 内容寻址与目录交付仅适用于此处的 Task Engine 新架构；
不改变既有 Check/Probe 等业务制品的引用、摘要算法或传输格式。

关联[职责入口](../task-engine-responsibilities.md)中的 TaskType 与可信装配；
Run 的匹配、停止和退出事实仍遵守[运行匹配](./run-matching.md)与[运行终止](./run-termination.md)。

## TaskType 与 Task Bundle

1. TaskType 定义输入、输出与消息契约，并实现一次完整 Run；Task Bundle 是该类型的自包含交付制品。
2. 每份 Bundle 在根目录使用 `task.yaml` 描述类型契约，声明 Worker 入口和输入、结果、消息 Schema。
   Engine 不执行业务代码来发现输入契约。
3. Worker 入口实现完整 Run，包括类型自身需要的准备、业务资源分配与实际执行，
   而不只是其中的实际业务执行步骤。
4. Engine 不内置业务类型的特殊执行分支；具体业务可以基于 Task Bundle 定义特化，
   其业务声明、文档和静态资源由相应业务库解释。
5. 本契约不将既有业务制品自动视为 Task Bundle；
   新旧格式的关系必须另行明确，不能只改文件名或摘要名称就认为已完成转换。

## 成品目录与声明格式

Bundle 声明以 `$schema` URL 统一标识声明格式与 Worker/Engine 通信协议，
沿用现有 Checker/Objective YAML 制品的 Schema URL 方式，
不另设数字 `formatVersion` 或独立 `protocolVersion`。同一个 Schema URL 对应唯一确定的通信协议契约。
唯一标识为
`https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json`，
同时包含独立诊断日志协议。当前 `frozen: false`，v1 可原地演进；
契约是否冻结以[axis 冻结标记](../task-engine-responsibilities.md#axis-协议冻结标记)为准，
不根据版本号或是否发布自行推断。
已移除的 Task v2 与未来未知 Schema URL 均明确拒绝，不作为 v1 别名。
机器定义见 [v1](../../../schemas/artifacts/task/v1.json)，日志规则见[日志契约](./run-logs.md)。

此格式的 Bundle 逻辑根目录如下；对应 IPFS UnixFS 目录根，不附加包名或版本外层目录：

```text
task.yaml
worker.cjs
schemas/         # 可选的共享 JSON Schema
resources/       # 可选的业务静态资源
```

`worker.cjs` 是唯一可执行入口，所需 JavaScript 依赖打包在该文件内。
`resources/` 用于数据、文档等静态资源，不作为第二个依赖安装目录或动态加载外部业务代码的通道。
文件路径必须位于 Bundle 根内；不允许绝对路径、越界路径、符号链接或特殊文件。
Bundle 只读使用，运行产生的临时文件与输出不写回内容缓存。

`task.yaml` 示例：

```yaml
$schema: https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json
name: Repository Check
runtime:
  type: node
  minVersion: "22.13.0"
entry: worker.cjs
include:
  - task.yaml
  - worker.cjs
inputSchema:
  type: object
  properties:
    target:
      type: string
  required:
    - target
  additionalProperties: false
resultSchema:
  type: object
  properties:
    ok:
      type: boolean
  required:
    - ok
  additionalProperties: false
messageSchema: false
```

字段约束：

| 字段 | v1 约束 |
| --- | --- |
| `$schema` | 必填，固定为 `https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json`，同时确定 Bundle 声明格式与 Worker/Engine 通信协议，不是业务版本。 |
| `name` | 必填，非空单行展示字符串；允许 Unicode 和内部普通空格，允许重名，不作为机器标识。 |
| `runtime` | 必填对象，仅包含 `type` 和 `minVersion`；`type` 为 `node`，`minVersion` 为稳定的三段数字版本字符串。 |
| `entry` | 必填，固定为 `worker.cjs`，指向 Bundle 根目录内的 CommonJS 文件。 |
| `include` | 必填，完整成品的精确相对文件路径数组，包含 `task.yaml` 自身和 Worker；不允许通配符、重复、大小写歧义或文件/目录冲突。 |
| `inputSchema` | 必填，使用 Engine 支持的 JSON Schema Draft 2020-12 输入契约；可内联或通过 `$ref` 引用共享 Schema，解析后仍要求根输入为对象。 |
| `resultSchema` | 必填，使用 Engine 支持的 JSON Schema Draft 2020-12 结果契约；可内联或通过 `$ref` 引用共享 Schema。 |
| `messageSchema` | 必填，使用相同方言并支持 `$ref`；`false` 表示不接收业务消息，不能用省略代替。 |

1. 上表为 v1 完整顶层字段；未知字段、缺失字段或错误类型明确拒绝，不静默忽略。
   `$schema` 是声明格式与通信协议选择的唯一依据，不接受 `formatVersion` 或 `protocolVersion` 字段。
2. YAML 只承载 JSON 可表示的值；拒绝重复键、别名、自定义标签、非字符串对象键和非有限数值。
   输入、结果和消息 Schema 可以引用内部定义或 Bundle 内收录的共享 Schema，
   但不能在装载或运行时通过远程引用获取另一份契约。
   声明中的 `$ref` 可以使用相对于 Bundle 根的精确文件路径，例如
   `schemas/0.json` 或 `schemas/0.json#/$defs/value`；路径必须对应清单内的
   Schema 文件。文件路径和资源自身的绝对 `$id` 均由同一离线解析器绑定，
   文件内引用仍遵循其 `$id` 基址，不把逻辑资源标识当作联网请求。
3. 不支持的格式、协议、Schema 能力或 Node 版本明确拒绝，不启动业务执行。
   宿主按明确支持的 `$schema` URL 选择对应声明验证器和通信协议实现，
   不自动下载未知 URL 并将其当作可信格式；能验证 YAML 不等于支持对应通信协议。
   当前声明格式与通信协议未冻结，统一在 v1 内原地演进。
   明确标记 `frozen: true` 后，不兼容迭代另行确定新的 Schema URL 与迁移规则。
   此 Schema 标识不意味着现有内部通信可直接兼容。
4. Bundle 根 CID 不写入 `task.yaml`，避免内容身份自引用；
   完整成品目录导入 IPFS 后取得根 CID，形成外部引用。
   精确清单与实际文件集合必须一致，缺失和额外文件均拒绝。
   旧的无清单 Bundle 不走兼容回退，必须重新构建并使用新的根 CID。
5. 不声明 npm dependencies、宿主模块路径、factory 导出名或安装命令。
   Worker 入口是可直接启动的程序，不是由 Engine 导入并调用的业务 factory。
6. Request 携带完整 Bundle 的 IPFS 根引用，以目录根 CID 确定具体制品，
   不另设核心注册名或独立业务版本字段。`name`、Schema URL 和 SDK 包版本都不能替代根 CID。
7. 业务专属声明放在业务资源中或构建进入口，不向 `task.yaml` 增加 Engine 必须解释的
   业务字段。作者以同源 TypeBox 定义提供三份 Schema 及其推导类型，
   构建工具生成运行声明与离线 Schema，不要求在业务回调中重复维护另一份契约。

### 展示名称

1. `name` 只供列表、日志等显示场景使用，不参与任务路由、匹配或版本选择。
   不同 Bundle 可以同名，不要求全局或宿主内唯一。
2. 允许中文等 Unicode 字符和内部普通空格，例如 `Repository Check` 或 `仓库结构检查`。
   拒绝空字符串、首尾空白、换行、制表符和控制字符，不自动 trim 或修正输入。
3. 不做大小写归一化或唯一性判断。消费者将名称作为纯文本展示，
   不将其解释为 HTML、Markdown、文件路径或命令。
4. 界面可以同时展示名称和 CID 缩写辅助辨认，但实际操作必须使用完整 CID，
   不能将缩写当作唯一身份。
5. 名称属于 Bundle 原始内容，修改名称会改变根 CID；
   它不是可在宿主侧修改而不改变制品身份的别名。

## 共享 Schema 与离线引用

输入、结果和消息契约均可使用标准 JSON Schema `$ref` 引用共享定义。例如，
以下片段可替换前述示例的 `resultSchema`：

```yaml
resultSchema:
  $ref: https://example.com/schemas/task-result/v1.json
```

此 URL 仅为引用形式示例，不是实际发布的公共契约。
不引入以 URL 字符串直接代替 Schema 的自定义简写，布尔 Schema 仍按标准语义处理。

1. 业务 Schema URL 标识共享定义，不选择 Worker 通信协议；
   只有 `task.yaml` 顶层 `$schema` 承担 Bundle 格式与协议选择职责。
2. 构建时 SDK 解析共享 Schema 及其传递引用，将完整依赖闭包作为 JSON 文件收录到
   Bundle 的 `schemas/` 中。公共 SDK 可以自带常用 Schema，不要求每次构建联网获取。
3. 收录的共享 Schema 以 `$id` 声明其绝对资源 URL；构建器和宿主据此建立 Bundle 内的
   Schema 注册表，不从文件名猜测 URL。相同资源标识的重复或冲突定义必须拒绝，
   不按加载顺序覆盖。
4. `$ref`、`$id`、片段及相对引用遵循 JSON Schema Draft 2020-12 的解析语义；
   解析后的目标必须落在当前契约内部或该 Bundle 收录的 Schema 资源内。
   引用不因其使用 HTTPS URL 就自动触发网络请求。
5. 作者构建环境必须锁定所引用共享 Schema 的精确内容，包括传递依赖；
   可使用锁定的 SDK 包内定义或经内容摘要校验的外部 Schema。
   相同 URL 内容发生变化时不能静默更新锁定值，应明确失败并由作者显式更新。
6. 所有收录的 Schema 文件纳入 Bundle 根 CID 所标识的完整目录。
   Schema URL 不是其唯一内容身份，远程定义后续变化不能改变已交付 Bundle 的契约。
   Bundle 内不必为每个 `$ref` 重复附加摘要或 CID，完整内容校验已经覆盖这些定义。
7. Engine 在装载时离线解析并验证三份契约及其引用闭包；缺失资源、无效片段、
   冲突标识或不支持的 Schema 能力明确拒绝，不联网补齐，也不借用其他 Bundle 的定义。
8. Worker 运行库使用同一次构建固定的契约和共享定义，不能自行获取更新；
   宿主与 Worker 不得因各自环境中安装了不同公共库而解析出不同契约。
9. 共享引用不放宽既有输入约束。提交校验和输入结构判等必须使用同一份已解析契约，
   不能把 `$ref` 当作未知字段忽略，或因未内联而跳过校验与判等。
   允许的额外输入字段也参与判等，见[输入校验与结构判等](#输入校验与结构判等)。

## 输入校验与结构判等

1. 输入校验判断输入是否符合 Schema；结构判等用于判断不同 Task 的输入是否满足 Run 共享条件，
   两者不能互相替代。两个输入都合法，不表示它们相等。
2. Schema 允许的额外字段也参与输入结构判等。不能仅投影 `properties` 中显式声明的字段，
   再忽略其他合法输入字段的差异；额外字段的存在或取值不同，也会使输入不等。
3. 例如 Schema 只声明字符串字段 `target`，并设置 `additionalProperties: true`：
   `{"target":"repo-a","mode":"fast"}` 与 `{"target":"repo-a","mode":"full"}` 都合法，
   但因 `mode` 不同而不等，不能共享 Run。不能因为 `mode` 未列入 `properties` 就忽略它。

此判等不替代[Request 幂等检查](./request-admission.md)对完整原始请求意图的比较。

## 作者入口与生成的 Worker

作者提供 `task.build.yaml`、TypeBox 契约模块与普通 TypeScript/JavaScript 业务回调模块；
构建工具生成完整 `task.yaml`、Worker、共享 Schema 和精确清单，不维护第二份顶层运行声明。
作者流程见 [task-bundle CLI](../../../packages/pguide-task-bundle/README.md)。
构建工具接收作者定义与业务模块，
由构建参数选择模块导出，不将源码路径或导出名加入成品声明。
声明中的 `entry: worker.cjs` 指向生成的成品入口，不是作者的源代码模块。
作者模块不是最终 Worker，不需要自行处理 `parentPort`、`workerData`、握手、消息序列号或退出通信。
普通 Task 回调的逻辑形状为：

```ts
async function taskCallback(input: Input, context: RunContext): Promise<Result> {
  // 具体业务实现。
}
```

回调边界如下：

- `input` 是通过声明的 Input Schema 校验后的业务输入。
- `context` 由 Task SDK 构造，提供当前 Run 信息、停止信号、进度、checkpoint、
  业务消息和独立诊断日志能力，并按本文的 Context Bundle 契约提供当前 Bundle 的只读内容访问。
  可信身份、确认与结束行为见[RunContext 契约](./run-context.md)。
  具体成员类型由 SDK/Protocol 定义，不要求作者拼写底层协议。
- 回调返回最终结果，由 SDK 按 Result Schema 校验并上报；抛出错误表示执行失败。
- SDK 不向回调传入原始 Worker 通信端口或 Engine 实例。
  业务作者不自行构造协议消息，停止、结果上报与退出通信由 SDK 统一处理。

此约束定义 SDK 提供的接口边界，不表示 Node Worker 能阻止业务代码自行导入 Node 内置模块，
也不构成安全沙箱承诺。

具体类型、资源配置与构建参数由 Task SDK 提供，不能要求作者拼写底层通信协议。

构建工具生成以下启动逻辑，并将导入及其传递依赖全部打包到 `worker.cjs`：

```ts
runTask(taskCallback);
```

以上为通用启动入口的示意，不锁定完整函数签名。
生成入口还负责将同一次构建校验并解析的 YAML 契约交给运行库；
这些内部参数不由业务作者重复维护，也不从回调代码反向推导并覆盖 YAML 声明。

1. Engine 在每个 Run 的独立 Worker 中直接启动已验证 Bundle 的 `worker.cjs`，
   不再先启动一个加载业务模块的类型 Worker，然后为实际业务另起 Worker。
2. 生成入口初始化运行库并完成协议握手，随后只接收和执行该 Worker 所属的一个 Run。
   握手以同一次构建固定的 Schema URL 为兼容性标识，必须与已验证 `task.yaml` 的声明一致；
   不另行协商独立协议版本。不匹配时明确失败，不能继续调用业务回调。
3. 启动所需的可信 Run 信息、通信通道和资源能力由宿主协议提供，
   业务 Input 不能覆盖这些信息。完整握手和消息编码另行定义。
4. 回调返回结果，或抛出执行错误；运行库负责将其转换为协议结果，
   排空必须确认的业务输出、完成清理并结束通信。独立诊断不成为无限排空或清理等待条件；
   未确认清理不能伪装成成功。
5. Engine 仍独立校验跨边界数据、执行取消与强制终止，并确认物理退出；
   不能因为入口由官方 SDK 生成就信任 Worker 自报的生命周期事实。

### Context 的 Bundle 内容访问

业务回调通过 context 访问当前 Run 所属 Bundle 内的相对路径内容，
不应感知或依赖 Worker 入口与资源在宿主上的存放位置。逻辑接口及使用示意如下，
统一返回按 `Uint8Array` 分块的异步字节流；具体标准流类型与方法名在 SDK 实施时确定：

```ts
const stream = await context.bundle.readFile("resources/config.json");
for await (const chunk of stream) {
  await consumeChunk(chunk);
}
```

`consumeChunk` 表示调用方自己的消费逻辑，不是额外 SDK 方法。
Context 不再提供直接返回整文件 `Uint8Array` 的另一套读取接口；
调用方需要完整字节、文本或 JSON 时，自行有界消费并聚合流。

1. 访问能力由 SDK 封装，可信宿主绑定当前 Run 实际使用的根 CID；
   业务回调只传 Bundle 根下的相对路径，不能通过 Input 或读取参数改成另一个 CID。
2. 相对路径以 Bundle 逻辑根为基准，不以 `process.cwd()`、`__dirname` 或入口物理目录为基准。
   拒绝绝对路径、越界、链接与不符合 Bundle 文件集合规则的目标。
   具体路径编码规则复用 Bundle/IPFS 路径规则，不靠宿主路径拼接静默修正输入。
3. 接口异步返回内容流，不返回完整文件缓冲区、本地路径、文件句柄、gateway 或节点地址，
   也不提供写回 Bundle 的能力。业务回调不自行拼接 gateway URL 或实现 IPFS 获取协议。
4. 实际读取可来自受保护的本地内容或 IPFS 获取层；
   无论后端如何，均须保持当前根 CID 的内容完整性，并执行宿主适用的读取容量限制。
   文件不存在、获取失败、验证失败或资源已不可用时明确报错，不返回伪造的空内容。
   流必须支持背压与取消；返回流不等于读取成功，创建流与消费中途都可能失败。
   每个输出块须经当前根 CID 的内容链路验证，后续失败必须作为流错误暴露，不能伪装成正常 EOF。
   调用方中途停止读取时释放自己的流；取消一个消费者不终止其他 Run 或共享客户端。
   SDK 不因统一流接口就在后台预读、聚合整文件或无限缓冲。
5. 读取能力及在途操作遵守 Run 的停止与资源释放边界，不能脱离所属 Run 无限持有资源。
   宿主保护活动工作所需内容，SDK 负责封装读取通信与错误，不向业务回调暴露原始宿主端口。
6. Context 不取消准入前的目录、声明、Schema、路径及容量验证；
   资源后继块默认在读取时验证，不新增远程代码加载或依赖安装通道。
   Node Worker 仍不是安全沙箱；本规则约束官方业务访问契约，
   不声称能阻止业务代码调用 Node 内置文件系统或探测其运行环境。

## 公共 SDK 来源与构建职责

由本仓库维护并发布通用 Task SDK，包名为 `@potential-guide/task-sdk`，
将运行库与离线构建、成品检查入口分离：

```ts
import { runTask } from "@potential-guide/task-sdk";
import { buildTaskBundle } from "@potential-guide/pguide-task-bundle/build";
import { checkTaskArtifact } from "@potential-guide/pguide-task-bundle/artifact";
```

根入口供生成的 Worker 使用；`/build` 供作者构建环境使用，
接收低层声明定义、回调模块及构建参数，生成包含精确清单的自包含 Bundle。
`/artifact` 只检查成品；`/publish`、上传、RPC 配置和 pin 入口均已移除。
上传目的地、工具及保留策略由用户选择。
这些入口表示不同使用场景，不应在 Worker 中导入作者工具。
Engine 直接消费 Bundle，不要求安装该 SDK。

作者 CLI 将构建描述与 TypeBox 同源定义转成低层编译输入；SDK 提供 `runTask`、Hub 通信、运行上下文与生命周期协议，
以及生成 Worker 和标准 Bundle 的构建入口。业务库可以复用这些能力，
但其专用 API 和发布组织不由本契约定义。

1. 作者通过包管理器在开发和构建环境引用 SDK。SDK 的版本由作者项目锁定，
   不由运行中的 Engine 为任务选择或安装。
2. Task SDK 提供通用构建和协议实现；业务封装应复用这些能力，
   不复制出另一套 Engine 必须识别的 Bundle 格式或通信协议。
3. 运行库与构建入口分离；根入口不导入或重新导出构建工具，
   构建器、打包器等工具不因引用运行库而进入 Worker 成品。
4. 构建工具校验作者输入并生成 `task.yaml` 及三份 Schema 声明，
   收齐并锁定共享 Schema 的引用闭包，生成启动包装并打包业务回调、运行库及第三方代码，
   并按构建规则选择静态资源，生成覆盖整个成品的精确清单。
   只在完整候选通过校验后替换明确归属工具的旧输出，不叠加残留文件。
   生成代码由工具维护，作者无需手写或手工修改成品 Worker。
5. 构建必须验证依赖闭合；除 Node 内置模块外，不允许留下需要宿主解析的外部模块。
   无法静态封装的动态依赖、原生扩展或外部可执行依赖不能被当成已自包含而静默放行。
6. 完成文件集合与格式验证后，将完整成品目录作为 UnixFS 目录导入 IPFS，取得根 CID
   作为 Bundle 引用，发布环境可附带 gateway hint；不再要求生成 tgz、Git 文件树摘要或独立发布 URL。
   构建离线计算 CID 并输出 CAR，不导入远端节点；成品检查只消费同一份快照，
   不读取作者模块、重新展开 glob、隐式重建或提交 Task。外部工具负责导入及保留。
   仅生成本地目录不代表已经发布或保证远端可获取；
   工具必须区分成品生成、CID 生成与内容保留结果，不伪造发布成功。
7. 不同 Bundle 可以包含不同 SDK 或第三方库版本，只要各自实现其 Schema URL 规定、
   且宿主明确支持的契约。SDK 必须按 YAML 指定的 Schema URL 选择匹配的运行协议来生成 Worker，
   不支持该声明时明确构建失败，不能混用契约或静默改写 Schema URL。
   Engine 不共享这些包的运行实例，也不以 SDK 包版本代替协议兼容性判断。

## 内容身份与引用

Bundle 使用标准 IPFS 根 CID 标识 UnixFS 目录，Request 的 Bundle 引用支持以下多态：

```ts
type BundleReference =
  | string
  | {
      cid: string;
      hint: string | string[];
    };
```

字符串形式直接填写完整根 CID，不是 `ipfs://<root-CID>` URI；
对象形式以 `cid` 填写同一完整根 CID，`hint` 提供一个或多个候选 gateway 基址 URI。
根 CID 是完整 Bundle 的唯一内容身份，不是运行 IPFS 服务的节点地址。
节点、网关和连接方式由可信宿主配置；调用方可提供 hint，但它不是内容身份或可信宿主配置。
不再定义 `{url, digest}`、`URL#digest` 或独立的 Bundle 摘要算法；
新架构不保留这些形式的双轨入口、自动转换或成功回退。

1. Request 必须引用不可变的 UnixFS 目录根，不能用单个文件、压缩包 CID、
   IPNS 名称、DNSLink 或“最新版”别名替代。CID 字段不携带 URI、文件路径、query 或 fragment。
   非法引用形状、无效 CID 或不支持的 IPFS 编码能力明确拒绝，不静默修正请求。
2. CID 的解析、编码、内容判等及 DAG 验证复用 IPFS 标准实现；
   不用 CID 字符串短前缀、展示名称或网关 URL 判等。
   原始 Request 保留填写形式及 hint，幂等仍比较完整原始意图；
   内容复用与类型匹配按解析后的根 CID 判断，二者不混为一套比较规则。
3. 根 CID 固定完整目录及文件字节，包括 `task.yaml`、`worker.cjs`、共享 Schema 和静态资源；
   不因某个文件未被执行读取就排除它。获取不同内容不能更新期望 CID 或代替成功结果。
4. IPFS 内容完整性不证明发布者可信、代码安全或内容始终可获取；
   不引入额外来源授权或执行权限模型，也不将公共 IPFS 当作保密机制。

### Gateway hint

1. `hint` 当前仅表示 gateway 基址 URI 或有序候选 gateway URI 列表，不是任意提示对象，
   不使用 `gatewayHint` 字段，也不将已经拼上 `/ipfs/<CID>` 的内容 URL 作为基址。
   不提供 hint 时使用根 CID 字符串形式；对象形式包含 `cid` 和 `hint`。
   拒绝空字符串、空数组及数组中的空值；候选必须是有效的绝对 HTTP(S) gateway 基址 URI。
   URI 不携带用户名、密码、query 或 fragment；请求不能通过这些位置夹带凭据或替换内容路径。
   Hint 的候选数量与单个 URI 长度上限由可信宿主配置，超限明确拒绝，不截断或丢弃后继续受理。
2. 候选顺序表达获取偏好，不要求从全部 gateway 下载，也不锁定串行、并行或重试算法。
   宿主可利用 hint，也可使用配置的网关或其他 IPFS 节点；hint 不构成必须采用该地址的指令。
3. Hint 是调用方输入，宿主在访问前按可信网络访问策略校验 URI 与目标；
   不能将 hint 当成授权、放宽宿主访问限制或绕过 CID/DAG 验证。
   非法 hint 明确报告请求错误，不能静默将非法引用当作无 hint 的成功输入。
4. 三种引用形式的 CID 相同时，内容身份相同；hint 的有无、形式、值和候选顺序
   不参与缓存身份、共享 preparation 的内容身份或 Run 匹配。
   同一 `requestId` 换引用形式、改变 hint 或候选顺序仍改变原始请求意图，按幂等冲突处理。
5. 内部可解析为 CID 与候选列表供获取层使用，但不能将解析结果回写原始 Request。
   Hint 不保证 gateway 可用、内容留存或获取成功，也不允许改用其他 CID 成功回退。

### 目录导入与内容身份

1. Bundle 使用 IPFS UnixFS 目录模型，不将 tgz 文件作为 Bundle 根。
   CID 由标准 IPFS 导入实现生成，不再计算 Git SHA-256 tree OID 作为平行内容身份。
2. 相同文件树只有在相同导入参数下才保证得到相同根 CID。
   构建与发布工具须固定并公开可复现的导入参数，包括 CID 版本、哈希、分块、DAG 布局
   及元数据处理；具体参数在实施阶段落实，不由宿主环境的可变默认值决定。
3. 文件路径与原始字节保留，不对 YAML、JSON、换行或文本编码做语义归一化，
   不自动收录宿主 mtime、owner 或权限来改变交付身份。
   路径先通过 Bundle 文件集合校验，不能以静默重命名或改写内容使非法文件集合通过。
4. CID 是标准 DAG 内容身份，不等同于文件字节哈希；
   同一逻辑文件树采用不同导入参数得到的不同根 CID，不自动视为同一 Bundle。

### Bundle 内单文件引用

1. 文件通过标准 IPFS 路径 `ipfs://<root-CID>/<relative-path>` 访问，例如
   `ipfs://<root-CID>/resources/config.json`，无需先下载并解压整个 Bundle。
   路径解析及 URI 编码遵循 IPFS 标准，目标仍须位于已引用的 Bundle 根内。
2. 根 CID 加路径表达“该版本 Bundle 中的文件”；文件自身的 CID 可以标识其内容，
   但不能单独替代所属 Bundle 的身份或证明其目录归属。
3. 读取必须验证从指定根到目标文件的 DAG 链接与文件块；
   普通 HTTP 网关返回文件字节不自动构成已验证的 IPFS 内容。
4. 单文件读取不代表整个 Bundle 已通过装载准入，也不放宽共享 Schema 的离线引用闭包规则。

## Engine 的制品装载职责

### IPFS access 与 Bundle 解释的分层

1. Engine 初始化通过 `ipfsClient` 参数接收可信宿主提供的通用 IPFS 客户端。底层只感知标准 IPFS 内容节点、
   CID、DAG 链接、UnixFS 路径与文件内容，不解释 Task Bundle、`task.yaml` 或 Run。
   这里的内容节点是 CID 标识的 DAG 对象，不等同于提供服务的服务器进程。
2. 底层直接复用官方 HTTP-only Helia 与 UnixFS 的获取、遍历、流式读取及内容验证，
   不另定义 Bundle 专属获取协议，也不将 `openBundle`、Bundle Schema 校验或 Task context
   加入通用 IPFS access。节点连接、gateway 和访问策略由宿主装配。
3. Engine 的装载层将指定根节点解释为 Bundle，判断其目录类型、文件集合、
   声明、Schema、入口及容量；根 CID 的有效性与内容验证通过不等于 Bundle 准入通过。
   Engine 只保留已获取的验证块，不管理持久 pin。默认按需读取资源；
   未读取块可能在准入后获取失败，`bundlePrefetch: true` 可恢复完整预取。
4. Task SDK 将当前 Run 可信绑定的 Bundle 包装为 context 相对路径访问能力，
   不向业务暴露底层 IPFS client、gateway、宿主连接配置或文件位置。
5. 生产初始化需要明确配置 HTTP(S) Gateway，不使用 RPC、delegated routing、libp2p 或公共回退；
   Request hint 只能辅助候选获取，不代替可信初始化配置或绕过宿主访问策略。
   初始化参数名固定为 `ipfsClient`，使用 Engine 导出的 `createIpfsGatewayClient`；
   其只读 block port 也支持显式离线测试夹具，不构成另一套发布协议。

### 独立 IPFS endpoint 与客户端生命周期

1. 目标部署使用本地独立运行的 IPFS 服务 endpoint，不将 IPFS 节点或 blockstore 运行时
   嵌入 Task Engine server 进程，也不将它作为随该进程退出而终止的附属进程。
   部署层独立启动、管理该服务及持久存储，Engine 不负责安装或启动节点。
2. 注入的 `ipfsClient` 是连接该 endpoint 的通用客户端对象，可以存在于 Engine 进程内；
   它与独立 IPFS 服务进程是两个不同对象。读取使用官方 HTTP-only Helia，
   Gateway 必须是无路径前缀的 HTTP(S) 根 URL，重定向被拒绝。
   Request hint 仍只是受宿主策略约束的候选网关。
3. 注入者负责客户端的创建与关闭。Engine 关闭时只取消自己的读取、释放自己取得的内容保护，
   不关闭可能被共享的 `ipfsClient`，不停止独立 IPFS 服务，不撤销其他使用者持有的 pin。
   同 CID 的其他持有者仍存在时，不能以本 Engine 释放为由使其内容失去保护。
4. Engine 进程崩溃不应连带终止 IPFS 服务；已由该服务确认持久化的内容仍按其保留策略管理。
   这不保证在途上传或下载自动完成、续传或零数据丢失：进程内缓冲、未提交上传及网络连接仍可能中断，
   是否恢复由节点能力、持久请求及重新验证决定，不能伪造传输完成。
   本地独立进程也不隔离整机或磁盘故障。

### IPFS 获取、入口装载与资源访问

1. 获取直接消费根 CID 所标识的 UnixFS 目录与文件块，复用 IPFS 的寻址、传输及验证能力；
   不再要求 tar.gz、gzip/tar 解包或另设 Bundle 归档协议。
2. 生产宿主使用明确配置的 Trustless HTTP Gateway，验证 CID、DAG 链接及所消费的块，
   不盲信普通 HTTP 响应，不回退到 RPC 或公共发现。
3. Engine 在准入前验证完整目录清单、文件类型和尺寸、声明、入口与 Schema；
   资源后继块默认按需获取和验证，后续 Gateway 故障可能使 Run 失败。
   显式 `bundlePrefetch: true` 才在准入时验证完整资源字节。
4. 宿主以 Node 支持的装载方式直接启动已验证的自包含 `worker.cjs`，
   不依赖 Node Worker 原生接受 IPFS URI，不新增业务动态加载外部代码的执行模型。
   入口是否落地及资源是否物化为目录是宿主实现选择，不作为业务可依赖的存放位置契约；
   文件内容可以由 IPFS 读取为内存字节或流，不要求先写本地物化文件。
   业务资源统一通过 context 读取，不能要求业务以入口位置或工作目录定位资源。
   如物化本地文件，必须只读使用并拒绝越界、重复或歧义路径、符号链接及特殊文件，
   不覆盖其他 Bundle。
5. 获取、装载与读取受可信宿主容量限制。IPFS 节点或网关不可用、内容缺失、验证失败等错误
   明确报告，不改用其他 CID、不将不完整目录当作成功结果。

### 内存读取与 Worker 启动的实现选择

1. Bundle 资源由标准 IPFS 读取能力取得，经 SDK 统一封装为字节流供 context 访问，
   不要求业务资源先落地。读取须执行容量、取消、完整性及活动内容保护约束，
   流式读取不授权忽略后续块验证或将未完成的内容当作成功。
2. 自包含 `worker.cjs` 可在验证后读入有界内存，再通过 Node 支持的源码启动方式
   创建 Worker，例如 CommonJS 的 `new Worker(source, { eval: true })`。
   这不是让 Node 直接执行 IPFS URI；Worker 构造器也不直接接收 IPFS stream 或 `Uint8Array`。
   源码启动需要完整、有效编码的源码字符串，不能边下载边执行未验证代码。
3. 是否采用源码启动而不写入口文件，属于实施阶段的加载方案，
   需验证生成入口与 SDK 协议、Node 内置依赖、错误栈和诊断定位的行为。
   业务不得依赖物理入口位置；自包含与 context 资源访问不授权动态安装依赖或加载另一份业务代码。
4. 无业务文件物化不等于无磁盘使用：IPFS 节点可在自身 blockstore 保存内容，
   Engine 的持久事实仍遵守数据域契约。流或内存读取不取消准入的目录清单和声明验证，
   也不将未读取的资源块当作已验证或已保留。

### 宿主容量限制

1. 传输字节数、文件树总字节数、单文件大小、文件数量及 DAG 遍历预算等容量上限由可信宿主配置，
   不作为 `task.yaml` 字段；Bundle 和普通 Task Request 不能自行放宽这些限制。
2. 宿主在块获取、DAG 遍历、文件重建和文件集合校验过程中执行相应限制，不等到完整物化后才检查。
   超限明确拒绝装载，不能截断、丢弃文件后将剩余内容当成有效 Bundle。
3. 不同宿主可以配置不同上限。满足格式契约不保证任意宿主都会接受；
   容量策略不改变 Bundle 根 CID、声明格式或通信协议，也不能放宽路径及完整性规则。
4. 缓存命中仍须满足当前宿主适用的容量策略，不能绕过限制。

### 装载边界

1. Engine 不要求显式注册 Bundle，也不以预注册类型目录作为提交前提。
   每个 Request 携带根 CID 字符串或 `{cid, hint}` 引用；Engine 按需获取、校验、缓存和装载，
   不再要求各业务类型各自提供可执行制品获取框架。
   Engine 不提供 `discoverTypes` 或类型目录，Bundle 的查找由调用方或外部目录负责；
   本地缓存只记录已获取内容，不作为类型枚举结果。
2. 宿主配置 IPFS 获取、DAG 遍历、物化和文件集合的容量限制，Request 不能自行放宽这些限制。
   这些配置不构成 Bundle 预注册要求；本契约不另引入来源授权或执行权限模型。
3. 装载必须验证完整内容与声明契约。IPFS 获取、DAG 验证、物化、入口、Schema 或运行要求
   验证失败时明确报告提交错误，不创建 Task，也不启动业务执行。
   新 Request 必须先获取并验证 Bundle，再按其中的 Input Schema 校验输入，
   全部准入检查通过后才创建 Task，遵守[受理契约](./request-admission.md)。
   提交不必同步等待下载完成，可以返回 preparing 和该 Request 的 tracking token；
   类型制品获取不属于 Run 内的业务准备阶段。
4. Request 的根 CID 固定具体 Bundle 内容。提交使用的输入契约，必须与实际执行入口
   来自同一份已验证内容；不能在运行时解析移动别名并静默换用其他内容。
5. Run 和持久事实须能追溯实际使用的 Bundle 根 CID，不以节点或网关地址代替精确内容身份。
   恢复只读取原 CID，不用其他 Bundle 解释或执行旧记录。
6. 本职责限于 TaskType 可执行制品的装载，不接管任意业务数据下载、
   业务资源池、业务缓存或业务制品的生命周期。

### 共享 preparation 与 Request 跟踪

1. 同一 Bundle 的获取和验证可以被多个 Request 共享；preparation 不是 Task 或 Run。
2. tracking token 直接使用 `requestId`，不额外生成标识，一一对应 Request，不对应共享 preparation。
   token 关联的记录保留各自原始输入与处理上下文，用于准备完成后独立校验并创建相应 Task，
   或记录该请求的提交失败。
3. 返回 preparing 前必须持久化请求和跟踪依据；Engine 重启后恢复 preparation，
   各 Request 继续使用原 token 跟踪自身处理结果。
4. Bundle 准备成功不代表所有等待 Request 均受理成功，也不决定它们未来是否共享 Run。
   共享不绕过单个请求的校验。
5. 提交的三种结果、token 查询与 long poll 语义见[受理契约](./request-admission.md)，
   恢复要求见[持久化契约](./persistence-recovery.md)。

### 不同内容的并存

1. 不同 Request 可以引用不同根 CID 的 Bundle 并存运行，包括展示名相同、
   业务上被视为新旧版本的 Bundle，不需要先注册这些版本。
2. 调用方以完整根 CID 明确选择内容；Engine 不根据展示名推断版本分组、
   “最新版本”或替换关系，不引入每个名称只能有一个当前版本的限制。
3. 获取或缓存新 Bundle 不自动覆盖或删除旧 Bundle，也不改写已有 Task/Run 的内容绑定。
   缓存只用于复用内容，不代表注册或当前版本选择。

### 受理前 preparation 与 Task 时间

1. 受理前 Bundle preparation 不配置整体等待预算或截止时间。
   网络慢、准备耗时长或 Engine 停机时间都不构成整体等待超时；重启后继续恢复处理。
2. 获取与验证发生时 Task 尚未创建，不具有 Task 的 eligible 或 timeout 状态；
   这段等待不消耗 Task 超时预算，也不作为 Run 的执行时长。
3. 明确的获取或校验错误仍报告提交失败，不创建 Task，不记录 Task 超时或 Run 失败。
   无整体等待时限不表示忽略错误或无限重试，也不取消宿主配置的字节数、文件数等容量限制。
   long poll 单次观察等待到期不终止 preparation。
4. `receivedAt` 在完成校验并受理、创建 Task 时确定，不取请求到达或下载开始的时间。
   实际生效时间不早于该创建时间，允许创建时立即生效；
   `deadlineAt = effectiveEligibleAt + timeoutMs`，遵守[Task 时间契约](./task-lifecycle.md)。
5. 请求指定的未来生效时间若在下载期间已经过去，按实际创建时间确定生效下界，
   不回溯生效，也不将已耗费的下载时间扣入 Task 预算。
6. Request ID 的可受理窗口在请求到达时判断；通过后，本次请求在 preparation 期间保留窗口资格，
   不因下载完成时 ID 已过期而拒绝。后续新到达的重试独立检查窗口，
   不继承先前请求资格；具体规则见[Request 受理与幂等处理](./request-admission.md)。
7. 完整 Request 提交给 Engine 是一次性的单向处理通知，不依赖调用方持续等待或维持连接。
   Engine 按准入规则进行获取、校验和受理；调用方停止等待不改变处理。
   未观察到结果不表示未创建 Task，后续重试仍按窗口及幂等规则处理。

## 内容缓存

1. 内容寻址与块复用使用 IPFS 标准能力，不要求 Engine 再维护一套 Bundle 内容分发缓存。
   宿主配置独立本地 IPFS 服务，由节点承担块缓存、pin 与垃圾回收；
   gateway 是读取入口，不单独构成缓存或保留保证。
   Engine 仍负责目录、精确清单、声明、Schema、路径及尺寸准入、入口装载和 context 读取。
   默认不预取资源的全部后继块，因此 accepted 不是完整 DAG 可用证明。
   装载结果及活动内容保护在 Engine 内部按根 CID 复用，不维护额外的 Bundle 文件缓存目录。
   内存复用不作为公开缓存管理 API，不提供缓存列表、详情、驱逐接口或对应 Web UI；
   IPFS 节点的内容管理不属于 Engine 的公共职责。
   不再另建以 URL 和自定义 Digest 为键的寻址体系，节点或网关更换不改变内容身份。
2. 内容复用不等于 Request 已受理。缓存命中仍须满足宿主容量限制，
   并按各请求的 Input 完成校验，不能将其他请求的受理结果当作当前请求的结果。
3. 缓存命中复用已验证的块，不需要为判断“最新版本”重新访问网络；
   默认按需模式的未读取块仍需要配置的 Gateway，后续网络故障可使 Run 明确失败。
   缓存缺失或内容损坏时，重新获取仍须满足原期望根 CID。
4. 根 CID 可解析不等于其所有后继块均已保留或可获取。
   只有显式完整预取成功才保证该 Engine 内存中保留完整文件内容；按需模式不作此承诺。
5. 缓存淘汰与传输重试不改变 Bundle 身份，不触发任务重跑，
   也不改变已有 Task 与 Run 的匹配或终结事实。

### 历史 Bundle 内容保留

1. 对历史 Bundle，持久记录保留原多态引用（包括原 hint，如有）与根 CID，
   不要求随历史永久保存完整 Bundle 内容，
   也不要求永久递归 pin 所有历史 Bundle。
   这不减少 Request、Task、Run 自身应保存的结果与历史事实。
2. 仅被历史记录引用的 Bundle 内容可按宿主缓存策略淘汰，
   不必等待最后一个历史引用删除；淘汰不能破坏正在使用该内容的 preparation 或执行。
3. 后续操作确实需要原 Bundle 内容时，先查内容缓存，缺失则按保存的根 CID 重新获取并验证，
   不绑定原节点或网关。不能用其他 CID 的内容替代，也不能改写历史引用。
4. 无可用提供者、块缺失、获取失败或 CID 验证失败时，需要该内容的操作明确失败。
   保留引用不承诺历史 Bundle 永久可获取；不能伪造内容获取成功、重跑任务或删除历史来掩盖缺失。
5. 不依赖 Bundle 内容的持久事实查询不因缓存被淘汰而失效。
   重新获取内容是读取所需制品，不是重新提交原 Request 或执行旧 Run。
6. Pin、副本与垃圾回收策略由可信宿主或发布环境负责；保留 CID 本身不是内容保留保证。
   已读取验证块在活动 preparation 和执行期间受 Engine 内部租约保护，
   未读取资源的持久可用性仍由外部保留策略负责；
   不因历史缓存淘汰而破坏活动工作，也不扩展为 Engine 管理任意 IPFS 资产的产品。

## 自包含与运行依赖

1. 作者可以在开发和构建期间引用公共库或第三方包；交付的 Worker 必须将所需代码封装进 Bundle，
   不声明需要消费宿主安装或解析的外部包依赖。
2. 消费端不运行包安装、构建脚本或包生命周期钩子，不借用宿主的 `node_modules`
   或其他 TaskType 的依赖实例。
3. Node.js 是执行运行时，Bundle 声明所需 Node 版本；不满足要求时明确拒绝装载。
   运行时包依赖闭合不代表任意 Node 版本都可执行。
4. Worker 与 Engine 之间仍有由 Schema URL 唯一确定的通信协议兼容要求；
   自包含不取消协议校验，也不要求宿主安装与 Bundle 相同版本的公共运行库。
5. 自包含不表示没有文件、网络、子进程或其他外部资源需求；
   这些资源的释放仍须满足 Run 生命周期契约。Worker 隔离不是 OS 安全沙箱。

## 公共运行库边界

`runTask(taskCallback)` 封装 Worker 与 Engine 主线程的通信协议、
运行上下文、取消、消息、进度、checkpoint、独立日志、结果及退出流程，不解释业务结果的领域含义。

1. 具体 Task 源码可以引用上述公共库，构建后各自包含所需实现；
   公共库不是由宿主共享加载的运行时依赖，也不是另一层执行服务。
2. Run 的隔离单位是 Engine 创建的独立 Worker，不是每个 Task 各起一个 Worker：
   多个 Task 仍可按既有匹配契约共享同一 Run。
3. 公共运行库与业务回调在同一个 Run Worker 内执行，
   不为公共封装再创建一层 Worker。
4. 公共运行库负责协议和清理流程，但不能自行宣布 Run 已物理退出。
   结果上报不等于 Run 终结；仍以 Engine 宿主观察到 Worker 退出为正常终结边界。

## 实现阶段待落实事项

核心契约按上文确定。以下是实现阶段需要落实的接口细节与切换方案，
不作为本轮核心契约尚未定稿的问题：

- 受理状态查询的正式方法名与传输编码；立即查询和 long poll 已统一为可选 `waitMs` 的同一操作。
- `buildTaskBundle` 参数与回调 context 成员已有公共类型，见
  [SDK 文档](../../../packages/task-sdk/README.md)与[RunContext 契约](./run-context.md)；
  后续接口演进不得绕过本文的身份、声明与兼容边界。
- Context Bundle 读取的具体 SDK 方法、宿主/Worker 通信与入口装载方式仍待落实；
  统一返回字节流，具体标准流类型仍待落实；资源物化与否不得改变相对路径访问契约，
  也不得取消准入前完整验证。
- Worker 握手与消息编码已有[独立协议文档](../../task-bundle-worker.md)，
  当前协议未冻结，新能力统一在 v1 内原地演进；显式冻结后，不兼容迭代另行定义 Schema URL 边界。
- 既有注册 API、持久事实与消费端的实施迁移方案。
- 独立本地 IPFS endpoint 与客户端实现选择、可复现的 UnixFS 导入参数、
  宿主节点/网关配置与活动内容保护机制；
  新架构直接采用 IPFS 引用，不以兼容旧 URL/Digest/tgz 链路为目标。

并发幂等须保证同一 `requestId` 最多创建一个 Task，并保留在途请求所需凭据，
已由[受理契约](./request-admission.md)规定；具体协调机制属于实现选择，不再作为未决契约。
按已确定的 `$schema` URL 实现并发布机器可读 Schema、落实文件集合与宿主容量校验，
属于待实现工作，不代表这些格式与容量规则尚未决定。
