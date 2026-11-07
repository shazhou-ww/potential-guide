# Probe Task Bundle 的结构与 Objective 描述

本文服务于 [Idea](Idea.md)。这是待实施的业务设计，不是已实现的新 API。
本次按明确要求校准方案：Probe 与 Check 都是 Task 特化，都采用
“业务准备 → 通用 Task 编译”两阶段构建，不保留独立数据 Bundle 编译路线。

## 角色与唯一入口

- Check Task 执行一次 Check；Probe Task 执行一次针对 Objective 的 Probe。
- 两者的唯一运行声明均是 `task.yaml`，唯一 Worker 均是 `worker.cjs`。
- Engine 只理解通用 Task 声明与协议；阶段、逻辑引用、Override 由 Probe 业务实现解释。
- Check 的业务描述位于 `resources/check.json`；
  Probe 中承载的 Objective 描述位于 `resources/objective.json`。
- 作者只维护 `<kind>.probe.build.yaml` 与源文件，不手写另一份运行 `objective.yaml`、
  `task.yaml` 或业务 JSON。准备器和通用编译器分别生成各自负责的产物。

正式区分：Objective 是目标定义，Probe 是动作，交付制品是 Probe Task Bundle。
不要再将同一个可执行制品交替称为 Objective Bundle 或 Objective Task。
`resources/objective.json` 与 `objective.md` 描述业务对象，保留 Objective 命名，
不因动作名称改变而机械改成 probe.json/probe.md。

Probe Bundle 根 CID 绑定 Worker、输入/结果契约、组合规则、文档和全部 Check 内容。
它不再仅表示纯数据规则；更新 Probe 实现同样会得到新的 Probe Bundle CID。
`name` 是展示名，`kind` 是作者定义/业务元数据标记，两者都不替代内容身份。

## 成品结构

```text
probe-task/
├─ task.yaml
├─ worker.cjs
├─ schemas/                         # 通用编译器按契约需要生成
│  └─ …
└─ resources/
   ├─ objective.json                # 组合、阶段和文档业务描述
   ├─ references/
   │  └─ en/
   │     ├─ objective.md
   │     ├─ levels/
   │     │  ├─ prepare-environment.md
   │     │  ├─ prepare-project-tools.md
   │     │  └─ terminal.md
   │     └─ checks/
   │        └─ tools/
   │           ├─ check.md
   │           └─ problems/tool-missing.md
   ├─ assets/                        # 可选的显式附加资源
   │  └─ environment.svg
   └─ checks/
      └─ tools/                     # 原样保留的完整 Check Bundle
         ├─ task.yaml
         ├─ worker.cjs
         ├─ schemas/…
         └─ resources/
            ├─ check.json
            └─ references/en/…
```

使用 `resources/checks/` 而不是根级 `checks/`，保持通用 Task 的资源目录规则。
嵌入的 Worker 是独立子 Bundle 的内容，不是父 Worker 随意 require 的动态模块。
两条逻辑引用可以共享同一个子树；不会因为重复引用而改变 Check 原始 CID。

## 生成的 task.yaml

沿用通用 Task Schema，不向其中加入 `levels`、`references`、publication 或 Check 特殊字段。
以下仅摘录关键字段，不是完整可执行示例；正式产物必须包含完整生成的 `include/binary`，
且所有 Schema 文件均实际收录。Schema 文件编号由通用编译器决定。

```yaml
$schema: https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json
name: Development Environment
runtime:
  type: node
  minVersion: "22.13.0"
entry: worker.cjs
inputSchema:
  $ref: schemas/0.json
resultSchema:
  $ref: schemas/1.json
messageSchema: false
```

- `inputSchema` 来自作者 TypeBox contract 的 `input`，与 Check 一致。
  不再从 Build YAML 另维护一份 `subjectSchema` 或输入 Schema。
- `resultSchema` 由 Probe 契约按生成的语言、阶段和 Check Problem 元数据约束。
- 初版不引入业务消息，contract 的 `message` 为 Never，生成 `messageSchema: false`。
- `include` 是完整根下所有文件的精确清单，包括所有嵌入 Check 文件。
- `binary` 是父根下完整精确资源列表；子 Bundle 的 binary 路径加子树前缀后并入。
  普通自有资源 glob 不能修改子 Bundle 的二进制归属。

根声明只由通用编译器生成。Probe 业务适配器不绕过完整 Task 验证，
不手工覆盖编译结果中的声明、Worker 或 Schema。

## resources/objective.json 候选

以下例子使用现有 tools Check：输入接受 `{checkTimeoutMs,tools}`，
支持 `en`，包含 `tool-missing` 等真实 Problem codes。
Objective 的 `environment` 与 `project` 输入各自是符合该契约的对象。
占位 CID 必须在准备时替换为已验证的精确内容身份。

```json
{
  "kind": "development-environment",
  "languages": ["en"],
  "bundles": {
    "tools": {
      "path": "resources/checks/tools",
      "cid": "<Check-root-CID>"
    }
  },
  "checks": {
    "tools": {
      "bundle": "tools",
      "inputMapping": "environment"
    },
    "project-tools": {
      "bundle": "tools",
      "inputMapping": "project"
    }
  },
  "levels": [
    {"id": "prepare-environment", "checks": ["tools"]},
    {"id": "prepare-project-tools", "checks": ["project-tools"]}
  ],
  "references": {
    "en": {
      "objective": "resources/references/en/objective.md",
      "levels": {
        "prepare-environment": "resources/references/en/levels/prepare-environment.md",
        "prepare-project-tools": "resources/references/en/levels/prepare-project-tools.md",
        "terminal": "resources/references/en/levels/terminal.md"
      },
      "checks": {
        "tools": {
          "check": "resources/references/en/checks/tools/check.md",
          "problems": {
            "tool-missing": "resources/references/en/checks/tools/problems/tool-missing.md"
          }
        }
      }
    }
  }
}
```

