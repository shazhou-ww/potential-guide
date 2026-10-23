# Coordinator 视图表与 SELECT 定义

本文支撑 [Idea.md](./Idea.md)、[Types.md](./Types.md) 与 [Design.md](./Design.md)。业务实体关系只在 [Diagrams.md](./Diagrams.md) 绘图；视图以行粒度、属性来源、SELECT 和更新依赖定义。视图是可重算的查询冗余，不是另一个业务事实来源。以下为逻辑关系草案，不是已实现的数据库 schema，也不冻结尚未确定的事件协议。

## 基础状态、视图与一致版本

- 基础状态包括业务实体、被采纳的关系/决定和 Coordinator 控制状态。决定如果影响查询结果，必须在基础状态中有可追溯的表达，不能只存在于物化视图或私有内存。
- SELECT 定义视图的完整语义；可以按需执行，也可以物化以加速查询。物化结果不允许绕过基础状态独立编辑。
- 每份查询输入限定为一个 Coordinator 作用域、一个一致的已应用事件前缀。表名省略宿主作用域键，不意味着多 Coordinator 可以混查，也不将实例 ID 加入领域模型。
- Host 是逻辑 worker 而非物理设备，一个 Host 对应一个 Coordinator 状态边界，资源配置归属该 Host，ObjectiveRevision 不绑定 Host。下列 SELECT 仍是单 Host 内的 Coordinator 查询，不是中央观察服务的跨 Host 汇总定义；汇总时请求身份使用 (hostId, requestSeq)，状态版本按 (hostId, revision) 解释，所有局部引用保留 Host 作用域。各 Host 的 revision 不构成中央服务的统一时序，同一 targetKey 在不同 Host 的状态不自动合并。ER 新增 Host 的边界见 [Diagrams.md](./Diagrams.md#host-归属)。
- 同一版本必须满足 `V_n = SELECT(B_n)`，其中 B 是基础状态、V 是视图。事件先确定基础变更，再维护受影响视图；纯回放不重新作业务决定或执行副作用。
- 原子提交实体与视图，或让异步投影公开 appliedRevision，并只提供同一版本的组合读取。物化可暂时落后，但不能把不同版本拼成一份一致状态，也不能据落后视图重复启动工作。
- SQL 使用普通 SELECT、JOIN、窗口函数和聚合表达逻辑；JSON 列作为不透明值传递。SQLite 可用于验证这些查询，不表示已选定生产数据库。

## SELECT 所需的基础关系

已有实体可逻辑映射如下；snake_case 对应 TS 的 camelCase，属性定义沿用 Types.md。ER 聚焦身份与主要查询属性，不穷举生命周期的所有列。

| 基础关系 | 查询使用的属性 | 来源与约束 |
| --- | --- | --- |
| regulation_target | target_key、objective_key、subject、introduced_at_revision | Coordinator 已知 target 的登记事实；introduced_at_revision 是首次纳入状态的版本，不是 Objective 固有属性 |
| regulation_request | request_seq、target_key、desired_level、priority | 已合法形成并接收到该作用域的不可变请求，含外部与内部来源；尚未接收的外部输入不在此快照中 |
| regulation_run | run_id、request_seq、binding_id、binding_configuration、phase、execution_detail、recovery_ref、ended_at_revision、outcome | 同一 Run 的基础状态；phase 为 running/stopping/unverified/ended，execution_detail 保留停止原因或 lastKnown 等分支参数；结束时保留同一身份 |
| observation | observation_ref、run_id、current、observed_at、problems、gap_summary、versions、sources、recorded_at_revision | 成功观察事实；observation_ref 暂表示准确记录引用，业务记录主键的最终形式未定 |
| fault | kind、message、target_key、request_seq、run_id | 已校验的完整归属链；故障引用方式仍未定，不为计数虚构业务主键 |

以下来源是为可重算性明确列出的**待收敛基础事实契约**，不声称当前 TS 草案已经全部表达。SQL 在这些契约成立时有效；不能在实现中以时间猜测、静默默认或私有缓存代替：

| 基础关系 | 最小属性与行粒度 | 尚需明确的业务协议 |
| --- | --- | --- |
| request_acknowledgement | 每条已确认请求一行：request_seq、acknowledged_at_revision | 接收与确认的边界；重复确认不改写首次确认版本，晚到的旧确认不能覆盖较新的已确认请求 |
| probe_result | 每个 target 的一次 Probe 一行：(target_key, probe_order)、probed_at、recorded_at_revision、run_id?、result_kind、observation_ref?、fault_ref? | 包含成功和失败；probe_order 必须表达该 target 内可靠顺序且唯一，不以消息采纳版本或墙钟代替；顺序的产生、并发和恢复协议待定 |
| evidence_selection | 每个 target 一行：target_key、observation_ref?、decided_at_revision | 保存明确的采纳/撤销决定；null 表示当前无选中证据，选中的观察必须属于该 target；不能只取最近成功观察 |
| dependency_relation | 每条需求关系一行：(consumer_request_seq, provider_request_seq)、minimum_level、is_active | 请求级归属与安装/撤销事实；共享、有效性和满足协议待定，不按 target 对合并而丢失需求来源 |
| coordinator_control | 每个作用域一行：revision、allocation_acknowledgement、constraints、reserved、lifecycle | 可信配置、资源采纳、累计预留和服务状态的权威事实；reserved 不由裁剪后的 Run 历史求和 |
| request_sequence | 每个请求序列一行：last_request_seq | 唯一发号水位；不以 MAX(request_seq) 重建，不因裁剪而降低 |

probe_result 的 observed 分支只引用 observation，error 分支只引用 fault；未知用没有 Probe 行表达，不伪造成功。所有 JOIN 的引用完整性、跨 target 一致性和字段合法性必须在基础状态转换时校验；不能把查询因坏引用丢行当成正常空结果。

## 视图目录

| 视图 | 行粒度 / 逻辑键 | 对应用途 |
| --- | --- | --- |
| v_latest_requests | 每个有请求的 target 一行 / target_key | 最新意图映射，不等于待执行队列 |
| v_confirmed_requests | 每个有已确认请求的 target 一行 / target_key | 已确认请求映射 |
| v_active_runs | 每个未确认退出的 Run 一行 / run_id | 当前执行与恢复核实 |
| v_ended_runs | 每个已结束 Run 一行 / run_id | 终结结果集合 |
| v_actual_occupancy | 每个作用域一行 / singleton | 实际占用数 |
| v_target_state | 每个已知 target 一行 / target_key | 最近 Probe 与对象更新时间 |
| v_current_observations | 每个选中证据的 target 一行 / target_key | 当前决策需要的观察 |
| v_current_dependencies | 每条活跃需求关系一行 / 请求序号对 | 当前依赖，不丢失共享来源 |
| v_target_fault_counts | 每个 target、kind 一行 / (target_key, kind) | umbrella 聚合查询示例，不强制新增顶层字段 |
| v_coordinator_summary | 每个作用域一行 / singleton | 控制状态与实际占用的查询组合 |

下面每个 SELECT 的输出列就是该视图的属性，不额外保存完整实体副本。引用可在 DTO 装配时按同一快照解析；类型中的嵌套值不要求物理重复存储。

## 1. 最新请求

| 属性 | 类型 / 可空 | 来源 |
| --- | --- | --- |
| target_key | TargetKey / 否 | 请求的 target |
| request_seq | RequestSeq / 否 | 该 target 最大请求序号 |
| desired_level、priority | string、number / 否 | 所选不可变请求 |

```sql
-- view: v_latest_requests
WITH ranked AS (
    SELECT target_key, request_seq, desired_level, priority,
           ROW_NUMBER() OVER (
               PARTITION BY target_key ORDER BY request_seq DESC
           ) AS position
    FROM regulation_request
)
SELECT target_key, request_seq, desired_level, priority
FROM ranked
WHERE position = 1;
```

新请求形成后只影响对应 target；同值新请求仍替换身份，initial 也保留为请求而非删除行。排序消费可以按 priority、request_seq 升序，但这不表示就绪、启动或完成。清理必须保留当前请求或等价基线；不能删掉最新记录后让旧请求重新成为最新。若允许主动移除映射，须另定义成员撤销事实，本查询不臆造该语义。

## 2. 已确认请求

| 属性 | 类型 / 可空 | 来源 |
| --- | --- | --- |
| target_key、request_seq、desired_level、priority | 同上 / 否 | 已确认请求中序号最大的条目 |
| acknowledged_at_revision | Revision / 否 | 该请求的确认事实，不用查询时的当前版本 |

```sql
-- view: v_confirmed_requests
WITH ranked AS (
    SELECT r.target_key, r.request_seq, r.desired_level, r.priority,
           a.acknowledged_at_revision,
           ROW_NUMBER() OVER (
               PARTITION BY r.target_key ORDER BY r.request_seq DESC
           ) AS position
    FROM regulation_request AS r
    JOIN request_acknowledgement AS a ON a.request_seq = r.request_seq
)
SELECT target_key, request_seq, desired_level, priority,
       acknowledged_at_revision
FROM ranked
WHERE position = 1;
```

确认事实变化影响该 target；尚未确认的新请求不覆盖已确认值，晚到旧确认也不使序号回退。确认不表示执行或达标。请求的外部发布值可以领先于 actor 接收到的状态，不能混入同一快照直接比较版本。

## 3. 活跃运行与终结记录

| 属性 | 类型 / 可空 | 来源 |
| --- | --- | --- |
| run_id、request_seq、binding_id | 对应身份类型 / 否 | 同一 Run 的固定身份与启动事实 |
| binding_configuration | JsonObject / 是 | 当次配置；SQL null 映射为 TS 属性缺省，不改成空对象 |
| phase、execution_detail | string、分支参数值 / 活跃分支参数按类型校验 | Run 的已确认执行状态，不从时间或资源期望猜测 |
| recovery_ref | string / 是 | 外部运行重关联信息 |
| ended_at_revision、outcome | Revision、RegulationRunOutcome / 仅终结视图且非空 | 真实终结事实 |

```sql
-- view: v_active_runs
SELECT run_id, request_seq, binding_id, binding_configuration,
       phase, execution_detail, recovery_ref
FROM regulation_run
WHERE phase IN ('running', 'stopping', 'unverified');
```

```sql
-- view: v_ended_runs
SELECT run_id, request_seq, binding_id, binding_configuration,
       ended_at_revision, outcome
FROM regulation_run
WHERE phase = 'ended';
```

启动、请求停止、恢复核实或确认退出改变 Run 基础状态，然后影响这两个互斥视图。确认退出不是删除 Run 实体；是将同一身份从活跃选择中移出、进入终结选择。pending 不在两者中，也不为了排队虚构 Run。

## 4. 实际占用

| 属性 | 类型 / 可空 | 来源 |
| --- | --- | --- |
| active_count | 非负整数 / 否 | 尚未确认退出的 Run 数量，包括 stopping/unverified |

```sql
-- view: v_actual_occupancy
SELECT COUNT(*) AS active_count
FROM regulation_run
WHERE phase IN ('running', 'stopping', 'unverified');
```

空集合也返回一行 0。只受 Run 状态变化影响；资源期望缩减、换 binding、发出停止请求不会自动降低占用。该计数可物化，但不是独立可写的权威计数。

## 5. Target 最近 Probe 状态

| 属性 | 类型 / 可空 | 来源 |
| --- | --- | --- |
| target_key、objective_key、subject | 对应类型 / 否 | 已知 target 登记 |
| updated_at_revision | Revision / 否 | 最新 Probe 被采纳的版本；无 Probe 时为 target 首次登记版本 |
| probe_order、probed_at、recorded_at_revision | 顺序值、时间、Revision / 无 Probe 时均空 | 可靠顺序最大的 Probe，不是最后到达的消息 |
| run_id | RegulationRunId / 是 | Probe 来源，沿用当前草案的可选性 |
| result_kind、observation_ref、fault_ref | 判别值及精确引用 / 按结果分支 | 成功或失败都保留；无 Probe 时均空 |

```sql
-- view: v_target_state
WITH ranked AS (
    SELECT target_key, probe_order, probed_at, recorded_at_revision,
           run_id, result_kind, observation_ref, fault_ref,
           ROW_NUMBER() OVER (
               PARTITION BY target_key ORDER BY probe_order DESC
           ) AS position
    FROM probe_result
)
SELECT t.target_key, t.objective_key, t.subject,
       COALESCE(p.recorded_at_revision, t.introduced_at_revision)
           AS updated_at_revision,
       p.probe_order, p.probed_at, p.recorded_at_revision,
       p.run_id, p.result_kind, p.observation_ref, p.fault_ref
FROM regulation_target AS t
LEFT JOIN ranked AS p ON p.target_key = t.target_key AND p.position = 1;
```

无 Probe 的 target 仍有一行，映射为 lastProbe=null；最新失败不被旧成功替代。引用在同一快照内解析为 ProbeSummary 的 observed/error 载荷。此更新时间公式以当前 target 聚合仅包含不可变 target 与 lastProbe 为前提；若以后增加其他可变属性，须扩展其基础事实与重算定义，不能悄悄引入独立的更新时间。

target 登记和 Probe 事实影响该视图；晚到旧 Probe 不改变已选最新行，也不刷新 updated_at_revision。同一 Probe 的记录不可被新消息改写。probe_order 的业务产生协议仍是待定前置条件，本查询不声称已解决跨重启排序。

## 6. 当前有效观察

| 属性 | 类型 / 可空 | 来源 |
| --- | --- | --- |
| target_key | TargetKey / 否 | 经校验的证据选择归属 |
| observation_ref、run_id | 精确记录引用、RegulationRunId / 否 | 被明确选中的观察及其来源 |
| current、observed_at、problems、gap_summary、versions、sources | ObjectiveObservation 属性 / 仅 sources 可缺省 | 该观察事实，不是重新 Probe 的结果 |

```sql
-- view: v_current_observations
SELECT s.target_key, o.observation_ref, o.run_id, o.current,
       o.observed_at, o.problems, o.gap_summary, o.versions, o.sources
FROM evidence_selection AS s
JOIN observation AS o ON o.observation_ref = s.observation_ref
WHERE s.observation_ref IS NOT NULL;
```

采纳或撤销决定改变该视图。最新 Probe 失败与旧观察仍被明确保留可以同时成立，不能把当前证据冒充最新 Probe。有效性到期若影响状态，须形成撤销事实；SELECT 不读取当前墙钟来隐式改变视图。基础校验必须经 Observation → Run → Request 核对 target 一致；坏引用必须报错，不可任由 JOIN 隐藏。

## 7. 当前依赖

| 属性 | 类型 / 可空 | 来源 |
| --- | --- | --- |
| consumer_request_seq、provider_request_seq | RequestSeq / 否 | 需求关系的直接归属 |
| consumer_target_key、provider_target_key | TargetKey / 否 | 两条不可变请求各自的 target |
| minimum_level | string / 否 | 该关系要求，不用字符串 MAX 猜测层级强弱 |

```sql
-- view: v_current_dependencies
SELECT d.consumer_request_seq, d.provider_request_seq,
       c.target_key AS consumer_target_key,
       p.target_key AS provider_target_key, d.minimum_level
FROM dependency_relation AS d
JOIN regulation_request AS c ON c.request_seq = d.consumer_request_seq
JOIN regulation_request AS p ON p.request_seq = d.provider_request_seq
WHERE d.is_active = 1;
```

安装或撤销关系影响该视图；blocked Run 已结束不等于需求关系自动消失。共享 provider 的多个 consumer 保留各自的行，一条撤销不能移除其他来源。此处不先聚合成 target 对，避免丢失归属；如需最强 level/最高 priority 的共享调度视图，须先确定版本内 level 次序和共享规则。现有 CurrentDependency 的 target-only TS 表达仍需补齐这些基础归属，不能作为最终存储契约。

## 8. Target 故障统计

| 属性 | 类型 / 可空 | 来源 |
| --- | --- | --- |
| target_key、kind | TargetKey、FaultKind / 否 | Fault 的展开归属与分类 |
| fault_count | 正整数 / 否 | 该 target、kind 下的全部 Fault 行数 |

```sql
-- view: v_target_fault_counts
SELECT target_key, kind, COUNT(*) AS fault_count
FROM fault
WHERE target_key IS NOT NULL
GROUP BY target_key, kind;
```

故障写入影响其 target/kind；合法裁剪也须更新统计。没有匹配故障时没有分组行，不伪造未知分类。此查询包括 target/request/run 故障，排除 Coordinator 直接故障；provider 故障按自己的归属计数。它统计当前保留事实，不冒充裁剪前的全时累计量；若需全时统计，必须另保留充分基线。

## 9. Coordinator 摘要与快照边界

| 属性 | 类型 / 可空 | 来源 |
| --- | --- | --- |
| revision | Revision / 否 | 基础状态共同的已应用版本，不是视图自行加一 |
| allocation_acknowledgement、constraints、reserved、lifecycle | 对应 TS 值 / 否 | coordinator_control 权威状态 |
| active_count | 非负整数 / 否 | Run 状态计数，不由 concurrency 推导 |

```sql
-- view: v_coordinator_summary
SELECT c.revision, c.allocation_acknowledgement, c.constraints,
       c.reserved, c.lifecycle,
       (SELECT COUNT(*) FROM regulation_run
        WHERE phase IN ('running', 'stopping', 'unverified')) AS active_count
FROM coordinator_control AS c;
```

控制状态和 Run 状态变化影响摘要；coordinator_control 必须恰好一行，缺失不能静默当成空 Coordinator。预算预留、服务生命周期、资源确认和发号水位本身不是从 Run 历史聚合出的视图，也不会因没有活跃 Run 而消失。

完整 CoordinatorState 由这些基础状态与视图表在同一版本组合，不用一个巨大的笛卡尔 JOIN 把所有集合拼成“快照表”。CoordinatorSnapshot 表示一致读取边界，不再作为单独的聚合图或新增实体。CoordinatorCheckpoint 是否保留输入包装与适配层接续信息，仍按 Types.md 的恢复边界处理，不把输入尚未接收的值混入 actor 的当前版本。

## 事件推导与增量维护

先定基础关系及其不变量，再写视图 SELECT，再列合法转换，最后推导 events。事件表示已经发生的领域事实，不是任意 SQL patch，也不为每个物化字段另造一套可竞争的写入命令。

对每个合法前缀 n，验证基础归约 `B_n = reduce(B_(n-1), event_n)` 后，增量维护结果与这些 SELECT 的完整重算结果相等。比较按逻辑键与值进行，不依赖数据库行枚举顺序；显式排序属于查询消费。

基础状态与视图的删除/撤销同样属于事件效果，不能只实现追加路径。外部消息重投的去重、断点接续和持久化原子性须明确；纯事件回放不重新分配请求、不重新判断证据有效性、不启动或停止外部进程。历史裁剪必须保留重算所需事实或充分基线，不能把物化缓存变成唯一真相。

验证至少覆盖：空初值；同值新请求；未确认新请求及晚到旧确认；stopping/unverified 占用与确认退出；无 Probe、最新失败、旧 Probe 晚到；观察选择与撤销；共享 provider 的单边撤销；故障各层统计；资源意图改变不改实际占用；预算在运行历史裁剪后不回退；完整重算、增量维护和跨重启恢复在同一版本一致。
