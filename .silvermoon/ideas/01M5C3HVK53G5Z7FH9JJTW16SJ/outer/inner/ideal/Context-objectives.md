# 目录上下文目标声明

本文服务于 [Idea](./Idea.md)，记录本轮讨论形成的设计候选，不代表已有 CLI 能力。

从 manifest 文件 ID 切换到目录 ID 的源码影响、协议和迁移验收见 [身份迁移影响](./Identity-impact.md)，属于同一 Idea 的必需范围，不留给未定义的后续工程。

## 声明与发现

唯一约定文件名为 `objectives.yaml`，根目录或任意子目录均可放置。它是目标清单，不是 Agent、凭据、权限或执行配额配置，也不要求存在 package.json 或 pnpm workspace。

上下文默认是调用目录，可显式指定。第一版只读取选定目录的清单，不向上继承、不合并同名入口、不递归执行子目录目标。目录层级不形成目标层级。

同一目录内入口名唯一；不同目录可有同名入口。入口名只用于发现，不是全局 Objective ID。清单可引用本仓库或外部 Pilot 目录，目录内约定 pilot.yaml 作为入口；对外引用完整定义单元，而不是其中一个文件。目录引用须接入现有来源设施，不假设当前文件 URI 已支持新语义。

## 拟议格式

```yaml
schemaVersion: 1
objectives:
  standardize:
    description: 检查并推进当前目录的工程标准化
    pilot: git+https://example.org/rules.git#directory-standard
    inputSchema:
      type: object
      additionalProperties: false
      maxProperties: 0
    subject: |
      {"root": context.directory.absolutePath}
```

`schemaVersion` 是清单协议版本；`description` 用于发现。清单只描述哪些 Objectives 可用及其绑定，不包含 `target` 或默认治理层级；严格 schema 应拒绝这类治理请求字段。不要求在声明中填写 revision；常规使用跟随来源，不把一次解析出的提交写回清单。显式 pin 的便利语法不作为本轮必需能力。

`subject` 必须是 JSONata 表达式字符串，直接使用 YAML 多行标量，不再增加 jsonata 包装层，不同时接受字面量对象或猜测表达式语言。固定数据也由表达式表达，不对任意 JSON 字符串做模板替换。

## 输入类型与 subject 绑定

统一模型为 `bind : Context × Input → Subject`。每个声明显式提供 inputSchema，描述调用输入；Pilot 的 domainSchema 独立描述投影后的 subject。先校验 input，再执行 JSONata，最后校验 subject，不以其中一次校验替代另一次。

Unit 是只有一个合法值的输入类型，本协议以唯一 JSON object `{}` 表示，可用示例中的空对象 schema 描述。Unit 声明可省略调用输入，由 CLI 提供 `{}`；传入非空对象必须拒绝，不能忽略。并非所有字段可选的 object 都是 Unit，也不根据声明作用域推断输入类型。

用户级目标通常可复用、目录级目标通常已完整绑定，但这不是协议限制：用户级也可为 Unit，目录级也可要求版本等输入。例如需要调用者提供 root 的声明可使用：

```yaml
inputSchema:
  type: object
  additionalProperties: false
  required: [root]
  properties:
    root: {type: string, minLength: 1}
subject: |
  {"root": input.root}
```

输入对象分为运行时提供的 `context` 与调用者提供的 `input`。context 提供 repository 的逻辑身份、checkout 的实际身份与根路径、directory 的绝对路径和仓库相对路径；不引入 package 或技术栈概念，不自动收集凭据和环境变量。input 不可覆盖 context。

上下文是可供投影的信息，不是固定 subject。目标可以针对逻辑仓库、某个 checkout、目录、特定提交或服务环境。JSONata 输出必须是符合 Pilot domainSchema 的 JSON object；表达式失败、缺失输入和 schema 失败明确报错，不采用默认成功或静默省略。

