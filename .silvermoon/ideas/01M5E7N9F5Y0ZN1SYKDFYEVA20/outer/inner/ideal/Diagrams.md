# Coordinator 业务实体关系

本文支撑 [Types.md](./Types.md) 与 [Design.md](./Design.md)，不是独立合同。只保留一张统一实体图，表达上游请求意图与下游执行事实，不按 intention/state 分设两套实体图。视图状态改由 [Views.md](./Views.md) 的表结构、属性来源、SELECT 和更新依赖定义，不再绘制聚合视图图形。

## 分类与阅读约定

| 类别 | 内容 | 含义 |
| --- | --- | --- |
| 业务实体 | Host、HostBindingRevision、HostResourceRevision、Objective、ObjectiveRevision、RegulationTarget、RegulationRequest、RegulationRun | 固定身份与属性只追加；资源版本的成员关系由 HostResourceBinding 表达 |
| 事实记录 | Observation、Fault | 具有发生与来源意义，记录主键仍待确定 |
| 查询视图 | 最新请求、Target 状态、当前观察、活跃集合、当前资源配置与实际占用 | 可物化，但必须能从不可变事实或充分基线重算；详细定义待统一 |
| 变化事实与业务关系 | Run 生命周期、依赖发现/解除、Probe 开始/结束、配置生效 | 只追加发生事实；不另设请求 acknowledgement 或证据采纳事件 |
| 执行限制 | Run 的 executionLimits | 每次 Run 的固定参数，不是共享总预算或累计预留 |
| 一致快照 | CoordinatorSnapshot | 组合基础状态与视图在同一事件版本下的结果，不是新的业务实体或独立视图图形 |

视图是可重算的查询冗余，不是独立业务事实；选择物化、SQL View 或内存索引是实现问题。查询分页不改变完整逻辑视图。ActiveRegulationRun 与 RegulationRunRecord 是同一 Run 基础状态在不同生命周期的选择，不引入第二套执行身份。当前尚缺少的基础事实契约在 Views.md 单独标注，不将它们伪装成已完成的实体协议。

命名以单个实体的业务含义为准，不强制父实体前缀。Objective 是跨版本的稳定身份，ObjectiveRevision 是其固定 commit 的定义版本，不是 Coordinator 状态的数字 revision；Observation 展开 ObjectiveObservation 的属性，观察对象不是 Pilot 自身。

图中英文标签与 TS 字段对应，解释使用中文。图源固定为 22px Arial，SVG 可独立放大查看；修改后须重新生成并验证文字边界。ER 关系使用基数符号，不将快照成员或视图依赖画成业务实体关联。

文档直接内嵌已生成的 SVG，不依赖 Markdown 预览器执行 Mermaid。Mermaid 图源保留在下方折叠区，以普通文本展示；图源是唯一编辑入口，修改后须同步生成 SVG。验证须同时覆盖 Mermaid 生成、SVG 文字边界和不加载 Mermaid 脚本的 Markdown 图片预览，不能仅以 CLI 成功代替预览可用性。

## 1. 业务实体关系

[打开实体关系 SVG](./diagrams/regulation-target.svg)

<img src="./diagrams/regulation-target.svg" width="100%" alt="业务实体关系：Host、不可变资源与 Binding 版本、Objective、ObjectiveRevision、Target、Request、Run、Observation 与 Fault">

同一张图包含上游的 RegulationRequest 和下游的 RegulationRun、Observation、Fault，展示实体身份、关联及主要查询属性，不画 coordinatorRevision、快照成员表或当前/历史分组。图的既有文件名保留以兼容旧链接，不再表示只画请求意图。嵌套值展开不意味着新增实体或强制数据库平铺。

### Host 归属

Host 是中央观察服务识别的逻辑 worker 身份，对应一个 Coordinator 的运行与状态边界，不等于物理设备、进程、连接或一次启动。同一个 Host 同时至多有一个活动 Coordinator，重启或重连不因此创建新 Host；不为每次进程启动新增 Coordinator 实体。

一台物理设备可以通过虚拟机、容器或不同用户/profile 承载多个 Host，各有独立 Coordinator、状态与资源配置。守护进程应阻止同一系统、同一 profile 内的重复启动；两个独立运行的逻辑 worker 不能因物理设备相同而合并为一个 Host。Host 身份的分配、持久化及克隆环境防冲突协议仍待定义。

