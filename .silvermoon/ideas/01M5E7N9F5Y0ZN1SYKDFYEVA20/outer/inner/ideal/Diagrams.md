# Coordinator 实体与状态视图

本文支撑 [Types.md](./Types.md) 与 [Design.md](./Design.md)，不是独立合同。以一张统一实体图表达上游请求意图与下游执行事实，不按 intention/state 分设两套实体图；其余四张图分别展开请求确认、Target 状态、当前执行和意图与状态的聚合总览。保留业务实体与聚合视图的拆分，不把存储版本归属关系画进业务实体图。

## 分类与阅读约定

| 类别 | 内容 | 含义 |
| --- | --- | --- |
| 业务实体 | ObjectiveRevision、RegulationTarget、RegulationRequest、RegulationRun | 具有独立身份；RegulationRun 是调用，不是请求或 Task |
| 事实记录 | Observation、Fault | 具有发生与来源意义，记录主键仍待确定 |
| 权威聚合或投影 | 已确认请求、Target 状态、当前有效观察 | 由已采纳事实和明确决策维护，不必能从现有实体表随时重算 |
| 派生视图 | 从调用状态选出的活跃集合、实际占用 | 不另设竞争的权威计数；现有 activeRuns 仍是调用状态的当前存放位置 |
| 业务关系 | 当前采用的依赖 | 不是从所有 target 自动推导，安装/撤销须明确记录 |
| Coordinator 控制状态 | 已确认资源意图、可信约束、累计预留、生命周期 | 不只是调用记录的汇总；预算不能从已裁剪历史简单求和 |
| 一致快照 | CoordinatorSnapshot | 聚合以上状态在一个 Coordinator revision 下的一致版本，不是新的业务实体 |

“视图”是语义分类，不等于 UI 查询结果或可丢弃缓存，也不要求新增数据库 View。查询筛选与分页仍产生派生 QueryResult，不改变权威状态。当前 TS 中的 ActiveRegulationRun 与 RegulationRunRecord 是同一 RegulationRun 在不同生命周期阶段的表达，不引入第二套执行身份。

命名以单个实体的业务含义为准，不强制“父实体 + 子实体”规则：ObjectiveRevision、RegulationTarget、RegulationRequest、RegulationRun、Observation、Fault。ObjectiveRevision 是固定来源与 commit 的定义版本，不是 Coordinator 状态的数字 revision；Observation 的值类型称 ObjectiveObservation，观察对象不是 Pilot 自身。

图中英文标签与 TS 字段对应，解释使用中文。全部源固定为 22px Arial，SVG 可独立放大查看；修改后须重新生成并验证文字边界。实线表达关系/组成或明确数据流，虚线表达决策输入、选择条件或派生关系；只有第一张 ER 图使用基数符号。

## 1. 业务实体关系

[打开实体关系 SVG](./diagrams/regulation-target.svg)

同一张图包含上游的 RegulationRequest 和下游的 RegulationRun、Observation、Fault，只画实体身份及关联，不画 coordinatorRevision、快照成员表或当前/历史分组。图的既有文件名保留以兼容旧链接，不再表示只画请求意图。

```mermaid
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
    REGULATION_TARGET ||--o{ REGULATION_RUN : undergoes
    REGULATION_REQUEST o|--o{ REGULATION_RUN : motivates
    REGULATION_RUN ||--o{ OBSERVATION : produces
    REGULATION_RUN o|--o{ FAULT : associated

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
        string targetKey FK
        number requestSeq FK "Optional"
        string desiredLevel "Captured at start"
        AgentBinding binding "Actual binding"
    }
    OBSERVATION {
        string runId FK
        ObjectiveObservation value
    }
    FAULT {
        string runId FK "Optional"
        string stage
        string message
    }
```

- ObjectiveRevision 的 source/version 共同决定 objectiveKey；targetKey 由该 key 与 subject 身份决定。
- requestSeq 单独标识请求。一个请求可以尚无调用或涉及多次调用；派生调用允许无直接外部请求。
- Observation 是成功观察事实，不把 Probe 失败伪装为成功观察。成功观察以 runId 关联来源 RegulationRun，再由该 Run 推导 RegulationTarget，不重复保存 targetKey；是否需要其他来源另行讨论。
- Fault 可以关联调用，也可以来自输入、持久化或恢复。Observation/Fault 不虚构主键；图中 FK 表达逻辑来源，不要求永久保留全部历史父行。
- 图不宣称任意请求都能用于任意 target 的调用；关联的 target 必须按执行协议验证。
- Run 的 target 与 desiredLevel 暂保留为启动事实：当前模型仍允许没有外部请求的派生 provider 调用。若后续确定每个 Run 都引用一条准确表达其目标的不可变 Request（含内部派生请求），再通过 Run → Request → Target 推导并删除冗余；本轮正名不隐式决定内部请求协议。

