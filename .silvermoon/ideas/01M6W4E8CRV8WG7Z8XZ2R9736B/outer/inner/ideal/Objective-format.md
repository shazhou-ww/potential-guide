# Objective 描述结构与成品 YAML

本文服务于 [Idea](Idea.md)，记录本轮已确定的外部行为与格式候选，
不是已实现的运行协议或已发布 Schema。字段布局是待实施验证的候选；
不得使用现有历史 Schema URI 来宣称该候选合法。

## 设计定位

Objective 是不可变、声明式的目标组合，包含：

1. 被检查对象的 `subjectSchema`。
2. 有序目标阶段及各阶段完成所需通过的逻辑 Check 引用。
3. 原样嵌入的完整 Check Bundle、确定性输入映射及文档。

整个 UnixFS 文件树的根 CID 是 Objective 内容身份。成品不需要 npm 包身份、
版本范围、安装脚本、JavaScript 入口或 consumer-side build。
作者包可以是普通 workspace/npm 作者工程，但这些属性不进入 Objective 的执行身份。
Objective 是业务数据 Bundle，不是普通 Task Bundle；解释和 Probe 属于业务层，
通用 Engine 只执行选定的 Check Bundle，不解释 Objective。

## 成品文件树

```text
objective/
├─ objective.yaml
├─ schemas/
│  └─ subject.json
├─ references/
│  ├─ zh-CN/
│  │  ├─ objective.md
│  │  ├─ levels/
│  │  │  ├─ prepare-environment.md
│  │  │  ├─ verify-project.md
│  │  │  └─ terminal.md
│  │  └─ checks/
│  │     └─ tools/
│  │        ├─ check.md
│  │        └─ problems/
│  │           └─ missing.md
│  └─ assets/
│     └─ environment.svg
└─ checks/
   ├─ environment/
   │  ├─ task.yaml
   │  ├─ worker.cjs
   │  └─ resources/
   │     ├─ check.json
   │     └─ references/…
   └─ project/
      ├─ task.yaml
      ├─ worker.cjs
      └─ resources/…
```

`schemas/` 可选，输入 Schema 也可以内联。Check 内部仍允许其 Task 格式支持的
`schemas/` 和其他资源；上图只展示代表性结构。
Check 子目录保留其完整文件集和字节，不是重新改写或重新编译后的 Worker。
`references/checks/tools` 的 `tools` 是逻辑引用名，不是物理 Bundle 名。

## 成品 objective.yaml 候选

以下例子假设 Check 输入接受对应的 `kind`，实际构建必须按真实输入契约验证。
`$schema` 中的占位 URI 必须在实现时替换为新格式的正式 URI。

```yaml
$schema: <new-objective-schema-uri>
name: Development Environment
subjectSchema:
  $ref: schemas/subject.json
languages: [zh-CN]

checks:
  tools:
    bundle: checks/environment
    inputMapping: '{"root": root, "kind": "tools"}'
  network:
    bundle: checks/environment
    inputMapping: '{"root": root, "kind": "network"}'
  project:
    bundle: checks/project
    inputMapping: '{"root": root}'

levels:
  - id: prepare-environment
    checks: [tools, network]
  - id: verify-project
    checks: [project]

references:
  zh-CN:
    objective: references/zh-CN/objective.md
    levels:
      prepare-environment: references/zh-CN/levels/prepare-environment.md
      verify-project: references/zh-CN/levels/verify-project.md
      terminal: references/zh-CN/levels/terminal.md
    checks:
      tools:
        check: references/zh-CN/checks/tools/check.md
        problems:
          missing: references/zh-CN/checks/tools/problems/missing.md
```

### 字段与绑定

| 字段 | 候选约束 |
| --- | --- |
| `$schema` | 新 Objective 格式的协议选择；不能沿用历史达成状态模型的 URI。 |
| `name` | 非空展示名称，不是稳定全局身份；身份由根 CID 给出。 |
| `subjectSchema` | 对象输入契约；内联或引用根内收录的 Schema，不在装载时获取远程 Schema。 |
| `languages` | 非空、无重复、规范 BCP 47 标签；有效文档必须完整覆盖所有声明语言。 |
| `checks` | 逻辑引用名到 `{bundle,inputMapping}`；允许多个引用使用同一物理 Bundle。 |
| `levels` | 非空有序业务阶段；每项声明唯一 `id` 与该阶段的逻辑 Check 引用数组。 |
| `references` | 语言到页面映射；Objective/所有阶段/terminal 必需，Check/Problem Override 可稀疏声明。 |

