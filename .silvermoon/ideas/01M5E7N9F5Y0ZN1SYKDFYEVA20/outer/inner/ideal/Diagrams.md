# Coordinator 业务实体关系

本文支撑 [Types.md](./Types.md) 与 [Design.md](./Design.md)，不是独立合同。只保留一张统一实体图，表达上游请求意图与下游执行事实，不按 intention/state 分设两套实体图。视图状态改由 [Views.md](./Views.md) 的表结构、属性来源、SELECT 和更新依赖定义，不再绘制聚合视图图形。

## 分类与阅读约定

| 类别 | 内容 | 含义 |
| --- | --- | --- |
| 业务实体 | ObjectiveRevision、RegulationTarget、RegulationRequest、RegulationRun | 具有独立身份；RegulationRun 是调用，不是请求或 Task |
| 事实记录 | Observation、Fault | 具有发生与来源意义，记录主键仍待确定 |
| 查询视图 | 已确认请求、Target 状态、当前有效观察、活跃集合、实际占用 | 属性来源与 SELECT 明确；可物化，但必须能从基础事实或充分基线重算 |
| 基础决定与业务关系 | 请求确认、证据选择、Probe 顺序、已采用的依赖 | 安装、采纳、撤销与可靠顺序须明确记录，不能只藏在视图中 |
| Coordinator 控制状态 | 已确认资源意图、可信约束、累计预留、生命周期 | 不只是调用记录的汇总；预算不能从已裁剪历史简单求和 |
| 一致快照 | CoordinatorSnapshot | 组合基础状态与视图在同一事件版本下的结果，不是新的业务实体或独立视图图形 |

视图是可重算的查询冗余，不是独立业务事实；选择物化、SQL View 或内存索引是实现问题。查询分页不改变完整逻辑视图。ActiveRegulationRun 与 RegulationRunRecord 是同一 Run 基础状态在不同生命周期的选择，不引入第二套执行身份。当前尚缺少的基础事实契约在 Views.md 单独标注，不将它们伪装成已完成的实体协议。

命名以单个实体的业务含义为准，不强制“父实体 + 子实体”规则：ObjectiveRevision、RegulationTarget、RegulationRequest、RegulationRun、Observation、Fault。ObjectiveRevision 是固定来源与 commit 的定义版本，不是 Coordinator 状态的数字 revision；Observation 展开 ObjectiveObservation 的属性，观察对象不是 Pilot 自身。

图中英文标签与 TS 字段对应，解释使用中文。图源固定为 22px Arial，SVG 可独立放大查看；修改后须重新生成并验证文字边界。ER 关系使用基数符号，不将快照成员或视图依赖画成业务实体关联。

文档直接内嵌已生成的 SVG，不依赖 Markdown 预览器执行 Mermaid。Mermaid 图源保留在下方折叠区，以普通文本展示；图源是唯一编辑入口，修改后须同步生成 SVG。验证须同时覆盖 Mermaid 生成、SVG 文字边界和不加载 Mermaid 脚本的 Markdown 图片预览，不能仅以 CLI 成功代替预览可用性。

## 1. 业务实体关系

[打开实体关系 SVG](./diagrams/regulation-target.svg)

<img src="./diagrams/regulation-target.svg" width="100%" alt="业务实体关系：ObjectiveRevision、Target、Request、Run、Observation 与 Fault">

同一张图包含上游的 RegulationRequest 和下游的 RegulationRun、Observation、Fault，展示实体身份、关联及主要查询属性，不画 coordinatorRevision、快照成员表或当前/历史分组。图的既有文件名保留以兼容旧链接，不再表示只画请求意图。嵌套值展开不意味着新增实体或强制数据库平铺。

<details>
<summary>Mermaid 图源：业务实体关系</summary>