Pilot 相对来源以清单目录解析。subject 内路径由表达式和目标协议决定，不隐式重写字符串。repo 身份、checkout 身份与规则版本相互独立；跨设备不能仅凭相同本机路径判断为同一 checkout。

## 目录版本与持续监督

声明关注 Objective 的 Behavior，不把它永久绑定到首次解析的历史版本。对 Git 来源区分三个维度：

- repository、来源 ref 与 folder 标识要跟随的来源；默认 ref 及本地/远程更新策略必须明确，不能依赖偶然的缓存 HEAD。候选默认是远程仓库默认分支、本地来源 checkout 的 HEAD，具体 ref 选择语法在实施阶段对齐现有来源协议。
- 解析出的精确 commit 定位本次不可变快照，用于取回内容和来源追溯。
- Pilot folder 在该快照中的 Git tree OID 标识定义内容版本，不使用单个 manifest 的 blob hash，也不把整个仓库 commit 等同于目录内容版本。

Pilot 自有 manifest、检查脚本、问题说明和资源归入目录边界。修改目录内任一受跟踪内容都改变 tree OID；目录外无关提交不改变该 Pilot 的内容版本。tree OID 不是可供 git checkout 的 commit，缓存和恢复必须同时保存可取回的来源 commit 与目录路径，不可将两者混用。

目录 tree OID 不自动覆盖外部依赖或运行环境。跨目录、跨仓库引用须有独立来源版本证据；目录外代码不能悄悄变化而不进入版本记录。子模块、符号链接或其他不能由目录树直接覆盖其实际执行内容的来源，须明确验证边界或拒绝，不将 tree OID 误称为完整执行环境哈希。

单次观察及其依赖交接使用固定快照和同次 subject/版本证据，不在检查中重新解析可变 HEAD。Supervisor 持续监督时观察来源更新，在明确的绑定更新边界替换 spec/runtime 与相关需求版本、重新观察并计算依赖，旧版本迟到结果不能解除新版本等待；不能按旧规范观察却按新规范解释层级。来源更新失败必须显式暴露，不伪称已跟上最新状态。

仅来源 commit 改变、目录 tree 及实际外部依赖版本不变，不应把 Pilot 自身判为新内容版本；外部依赖变化仍须进入独立更新判断。已完成的观察保留其原始证据，不因后续变化改写历史。

## CLI 发现与运行

建议为 CLI 提供只读目标清单入口，并让 probe/regulate 显式选择本目录声明。例如候选交互为：

```text
pguide objectives list --cwd <directory>
pguide objectives list --scope user
pguide objectives show standardize --scope directory --cwd <directory>
pguide probe --objective standardize --cwd <directory>
pguide regulate --objective standardize --cwd <directory> --target <level> --agent <profile>
```

以上命令拼写在实施阶段确认，关键语义是显式区分目录入口选择与现有 `--pilot` 来源/别名选择，禁止静默改变旧别名含义。未选择目标时可给出发现指导，但不自动选第一个或运行全部。`--objective` 与 `--pilot` 互斥；声明入口的 subject 来自投影，调用 input 与既有直接 subject 参数必须明确区分，不能隐式覆盖。probe 只选择并观察 Objective，不从清单读取治理 target；regulate 的目标层级由本次调用请求决定，Supervisor 的需求层级由消费者或调度请求决定，均独立于可用性声明。

列举仅解析清单，不执行 Pilot 检查、JSONata 外部操作或 Agent。列举和详情展示使用统一 objectives 入口，展示名称、描述、作用域、来源文件、Pilot 目录及 inputSchema，不求值 subject 或要求调用输入齐全，也不为了列举隐式解析远程版本。表达式求值不得提供任意进程、网络或文件读写能力，并应有预算。选择后的统一绑定结果交给现有 probe/regulate，不另建执行引擎；probe 只观察，regulate 仍遵循 Agent 授权。恢复使用已记录的来源选择、subject、上下文和观察快照；持续跟随的更新只能在上述绑定边界进行，不能重新发现同名入口而重定向旧运行。

