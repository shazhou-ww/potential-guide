# Task Bundle 作者流程与调整边界

本文件服务于 [Idea](Idea.md)。这是下一轮改造候选，不表示现有实现已支持以下格式。
当前核对基线为 `6b5893ce80cdb0c3189a2ffdfb6abec1134e3aa2`。
用户已选择尝试 TypeBox；具体发行包、版本及受支持能力须在实施时验证，不凭库名承诺全部特性可用。

## 作者输入与成品分离

作者维护构建描述、Schema/类型模块和业务回调，而不再手写第二份运行声明：

```text
task.build.yaml
src/
  contract.ts
  main.ts
assets/
dist/
  task.yaml
  worker.cjs
  schemas/
  resources/
```

`schemas/`、`resources/` 仍按实际需要产生。以下仅示意构建描述职责，
完整字段、Schema URL、导出约定及路径映射规则在实现前明确：

```yaml
name: 仓库检查
runtime:
  minVersion: "22.13.0"
source:
  entry: src/main.ts
  contract: src/contract.ts
include:
  - from: assets/**/*.json
    to: resources/
outDirectory: dist
```

- 构建描述包含元信息、源码入口、Schema 模块、选择规则和输出位置；不是 Engine 运行契约。
- `task.yaml` 是成品，由元信息、生成的三份业务 Schema 和实际文件集合生成。
  继续提供 Engine 必需的 `$schema`、name、runtime、worker 入口和运行契约，
  不把作者源码路径、通配符或构建配置带成 Engine 执行能力。
- `include` 的作者规则可用通配符，最终发布清单只含精确、相对于成品根的文件路径。
  清单覆盖整个成品，不仅 resources，还包括声明、生成 Worker、共享 Schema 等必需文件。
- 成品清单可列出 `task.yaml` 自身；不把整个 Bundle CID 写入自身，避免内容身份自引用。
- 成品仍是标准 IPFS UnixFS 目录根 CID 身份，不恢复 tar.gz、自定义 Bundle Digest 或类型注册。

## TypeBox 与单一运行契约

- 作者用 TypeBox 声明 input/result/message Schema，TypeScript 类型从相同定义推导，
  业务回调无需重复手写另一套输入/结果类型。
- 构建只输出 Engine 支持的 JSON Schema 契约；依旧要求 input 根为对象，
  不接收业务消息可明确表达为 Never/false。
- 代码 Schema 模块只在可信作者构建阶段加载；发布成品和 Engine 装载不执行作者的 Schema 模块。
  构建可能执行作者代码，不能宣称为只读安全沙箱。
- TypeBox 用于作者阶段，业务回调使用纯类型导入时不应仅因定义 Schema 就将作者库带入 Worker。
  生成 JSON Schema 与 Worker 使用的运行验证必须来自同一构建。
- 不支持的 TypeBox 类型、扩展关键字或无法等价表达的行为应构建失败，
  不降级为 `{}`、丢失约束或运行另一套校验。
  特别验证额外属性、可选字段、联合、引用与数组语义；不得静默剥离合法额外输入字段。
- 共享 Schema 的完整闭包、内容固定、冲突 `$id` 及片段解析仍须满足
  [当前 Bundle 契约][bundle]。TypeBox 作者体验不能让 Engine 在线补 Schema。
- 实施应提供类型编译测试与 JSON Schema 实际验证的正反例，证明类型与运行契约没有漂移。
  不需要同时支持 Zod/Valibot 等多套作者 DSL。

## 三条命令与副作用

新增 `@potential-guide/pguide-task-bundle` 扩展，公开 `pguide-task-bundle` executable，
通过已有 [pguide 发现协议][pguide]支持 `pguide task-bundle`，也可独立调用。
不另起一套 CLI 发现、输出或配置框架。命令分工：

| 命令 | 职责 | 禁止的隐含副作用 |
| --- | --- | --- |
| `check` | 明确区分作者输入与成品目标，校验声明、路径、Schema 和文件集合并返回诊断 | 不改源码/清单，不写 dist，不发布，不执行 Task；若校验作者模块需求值，须明确这一构建代码边界 |
| `build` | 读取构建描述及 TypeBox 模块，打包 Worker、收集文件，生成已校验的完整 dist 和 CID | 不发布，不启动 Engine，不自动修改作者定义 |
| `publish` | 仅校验指定成品目录，创建 IPFS client，导入并 pin，确认实际 CID 与本地计算一致 | 不读取源码、重新展开 glob、隐式构建、修改清单或提交 Task |

不提供独立 `include` 子命令；清单由 build 生成。
发布配置应复用 pguide 配置基础设施；RPC 的准确配置键、优先级与输出字段在实现时核对，
不写死开发机路径或另建一套隐藏全局配置。
发布成功只证明目标节点已接受并 pin，不证明公网可达或具有永久多副本保障。
pin 属于发布方，不让 Engine 接管；CLI 不负责 Kubo 启停或 GC。

## 文件集合与构建可靠性

1. 实现前明确 glob 根、目标目录结构、隐藏文件、空匹配、重叠选择和冲突处理规则；
   不靠文件遍历顺序决定结果。源码目录与成品目录不能混为发布根。
2. 输出必须是独立的干净成品。新构建不与旧 dist 叠加，删除的源资源不残留；
   校验成功后才替换本次构建管理的输出，失败不能留下可误认为完成的半成品。
3. 防止输出目录被 glob 再次选入；拒绝越界、链接、特殊文件和歧义路径。
   替换输出只针对明确归属本次工具的目录，不递归清理仓库根或未知用户目录。