## 2. 请求与确认视图

[打开请求与确认 SVG](./diagrams/request-state.svg)

```mermaid
---
config:
  fontFamily: Arial, Helvetica, sans-serif
  themeVariables:
    fontFamily: Arial, Helvetica, sans-serif
    fontSize: 22px
  flowchart:
    wrappingWidth: 340
    nodeSpacing: 50
    rankSpacing: 65
    padding: 24
---
flowchart TB
    COMMAND["Valid new Command"]
    subgraph INPUT["Request input state"]
        SEQ["lastRequestSeq<br/>Allocation watermark"]
        REQUEST["RegulationRequest<br/>requestSeq / target / desiredLevel / priority"]
        LATEST["latestByTarget<br/>Latest submitted request per target"]
        SEQ -->|assign next sequence| REQUEST
        REQUEST -->|replace this target entry| LATEST
    end
    COMMAND --> SEQ
    DECISION["Coordinator acceptance decision"]
    ACK["acknowledged.requests.latestByTarget<br/>Confirmed request per target<br/>+ acknowledgedAtRevision"]
    ORDER["Eligible request ordering<br/>priority, then requestSeq"]
    LATEST --> DECISION
    DECISION -->|record accepted request| ACK
    ACK -.->|filter by execution and dependencies| ORDER
```

最新提交和最新确认是两条不同状态线，确认不等于执行或完成。拒绝须明确反馈且不覆盖已确认请求。图未规定命令/事件的原子消息边界。

requestSeq 表达请求身份与接收先后，lastRequestSeq 是分配水位；acknowledgedAtRevision 只表达 Coordinator 何时确认。重复确认或 Probe 更新不刷新请求排序，批量确认也不合并请求身份。最新映射不等于完整请求历史，覆盖条目不修改原请求。

## 3. 单个 Target 状态视图

[打开 Target 状态 SVG](./diagrams/target-state.svg)

```mermaid
---
config:
  fontFamily: Arial, Helvetica, sans-serif
  themeVariables:
    fontFamily: Arial, Helvetica, sans-serif
    fontSize: 22px
  flowchart:
    wrappingWidth: 340
    nodeSpacing: 50
    rankSpacing: 65
    padding: 24
---
flowchart TB
    TARGET["One RegulationTarget"]
    PROBE["Adopted Probe outcome<br/>Actual time, source, observed OR error"]
    SUMMARY["RegulationTargetState<br/>updatedAtRevision<br/>lastProbe: ProbeSummary or null"]
    FACTS["Successful observation records<br/>Known facts, not live reality"]
    VALIDITY["Current use and validity decisions"]
    CURRENT["current.observations<br/>Evidence still needed for this target"]
    TARGET -->|one aggregate per known target| SUMMARY
    PROBE -->|explicit latest-Probe rule| SUMMARY
    PROBE -.->|successful outcome only| FACTS
    FACTS -->|select adopted evidence| CURRENT
    VALIDITY -.->|retain or remove| CURRENT
```

lastProbe 可以为空或失败，不等于“最新成功观察”。当前有效证据也不必等于最近 Probe：最新失败不能被旧成功冒充，但仍有效且有当前用途的旧证据可以按规则保留。

updatedAtRevision 表达聚合最后改变的 Coordinator 版本，recordedAtRevision 表达事实采纳版本，probedAt 表达实际 Probe 时间；三者不互相替代。“最近”的事实顺序不能由晚到消息采纳时间猜测。当前证据选择和对象聚合都需要明确转换规则，不能当成 UI 临时查询。

## 4. 当前执行与依赖视图

[打开当前执行与依赖 SVG](./diagrams/execution-state.svg)