- ObjectiveRevision 不归属特定 Host，可被不同 Host 上的治理活动引用；不将 hostId 加入 objectiveKey。
- Host 关联在其上执行的 RegulationRun。图中 hostId 显式表达跨 Host 查询所需的执行归属，由所属 Coordinator 的 Host 确定，不是每次 Run 任意选择的参数；Observation 经 Run 推导执行 Host。
- Host 仅保留固定身份，不原地更新 resourceConfiguration。HostBindingRevision 保存不可变 binding 配置；HostResourceRevision 保存一次完整、生效的资源配置版本，HostResourceBinding 表达该版本包含哪些 binding 及各自 capacity。成员条目随版本一并追加，不独立修改或删除；空成员集合表示没有可用 binding。
- 修改 binding 内容生成新的 HostBindingRevision；仅调整 capacity 则生成新的 HostResourceRevision，复用已有 HostBindingRevision。停用 binding 时，新资源版本不再包含它；旧版本及被 Run 引用的 binding 仍可解析。配置不含明文凭据，实际占用不写入这些记录。
- 图中 Request、Run、Observation 和 Fault 的局部键及引用均处于所属 Host 的 Coordinator 状态范围；跨 Host 存储或查询必须携带 hostId。例如 Request 的跨 Host 身份是 (hostId, requestSeq)，状态版本也按 (hostId, revision) 解释，不能跨 Host 比大小。Host 的重启不能重置同一请求序列的水位。
- 同一 targetKey 可以出现在不同 Host 的状态中，但各自的请求、Probe 状态和执行事实不自动合并；不据此允许同一 Request 在多个 Host 上执行。中央观察服务汇集多个 Host 的状态，不因此成为运行这些 Run 的 Host；连接身份也不是 Host 身份。同步传输、跨 Host 依赖和一致性协议另行收敛。

### Append-only 资源模型与视图边界

图中的实体属性及资源成员记录不可原地修改。HostResourceRevision 的 appliedAtRevision 表示该 Host 内配置完整生效的事件版本，不是待确认状态；同一 Host 的生效顺序必须唯一，完整配置及成员原子可见。版本身份的分配协议、配置 JSON schema 与 capacity 的具体合法值约束仍待收敛。跨 Host 引用保留所属 hostId，资源成员及 Run 引用的 HostBindingRevision 必须属于同一 Host。