4. 发布验证精确清单与实际文件集合一致，遗漏和额外文件均失败，
   不以递归上传整个目录替代白名单。清单自身必须可验证，不仅作为展示信息。
5. 发布前验证及实际读取须使用同一份确定内容；源文件并发变化不能让成功回执对应另一份 CID。
   内容不符明确失败，不悄悄更新清单、报告旧 CID 或混合两次构建。
6. schema/worker/resource 字节及清单参与成品 CID。
   相同确定输入和受控工具版本应可重复产出同一内容；排序变化不制造任意打包顺序差异。

## 现有表面的改造

| 位置 | 当前状态 | 本轮调整方向 |
| --- | --- | --- |
| [Task SDK build][build] | 调用方提供运行 YAML、entry、schemas、resources；同入口重导出 createIpfsClient 并提供 importTaskBundle | 复用已有打包和导入能力，分离纯构建与发布装配；不为便利继续从纯 build 入口暴露 RPC client 创建 |
| [Task SDK 运行库][sdk] | runTask、context 与生成 Worker 协议 | 保持运行能力；接入同一生成 Schema，类型导入不引入作者构建工具 |
| [Bundle 声明][declaration]及 [Axis][bundle] | 作者手写 task.yaml，尚无成品精确 include 清单 | 显式更新为生成声明与可验证文件集合；同步标准 Schema、装载验证及文档，不能仅在 CLI 自说自话 |
| pguide 扩展与设置 | 现有 pguide-command-v1 发现、结构化 help、设置机制 | 新增独立 task-bundle 扩展并复用机制，跟进所需包目录、catalog、分层及打包约束 |
| 示例及消费者 | 作者脚本直接调用 build/import | 提供最小 TypeBox 作者示例、成品发布与独立消费测试；更新直接引用，不改写其他 Idea 历史证据 |

目标是边界清晰而不是机械搬文件。底层 IPFS 代码继续复用通用库；
精确构建/发布库导出划分及旧 API 切换在实施时明确，不凭本候选自动认定已有调用方可删除。
TypeBox 依赖加入共享 catalog，并通过正常依赖工具安装，不在准备阶段安装试验包。

## 统一迁移与兼容性决定

用户已确认本轮采用统一迁移，允许为上述边界进行必要的破坏性变更，
不保留新旧两套构建、发布或 Engine/Bundle 兼容路径。

- 新 Engine/Bundle 契约严格要求精确成品清单；不得将缺失清单解释为递归包含所有文件，
  也不得通过旧格式回退绕过文件集合验证。旧的无清单 Bundle 必须明确拒绝，
  诊断说明需要用新作者流程重新构建并使用新的 Bundle CID。
- 同步更新仓库内直接调用方、示例、声明、机器 Schema、装载验证及相关文档，
  使其共同遵循同一新契约；旧内容身份不原地改写，也不承诺旧 CID 继续可执行。
- 调整或移除 SDK API 前先检索实际导出、直接引用及测试，确认受影响的仓库调用方并完成迁移；
  允许必要的 API 变化，不因统一迁移而假定任何旧 API 无人使用。
  复用通用 SDK/IPFS 底层能力，但不为兼容旧入口重新混合纯构建与 RPC/import/pin 装配。
- 实施验证覆盖旧无清单成品的明确拒绝及重建指引，同时证明迁移后的示例与直接调用方可用；
  不引入双轨兼容层，也不把历史 Idea 的既有证据改写成新契约结果。

## 与服务配置工作的关系

[Server 配置 Idea][server-idea]已在独立会话跟进。用户明确将
`pguide-task-engine` 命令交给该会话处理，服务启动可选择 Web UI；那是同级服务命令的范围，
本 Idea 只承担 `pguide-task-bundle check/build/publish`。
复用 pguide 设置及通用 IPFS client 时协调接口，不并行修改另一 Idea 的状态或替它记录验收。
是否调整服务配置 Idea 的入口和 UI 范围由其会话单独落实，不以这里的描述自动覆盖已提交版本。

## 验证重点与非目标

- 从构建描述和 TypeBox 定义生成声明、精确清单、Worker；移除源资源后重建不残留。
- 构建离线可完成，发布只需 dist，不需源码、TypeBox 模块或作者 node_modules。
- 清单缺失/额外文件、路径冲突、不可表达 Schema、输入类型不一致都有明确失败用例。
- 独立消费只按 CID 获取，通过 Engine 的真实 Worker 执行验证，发布阶段不执行任务。
- CLI 发现、help、既有输出约定、独立 binary 和配置来源可重复验证。

本轮不是运行 daemon、服务配置、Web UI 重构、Check/Probe 专用 DSL 或自动发布流水线；
不执行 npm 发布，不接管用户现有本机服务、全局配置、IPFS 数据目录或 pin。
当前仅准备构想、下游轻量种子及后续会话交接，没有实施或验收证据。

[bundle]: ../../../../../../docs/axis/task-engine-contracts/task-bundle.md
[pguide]: ../../../../../../packages/pguide/README.md
[build]: ../../../../../../packages/pguide-task-bundle/src/build.ts
[sdk]: ../../../../../../packages/task-sdk/src/index.ts
[declaration]: ../../../../../../packages/task-protocol/src/bundle.ts
[server-idea]: ../../../../01M6GRRES5EBHYDP1G9DZEGE8E/outer/inner/ideal/Idea.md