```mermaid
---
config:
  fontFamily: Arial, Helvetica, sans-serif
  themeVariables:
    fontFamily: Arial, Helvetica, sans-serif
    fontSize: 22px
  flowchart:
    wrappingWidth: 340
    nodeSpacing: 50
    rankSpacing: 65
    padding: 24
---
flowchart TB
    CONSUMER["Consumer RegulationTarget"]
    PROVIDER["Provider RegulationTarget"]
    DEP["CurrentDependency<br/>minimumLevel<br/>Only adopted, still-needed edges"]
    ACTIVE["ActiveRegulationRun<br/>running / stopping / unverified<br/>target / requestSeq / actual binding"]
    OCCUPANCY["Actual occupancy<br/>Derived from unconfirmed exits"]
    ENDED["RegulationRunRecord<br/>Same runId<br/>endedAtRevision / outcome"]
    RESOURCE["Acknowledged ResourceAllocation<br/>Desired binding and concurrency"]
    POLICY["Coordinator scheduling / stop policy"]
    CONSUMER -->|consumer| DEP
    DEP -->|provider| PROVIDER
    DEP -.->|constrains scheduling| POLICY
    RESOURCE -.->|intent, not actual occupancy| POLICY
    POLICY -->|start or request stop| ACTIVE
    ACTIVE -.->|count occupied calls| OCCUPANCY
    ACTIVE -->|confirmed exit: remove active and record result| ENDED
```

依赖是明确采用的业务关系，不从所有 target 自动生成，须验证无环、最低 level 与未完成请求归属。provider 证据支持 consumer 的新调用，不复活旧调用；详细共享与满足规则仍待定。

ActiveRegulationRun 和 RegulationRunRecord 不代表两个业务实体。只有确认真实退出，才原子移除活跃状态并写入终结记录；stopping/unverified 仍保守占用。占用是派生值，资源期望缩减不自动终止调用；图不新建权威 activeCount 或 Task。

## 5. 意图与状态聚合总览

[打开意图与状态聚合总览 SVG](./diagrams/coordinator-state.svg)

```mermaid
---
config:
  fontFamily: Arial, Helvetica, sans-serif
  themeVariables:
    fontFamily: Arial, Helvetica, sans-serif
    fontSize: 22px
  flowchart:
    wrappingWidth: 340
    nodeSpacing: 50
    rankSpacing: 65
    padding: 24
---
flowchart TB
    REQUESTS["RegulationRequests<br/>lastRequestSeq / latestByTarget"]
    RESOURCE["ResourceAllocation<br/>Desired binding / concurrency"]
    COORDINATOR["Coordinator<br/>Stateful decisions and effects"]
    subgraph STATE["CoordinatorState @ revision"]
        CURRENT["current singleton<br/>Confirmed requests / resource intention<br/>Active runs / dependencies / evidence<br/>Constraints / reserved budget / lifecycle"]
        TARGETS["regulationTargets<br/>Per-target aggregates"]
        RECORDS["Fact record collections<br/>runs / observations / faults"]
    end
    REQUESTS -->|request intention| COORDINATOR
    RESOURCE -->|resource intention| COORDINATOR
    COORDINATOR -->|events update state consistently| CURRENT
    COORDINATOR --> TARGETS
    COORDINATOR --> RECORDS
    CURRENT -.->|execution feedback and retained state| COORDINATOR
    CHECKPOINT["CoordinatorCheckpoint<br/>Consistent persistence boundary"]
    CHECKPOINT --- REQUESTS
    CHECKPOINT --- STATE
```

此图统一展示 intention 与 state，不把相同实体在两侧各画一份。Coordinator 是有状态、带副作用的过程，不是另一个业务实体或纯逐点映射；箭头表达归约后的状态效果，不表示副作用过程绕过纯 reducer 直接写状态。

CoordinatorSnapshot 是框内完整 CoordinatorState 在某个 revision 的一致聚合，不是新增 TS 类型或另一份权威状态；它包含 current 和 collections，不只表示 singleton 行。CoordinatorCheckpoint 在外层封装 RegulationRequests 与 CoordinatorState，连线表达组成而非执行流。ResourceAllocation 是当前外部输入，不自动加入 checkpoint；状态内的资源确认不等于当前输入。

快照版本关联同一转换下的状态，updatedAtRevision、acknowledgedAtRevision、endedAtRevision 等记录各自事实版本，跨快照保留原值。记录可结构共享，不要求每版复制；不能把不同 revision 的查询页拼成完整一致快照。

资源确认、可信约束、累计预留与服务生命周期是控制状态，不是从保留的调用历史简单汇总出来的。尤其启动失败也可能预留预算，历史裁剪不应退还预算。当前权威投影、历史事实与消息日志的持久化映射、复合成员键和一致接续留待存储设计，不在业务实体图中重复展开。