```text
---
config:
  fontFamily: Arial, Helvetica, sans-serif
  themeVariables:
    fontFamily: Arial, Helvetica, sans-serif
    fontSize: 22px
  er:
    minEntityWidth: 280
    entityPadding: 24
    diagramPadding: 24
---
erDiagram
    direction LR
    OBJECTIVE_REVISION ||--o{ REGULATION_TARGET : defines
    REGULATION_TARGET ||--o{ REGULATION_REQUEST : receives
    REGULATION_REQUEST ||--o{ REGULATION_RUN : executes
    REGULATION_RUN ||--o{ OBSERVATION : produces
    REGULATION_TARGET o|--o{ FAULT : target_scope
    REGULATION_REQUEST o|--o{ FAULT : request_scope
    REGULATION_RUN o|--o{ FAULT : run_scope

    OBJECTIVE_REVISION {
        string objectiveKey PK
        string source
        string version "Fixed Git commit"
    }
    REGULATION_TARGET {
        string targetKey PK
        string objectiveKey FK
        Subject subject
    }
    REGULATION_REQUEST {
        number requestSeq PK
        string targetKey FK
        string desiredLevel
        number priority
    }
    REGULATION_RUN {
        string runId PK
        number requestSeq FK
        string bindingId "Actual binding"
        JsonObject bindingConfiguration "Optional snapshot"
    }
    OBSERVATION {
        string runId FK
        LevelRef current "Query current.levelId"
        string observedAt "Actual observation time"
        Problem[] problems "Nested collection"
        string gapSummary
        Record versions "Evidence provenance"
        Record sources "Optional provenance"
    }
    FAULT {
        string kind "Fault classification"
        string message "Occurrence details"
        string targetKey FK "Optional"
        number requestSeq FK "Optional"
        string runId FK "Optional"
    }
```

</details>

- ObjectiveRevision 的 source/version 共同决定 objectiveKey；targetKey 由该 key 与 subject 身份决定。
- requestSeq 单独标识不可变请求。每个 Run 必须且只归属一条 Request；一个 Request 可以尚无调用或涉及多次调用。外部与依赖派生都先形成 Request，不能绕过 Request 直接启动 Run。
- Observation 是成功观察事实，不把 Probe 失败伪装为成功观察。成功观察以 runId 关联来源 RegulationRun，经 Run → Request → Target 推导 RegulationTarget，不重复保存 targetKey；是否需要其他来源另行讨论。
- Fault 为 umbrella 查询展开归属链；三条可选关系不是任意组合：Coordinator 层三个引用全 null，Target 层仅 targetKey，Request 层包含 targetKey/requestSeq，Run 层包含全部引用。必须由确定的父关系展开并校验一致，不用最新请求补齐。kind 表达种类，message 表达详情，不再存 stage 或另加 ownerKind；详见 [Fault 查询约束](./Types.md#fault-分类归属链与-umbrella-查询)。
- Observation/Fault 不虚构主键；图中 FK 表达逻辑来源，历史归档须保留足够的引用证据，不强制永久保留全部在线父行。provider 故障不挂入 consumer 的链条，依赖影响另由关系与转换表达。
- Observation 展开 current、observedAt、problems、gapSummary 以及现有 provenance 字段，不再重复存 value。problems 仍是集合，versions/sources 与新版本模型的适配待定，不为了查询臆造新实体。
- Run 展开 bindingId 与可选配置快照；configuration 保持嵌套，资源意图更新不改写旧 Run。查询路径和独立实体边界的判断见 [属性展开规则](./Types.md#查询属性与值对象展开)。
- Run 的 target 和 desiredLevel 均由固定 requestSeq 对应的 Request 推导，不重复保存，也不直接关联 Target。provider Request 表达 provider 自己的对象与目标，不能借用 consumer Request；旧 Run 不能通过 target 的最新请求解释。
- 请求来源与 consumer 需求归属必须可追溯；共享 provider 的请求形成、复用、优先级和回收规则仍待细化，不要求每次发现依赖都重复创建请求。被 Run 或有效证据引用的请求须保留可解析记录，不能只靠 latestByTarget 映射。

视图状态、来源契约及重算定义统一见 [Views.md](./Views.md)；不再维护原请求、Target、执行和快照组成的四张视图 SVG。