业务 ID 与展示标题分离：`prepare-environment` 是机器 ID，Reference frontmatter 的
`title: Prepare environment` 或本地化标题表达目标。不存在隐式的全局 Objective ID 查找渠道。

每个逻辑引用必须被阶段使用。阶段不得引用未知逻辑名，同一阶段不重复引用同一逻辑名；
同一引用可在不同阶段使用，Probe 的归属是当前实际失败阶段。
`checks: {}` 与阶段 `checks: []` 可以表达无业务检查，空阶段无条件推进。

`inputMapping` 只根据 Objective subject 进行有界、确定性选择，不能执行 IO、读取环境、
动态加载代码或解析发布入口。优先复用现有可移植 bounded JSONata selection profile，
不因此新增宿主函数；映射结果须为满足对应 Check 输入 Schema 的对象。
只有实际 subject 可确定的错误在 Probe 时显式失败，不能当作普通业务 Problem。

## Level 是待完成目标，不是已达成状态

```text
initial（别名）→ prepare-environment → verify-project → terminal（真实最终状态）
```

- `levels` 只声明业务目标阶段，`initial` 和 `terminal` 保留，不能作为业务 ID。
- `initial` 指向首个业务阶段，没有自己的 Checks、文档或独立观测状态。
- `terminal` 是所有阶段完成后的公共真实状态，不是最后一个业务阶段的别名。
  它由协议提供，不在业务阶段数组中另加一个空阶段，但需要显式文档映射。
- 每个业务阶段的 Checks 是完成该阶段目标的条件。全部通过才推进下一阶段。
- 普通 Probe 从首阶段重新验证，停在首个存在业务失败的阶段；
  输出实际阶段 ID 和该阶段失败检查项。所有阶段通过时输出 `terminal`。
- 曾经完成某阶段不保证现在仍完成；不能根据历史观测跳过前序条件。
- 执行失败、映射失败或非法结果是 Probe 调用失败，不伪造阶段或业务问题。

例如，环境尚未 Ready 时输出 `prepare-environment`；环境通过但项目失败时输出
`verify-project`；都通过时输出 `terminal`。这里输出的是“还要做什么”，不是“已达到哪里”。

## UnixFS 身份与自包含

```text
Objective 根 CID
├─ objective.yaml 内容节点
├─ schemas 子树
├─ references 子树
└─ checks 目录节点
   ├─ environment → 原 Check 根 CID
   └─ project     → 原 Check 根 CID
```

目录项是真实 UnixFS DAG 链接，不是 YAML 中 CID 字符串所模拟的业务边。
构建时可链接现成的 Check 根；完整 CAR 必须包含整个根的可达闭包。
物化后是普通目录，不是符号链接；闭包验证后可离线读取与物化。
共享 Check 可以共享底层块，不需要复制逻辑引用所对应的物理目录。

成品声明以内部路径引用 Check，不需要再次保存同一条边的 CID；
装载器从已验证的子树取得 Check 根 CID，作为独立验证、执行与证据身份。
以 Check 子树作为独立 Bundle 提交 Engine，不能把 Objective 根冒充 Check 执行身份。
直接链接原 Check 根应保持其 CID，修改文件、重设 UnixFS 布局或添加外层目录都不是身份保持。

Objective 自己的 CID 不写入自己的成品文件；完整文档 URI 在装载/Probe 时使用
已验证根和相对路径生成。CAR 块序和容器字节哈希不是第二种 Objective 内容身份。

所有 Schema、Reference、资源和 Check 均位于根内；不存在运行时外部代码来源解析。
路径必须精确、可移植、无越界、符号链接或特殊文件。验证应拒绝缺失、意外文件和错误引用，
但如何声明完整文件集不得直接照搬 Task Bundle 并破坏嵌入 Check 的独立清单。

自包含不包含 Node、Check 所需外部工具、实际被检查目录或网络服务。
CID 证明内容身份，不证明执行授权、来源可信、环境相同或持续可用。

## 明确留待实现细化的事项

- 正式 Schema URI、成品完整文件集/二进制资源清单的表示和资源预算。
- Schema 支持范围与输入映射复用 API 的具体接线。
- 独立目标调节/Regulator 的 target 语义，不从本次 Probe 定义推导隐式兼容。
- 历史格式识别与显式迁移方案；不得覆盖历史不可变 Schema 或已发布 Bundle。

作者来源选择见 [Build YAML](Objective-build.md)，结果与文档规则见
[Probe 与 Reference](Probe-references.md)。