| 字段 | 角色与约束 |
| --- | --- |
| `kind` | 与 Check 索引同义的本地业务标记；小写连字符 ID，不用于全局路由。 |
| `languages` | 与 Check 同义的规范 BCP 47 语言集合；非空、唯一，有效文档完整覆盖。 |
| `bundles` | 物理子 Bundle 绑定，每项保存内部路径和准备器解析得到的精确 CID，不保存可变来源。 |
| `checks` | 逻辑调用名到制品绑定与确定性输入映射；允许不同调用共享一个 Bundle。 |
| `levels` | 非空有序目标阶段，每项有唯一业务 `id` 和逻辑 Check 名数组。 |
| `references` | 准备器从目录约定生成的逐语言相对路径索引，包含 Objective/Level 与发现的稀疏 Override，不是作者维护的字段。 |

资源推导只发生在第一阶段。消费者读取这里已固化的索引，不扫描文件来猜测业务结构；
未列入 Override 索引的页面继承原 Check 同语言索引，实际选择规则见
[Probe 与 Reference](Probe-references.md)。无额外资源时省略 assets 目录，
但生成的 include 仍覆盖全部推导出的页面和嵌入内容。

子 CID 可以写入父内容，因为它不是父根的自引用。
这是供独立 Check 调用使用的固化元数据，不是可随意相信的身份声明：
构建后必须证明 `bundles.<name>.path` 的实际子树 CID 等于该值；
消费边界也要验证此绑定，不能只校验 JSON 中字符串格式。
父自己的 CID 不写入这些文件，在 Probe 运行时取 `context.bundle.cid`。

`resources/objective.json` 是生成的唯一业务描述，不再与另一份
`objective.yaml` 同步维护。支持格式由对应业务 SDK/验证器明确识别，
不冒用历史 Objective Schema；业务资源 Schema 的最终标识留待实施定义。

## Level 与逻辑引用

```text
initial（别名）→ prepare-environment → prepare-project-tools → terminal（真实最终状态）
```

- 每个业务 Level 描述当前待完成的目标，标题使用 `Prepare environment` 这类动作表达。
- 业务数组不声明 `initial` 或 `terminal`，两者是保留名。
- `initial` 指向首个业务阶段，没有独立 Checks、文档或实际观测状态。
- `terminal` 是所有目标完成后的真实公共状态，不是最后一个业务阶段的别名；
  无业务 Checks，但必须有其文档。
- 普通 Probe 从首阶段重新验证；阶段内聚合全部 Checks，首个有业务失败的阶段
  就是 `currentLevel`，失败 Check 与它属于同一阶段。
- 全通过则推进；全部阶段通过则返回 `terminal` 和空失败列表。
  空阶段 `checks: []` 无条件推进，不根据历史结果跳过前序条件。
- 不允许未知/未使用逻辑引用、未知/未使用制品绑定或同阶段重复引用；
  同一逻辑引用可在不同阶段出现，结果归属当前实际失败阶段。
- `inputMapping` 以 Objective input 为根，使用有界确定性选择，不执行 IO 或宿主函数。
  映射结果必须满足子 Check 输入契约；非法映射、执行失败和非法输出是调用错误，
  不制造业务 Problem 或虚假的 currentLevel。

例如环境失败报告 `prepare-environment`；环境通过但项目工具失败报告
`prepare-project-tools`；全通过报告 `terminal`。这不同于旧协议的“已达成状态”。

## 完整性与身份

Probe Task Bundle 的 UnixFS 资源目录项真实链接到 Check 子树，完整 CAR 包含所有可达块，
而不只是包含 CID 的 JSON。完整下载后可离线验证与物化成普通目录，无需符号链接。
存储可按块去重；父根 CID 同时绑定代码、Schema、业务定义、Override 与子 Check。

只有子树根验证成功才可按那个 CID 提交独立 Check 执行。
父 Worker 不应直接加载子 `worker.cjs`，也不能用父根 CID 代替子 Check 的执行身份。
子调用的装配、权限、取消、截止时间和错误传播属于 Probe 业务执行边界，
不能假设当前 Task SDK 已有任意嵌套执行 API。

自有文本复用 Task 的 UTF-8/换行规则，binary 保留原字节；
子 Bundle 内容只验证，不重新改写。仅复制文件再上传不自动保证子树 CID 不变，
最终 CAR 必须验证真实子树身份，不能只比较文件内容或根外锁记录。

自包含不包含 Node、外部工具、被检查对象或网络服务。
CID 不证明来源可信、执行授权或持续可用；构建成功也不意味着已发布/pin。

## 实施首步须完成的关键证明

1. 通用构建器如何在完整 include/binary 规则下收录已验证子 Bundle 并保持 CID；
   需要扩展时应扩展通用内容组合能力，不复制第二套 Probe 编译器。
2. Probe 如何通过明确的业务执行装配验证子根并调用独立 Check，
   而不在通用 Engine 中硬编码 Objective。
3. 业务资源 Schema、输入映射 profile、资源预算与迁移边界。
   历史不可变 Objective/Check 制品不自动改成这套语义。

这些是实施验证项，不是本轮已证明存在的能力；
构想可以进入实施，完整交付必须等待这些验证及全部验收项通过。

两阶段作者流程见 [Build YAML](Objective-build.md)，输出见
[Probe 与 Reference](Probe-references.md)，对照依据见 [Check 对齐](Check-alignment.md)。