清单来源 revision 与内容证据也须可追溯。观察 Pilot 的不可变快照不要求目标工作树干净：对未提交清单的显式本地使用应记录实际内容摘要及绑定，不能把 HEAD 伪报成其来源；声明作为可信依赖来源时如何绑定该证据，实施阶段须与现有快照设施一起验证。

## 用户级声明与配置分离

用户级 objectives 从原有运行配置拆出，存放于平台用户配置目录内独立的 objectives.yaml，复用目录级声明格式，不加入 target、Agent、权限或配额。运行配置保留执行设置。用户级与当前目录级声明统一经 pguide objectives 查询和管理，写操作必须明确作用域并原子校验保存；本轮只定义方向，不立即迁移本机配置。

默认查询同时展示用户级和当前目录级条目并保留来源；这不是父目录继承。跨作用域同名条目不静默覆盖或合并，裸名选择存在歧义时明确失败并指导显式选择作用域；具体选择参数在实施阶段统一。发现不能自动选取或执行目标。

用户级文件存储位置不是其目标目录。其 JSONata context 使用本次选定的调用上下文，用户配置文件所在目录不伪装成 checkout。相对 Pilot 来源仍以声明文件所在目录解析；缺少表达式需要的 repo/checkout 上下文时明确失败，不补虚假身份。

现有 config objectives 是名称到路径或 Git URI 的来源别名，没有 inputSchema 或 subject 投影。查询入口可以统一，但不能将旧别名悄悄解释为完整声明。迁移应明确识别旧条目、补齐目录来源、输入类型和绑定意图并校验；不自动猜测 subject，不用 pin 历史提交代替迁移意图，也不丢失已有注册。迁移及旧命令退役方案、直接 --pilot 别名调用的处理须在实施阶段显式设计和测试，不提供两个长期并行、优先级不明的权威注册表。迁移前旧查询必须准确标示其来源别名语义。

## 与依赖问题协议的关系

复用 [objective-dependency-problems](../../../../01M5BWMX4SCY4S3PBY8T44N5BG/outer/inner/ideal/Idea.md) 及其 [依赖模型](../../../../01M5BWMX4SCY4S3PBY8T44N5BG/outer/inner/ideal/Dependency-design.md)。该协议提供依赖观察和 Supervisor 交接；本 Idea 补充发现、输入绑定、目录内容版本和持续跟随边界。目录 URI 与 tree 内容版本不同于原 manifest URI + commit 模型，需贯通来源、版本证据、冲突检测和恢复，不是只删去 URI 中的文件名。

具体 monorepo 标准化 Pilot 可以按 workspace 发现各包，解析各目录 standardize 并观察：缺少必需声明属于当前目标的 internal problem；消费者检查决定所需 expectedLevelId，可信观察确认未达标才生成 dependency problem，不从目录清单读取阈值；调用失败仍走错误路径。检查聚合全部未满足依赖，Regulator 交接且不调用当前 Agent，Supervisor 按调度策略推进后重新观察消费者。串行是调度策略，不把执行步骤写进清单，也不在 check 内启动 regulation。

实例仍以规范化 Objective ID + canonical subject 标识，新的来源规范化以 Pilot 目录为单位；同一绑定周期内相同身份的冲突内容版本明确失败，跨周期更新按显式需求更新处理，不能混成一次冲突或永久禁止更新。针对具体 checkout 的目标必须在 subject 中区分工作区；不需要 checkout 的目标不被强制加入该维度。交接使用同次绑定的 subject 和版本证据，不重新发现可变 HEAD。

## 排除与迁移边界

不在本轮实现软件、发布包、改造现有 monorepo 契约或迁移已有 Objective 定义。后续可用本机制承载标准化、发布准备等目标；真正发布仍需独立定义与授权。用户级注册与目录级声明的统一不得改变治理授权边界。
