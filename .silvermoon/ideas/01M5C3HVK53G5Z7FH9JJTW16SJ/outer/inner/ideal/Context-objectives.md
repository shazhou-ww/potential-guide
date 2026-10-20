# 目录上下文目标声明

本文服务于 [Idea](./Idea.md)，记录本轮讨论形成的设计候选，不代表已有 CLI 能力。

## 声明与发现

唯一约定文件名为 `objectives.yaml`，根目录或任意子目录均可放置。它是目标清单，不是 Agent、凭据、权限或执行配额配置，也不要求存在 package.json 或 pnpm workspace。

上下文默认是调用目录，可显式指定。第一版只读取选定目录的清单，不向上继承、不合并同名入口、不递归执行子目录目标。目录层级不形成目标层级。

同一目录内入口名唯一；不同目录可有同名入口。入口名只用于发现，不是全局 Objective ID。清单可引用本仓库或外部 Pilot，引用语法复用现有来源协议，引用的 Pilot revision 必须固定为精确提交。

## 拟议格式

```yaml
schemaVersion: 1
objectives:
  standardize:
    description: 检查并推进当前目录的工程标准化
    pilot: git+https://example.org/rules.git#directory-standard/pilot.yaml
    revision: <完整提交哈希>
    subject:
      jsonata: |
        {"root": context.directory.absolutePath}
```

`schemaVersion` 是清单协议版本；`description` 用于发现。清单只描述哪些 Objectives 可用及其绑定，不包含 `target` 或默认治理层级；严格 schema 应拒绝这类治理请求字段。`subject.jsonata` 统一表示表达式，字面量也在表达式内表达，不对任意 JSON 字符串做模板替换。

输入对象分为运行时提供的 `context` 与调用者提供的 `input`。context 提供 repository 的逻辑身份、checkout 的实际身份与根路径、directory 的绝对路径和仓库相对路径；不引入 package 或技术栈概念，不自动收集凭据和环境变量。input 不可覆盖 context。

上下文是可供投影的信息，不是固定 subject。Pilot 的 domainSchema 定义实际输入；目标可以针对逻辑仓库、某个 checkout、目录、特定提交或服务环境。JSONata 输出必须是符合该 schema 的 JSON object；表达式失败、缺失输入和 schema 失败明确报错，不采用默认成功或静默省略。

Pilot 相对来源以清单目录解析。subject 内路径由表达式和目标协议决定，不隐式重写字符串。repo 身份、checkout 身份与规则版本相互独立；跨设备不能仅凭相同本机路径判断为同一 checkout。

## CLI 发现与运行

建议为 CLI 提供只读目标清单入口，并让 probe/regulate 显式选择本目录声明。例如候选交互为：

```text
pguide objectives list --cwd <directory>
pguide probe --objective standardize --cwd <directory>
pguide regulate --objective standardize --cwd <directory> --target <level> --agent <profile>
```

以上命令拼写在实施阶段确认，关键语义是显式区分目录入口选择与现有 `--pilot` 来源/别名选择，禁止静默改变旧别名含义。未选择目标时可给出发现指导，但不自动选第一个或运行全部。`--objective` 与 `--pilot` 互斥；声明入口的 subject 来自投影，调用输入与既有直接 subject 参数必须明确区分，不能隐式覆盖。probe 只选择并观察 Objective，不从清单读取治理 target；regulate 的目标层级由本次调用请求决定，Supervisor 的需求层级由消费者或调度请求决定，均独立于可用性声明。固定 revision 与调用覆盖冲突必须报错，不能静默换版。

列举仅解析清单，不执行 Pilot 检查、JSONata 外部操作或 Agent。表达式求值不得提供任意进程、网络或文件读写能力，并应有预算。选择后的统一绑定结果交给现有 probe/regulate，不另建执行引擎；probe 只观察，regulate 仍遵循 Agent 授权。恢复必须使用已记录的来源、精确规则版本、subject 和上下文绑定，清单后续变化不得重定向旧运行。

清单来源 revision 与内容证据也须可追溯。Pilot 定义固定版本不要求目标工作树干净：对未提交清单的显式本地使用应记录实际内容摘要及绑定，不能把 HEAD 伪报成其来源；声明作为可信依赖来源时如何绑定该证据，实施阶段须与现有快照设施一起验证。

## 与依赖问题协议的关系

复用 [objective-dependency-problems](../../../../01M5BWMX4SCY4S3PBY8T44N5BG/outer/inner/ideal/Idea.md) 及其 [依赖模型](../../../../01M5BWMX4SCY4S3PBY8T44N5BG/outer/inner/ideal/Dependency-design.md)。该协议提供依赖观察和 Supervisor 交接；本 Idea 补充可发现声明及实例绑定，不修改其核心身份协议。

具体 monorepo 标准化 Pilot 可以按 workspace 发现各包，解析各目录 standardize 并观察：缺少必需声明属于当前目标的 internal problem；消费者检查决定所需 expectedLevelId，可信观察确认未达标才生成 dependency problem，不从目录清单读取阈值；调用失败仍走错误路径。检查聚合全部未满足依赖，Regulator 交接且不调用当前 Agent，Supervisor 按调度策略推进后重新观察消费者。串行是调度策略，不把执行步骤写进清单，也不在 check 内启动 regulation。

实例仍以规范化 Objective ID + canonical subject 标识，相同身份的冲突规范版本明确失败。针对具体 checkout 的目标必须在 subject 中区分工作区；不需要 checkout 的目标不被强制加入该维度。交接使用同次绑定的 subject 和精确来源版本，不重新发现可变 HEAD。

## 排除与迁移边界

不在本轮实现软件、发布包、改造现有 monorepo 契约或迁移已有 Objective 定义。后续可用本机制承载标准化、发布准备等目标；真正发布仍需独立定义与授权。旧 Objective 别名注册表继续只承担来源注册职责，不能与本清单无区别合并。