当前资源配置、当前可用 bindings/capacity、Run 当前执行阶段、实际占用和剩余容量均属于视图，不在 Host 或配置版本上保存可变指针、enabled 标记或占用计数。配置缩容不会改写已有 Run，也不能把负的容量差当成可用容量。Host 观察需求已记录于 [Views.md](./Views.md#host-观察需求)，包括中央联系状态和时间语义；它不是 Host 业务事件序列的简单投影。[Types.md](./Types.md) 的旧 TS 值草案及其他观察中心的旧查询仍待按 append-only 原则统一。

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
    HOST ||--o{ REGULATION_RUN : hosts
    HOST ||--o{ FAULT : host_scope
    HOST ||--o{ HOST_BINDING_REVISION : owns_binding
    HOST ||--o{ HOST_RESOURCE_REVISION : configures
    HOST_RESOURCE_REVISION ||--o{ HOST_RESOURCE_BINDING : contains
    HOST_BINDING_REVISION ||--o{ HOST_RESOURCE_BINDING : included_in
    HOST_BINDING_REVISION ||--o{ REGULATION_RUN : used_by
    OBJECTIVE ||--o{ OBJECTIVE_REVISION : versions
    OBJECTIVE ||--o{ REGULATION_TARGET : targets
    OBJECTIVE_REVISION ||--o{ REGULATION_REQUEST : adopted_by
    REGULATION_TARGET ||--o{ REGULATION_REQUEST : receives
    REGULATION_REQUEST ||--o{ REGULATION_RUN : executes
    REGULATION_RUN ||--o{ OBSERVATION : produces
    REGULATION_TARGET o|--o{ FAULT : target_scope
    REGULATION_REQUEST o|--o{ FAULT : request_scope
    REGULATION_RUN o|--o{ FAULT : run_scope

    HOST {
        string hostId PK "Logical worker identity"
    }
    HOST_BINDING_REVISION {
        string hostBindingRevisionId PK
        string hostId FK
        string bindingId "Agent binding identity"
        JsonObject configuration "Optional immutable config"
    }
    HOST_RESOURCE_REVISION {
        string resourceRevisionId PK
        string hostId FK
        number appliedAtRevision "Host event order"
    }
    HOST_RESOURCE_BINDING {
        string resourceRevisionId PK,FK
        string hostBindingRevisionId PK,FK
        number capacity "Configured concurrency"
    }
    OBJECTIVE {
        string objectiveKey PK
        string source
    }
    OBJECTIVE_REVISION {
        string objectiveRevisionKey PK
        string objectiveKey FK
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
        string objectiveRevisionKey FK "Fixed adopted revision"
        string desiredLevel
        number priority
    }
    REGULATION_RUN {
        string runId PK
        string hostId FK
        number requestSeq FK
        string hostBindingRevisionId FK "Fixed actual binding"
        JsonObject executionLimits "Immutable per-run limits"
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
        string hostId FK "Required owner Host"
        string kind "Fault classification"
        string message "Occurrence details"
        string targetKey FK "Optional"
        number requestSeq FK "Optional"
        string runId FK "Optional"
    }
```

</details>

- Objective 的规范化 source 决定稳定 objectiveKey；objectiveRevisionKey 由 objectiveKey 与完整 commit 决定，targetKey 由 objectiveKey 与 subject 决定。版本升级不产生新 Target；Request 的 objectiveRevisionKey 必须属于其 Target 引用的 Objective，desiredLevel 按该固定版本解释。Run 经 Request 获得版本，不跟随当前最新版本漂移。
- 最新上线版本由追加的发布/生效事实推导，不在 Objective 上原地改写 latest 指针，不以任意 Git commit 或 Host 到达顺序判断“最新”。新 Request 应采用最新上线版本，旧 Request/Run 保留原引用；离线 Host 如何获知及执行这一规则、旧请求是否被替代仍待定。观察需求见 [Objective 观察需求](./Views.md#objective-观察需求)。
- requestSeq 单独标识不可变请求。每个 Run 必须且只归属一条 Request；一个 Request 可以尚无调用或涉及多次调用。外部与依赖派生都先形成 Request，不能绕过 Request 直接启动 Run。
- Observation 是成功观察事实，不把 Probe 失败伪装为成功观察。成功观察以 runId 关联来源 RegulationRun，经 Run → Request → Target 推导 RegulationTarget，不重复保存 targetKey；是否需要其他来源另行讨论。
- Fault 必填 hostId，为 umbrella 查询展开完整归属链；后三条可选关系不是任意组合：Host/Coordinator 层仅 hostId，Target 层另有 targetKey，Request 层再有 requestSeq，Run 层包含全部引用。hostId 由所属 Coordinator 确定，Request、Run 必须在同一 Host 内，Target 归属引用也按该 Host 状态解释；不从最新请求补齐。中央观察服务自身诊断不挂入被观察 Host 的 Fault。kind 表达种类，message 表达详情；详见 [Fault 查询约束](./Types.md#fault-分类归属链与-umbrella-查询)。
- Observation/Fault 不虚构主键；图中 FK 表达逻辑来源，历史归档须保留足够的引用证据，不强制永久保留全部在线父行。provider 故障不挂入 consumer 的链条，依赖影响另由关系与转换表达。
- Observation 展开 current、observedAt、problems、gapSummary 以及现有 provenance 字段，不再重复存 value。problems 仍是集合，versions/sources 与新版本模型的适配待定，不为了查询臆造新实体。
- Run 以 hostBindingRevisionId 引用实际使用的不可变配置，不再重复保存 bindingId/bindingConfiguration 快照；恢复不能换成最新 binding 版本。executionLimits 保存本次 Run 的固定执行限制，具体结构待定；不引入共享总预算或预算预留实体。执行进度与终结通过追加变化事实表达，后续再定义当前状态视图。
- Run 的 target 和 desiredLevel 均由固定 requestSeq 对应的 Request 推导，不重复保存，也不直接关联 Target。provider Request 表达 provider 自己的对象与目标，不能借用 consumer Request；旧 Run 不能通过 target 的最新请求解释。
- 请求来源与 consumer 需求归属必须可追溯；共享 provider 的请求形成、复用、优先级和回收规则仍待细化，不要求每次发现依赖都重复创建请求。被 Run 或有效证据引用的请求须保留可解析记录，不能只靠 latestByTarget 映射。

视图状态、来源契约及重算定义统一见 [Views.md](./Views.md)；不再维护原请求、Target、执行和快照组成的四张视图 SVG。
