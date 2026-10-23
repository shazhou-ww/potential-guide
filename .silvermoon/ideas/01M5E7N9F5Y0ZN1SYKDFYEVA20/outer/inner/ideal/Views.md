# Coordinator 观测模型与查询视图草案

本文支撑 [Idea.md](./Idea.md)、[Types.md](./Types.md) 与 [Design.md](./Design.md)。业务实体关系只在 [Diagrams.md](./Diagrams.md) 绘图；视图以行粒度、属性来源、SELECT 和更新依赖定义。视图是可重算的查询冗余，不是另一个业务事实来源。以下为逻辑关系草案，不是已实现的数据库 schema，也不冻结尚未确定的事件协议。

## 观察中心与业务实体的区别

观测建模从“用户围绕什么对象想知道什么”出发，不按 ER 的每个实体各建一张视图。观察中心与业务实体是多对多关系，可以直接对应、跨实体组合、向上聚合或向下切片；路由和子页面是识别观察中心的产品参考，不预定 URL 协议或物理表。

主视角只有 Objective 与 Host，交汇点是 Run。Objective 跨定义版本组织治理活动，Host 组织本逻辑 worker 的执行；Target、Request、Run 是下钻子视角，可以有独立详情路由，不因此成为与两者并列的主入口。HostResourceRevision、HostResourceBinding、HostBindingRevision、Observation、Fault 及 AO 事件是支撑信息。每个视角可由多张视图与关联查询组成，不要求一张巨型表。

## 双主视角与下钻层级

| 主视角 | 下钻路径 | 观察重点 |
| --- | --- | --- |
| Objective | Objective → Targets → Requests → Runs | 从目标定义到 subject 上的实例、具体治理要求和执行贡献，跨 Host 汇总 |
| Host | Host → Runs | 直接查看该 Host 正在执行的 Run 及近期结果，再经 Run 追溯 Request、Target、Objective |

- Target 以 Objective 与 subject 决定身份，不附属于 Host。subject 自身可限定设备；不限定设备的 subject 允许多个 Host 共同推进，不能为了隔离执行而把 Host 加进 Target 身份。
- Request 属于一个 Target，固定采用的 ObjectiveRevision、desiredLevel 和 priority，不归属某个执行 Host。同一个 Request 可以由不同 Host 同时或先后运行各自的 Run；换 Host 不创建新 Request，也不改变该请求采用的版本。
- 每个 Run 必须且只关联一个 Request 和一个执行 Host。两个主视角展示的是同一 Run，不复制为两套执行事实；Host 上的并发与 binding 占用仍按实际执行 Run 计算。
- Request 子视角汇总其跨 Host 的 Runs、依赖及满足情况；任一 Run 结束不等于 Request 已满足。Host 子视角仅展示本地执行贡献，不把整个 Request 的满足或阻塞状态直接认作该 Host 的独占状态。
- 跨 Host 的 Request 必须具有稳定且无歧义的引用，不能用执行 Host 加局部 requestSeq 作为同一请求的身份。具体请求标识、创建来源、共享状态同步和协调协议仍待定；Host 事件序号只排序本 Host 的变更，不构成跨 Host 请求的全局顺序。并行执行的共享资源冲突协议另定，不靠禁止同一 Request 跨 Host 来回避。

本轮更新观测层级，尚未修改 ER 与旧 TypeScript 草案的 Host 内请求引用；它们中“Request 仅属一个 Host”及同 Host 整链校验的假设须在后续业务模型修订时替换。Fault 的 hostId 仍保留发生/记录故障的 Host 来源，但不能因此要求其所指 Request 也只能在该 Host 执行；引用 Run 时仍须校验执行 Host 一致。

Host 与 Objective 的观察需求见下文；Target、Request、Run 仍待逐项讨论。已删除旧的独立请求确认、证据采纳、共享预算预留及直接读取可变 Run 基础行的查询定义；它们不再作为实现依据。剩余关系与 SQL 仅为待复核草案，不替代观察需求。

## Host 观察需求

每个逻辑 Host 一个主观察入口，以 hostId 定位；固定身份来自 Host，资源版本和本地执行按该 Host 组合，再经 Run 关联跨 Host 的 Request 及治理对象。当前可变信息只在可重建视图中体现，不回写不可变实体。这里先记录需求和来源，不为尚未确定的连接、心跳、同步协议编造 SELECT 或表结构。

| 信息组 | 观察需求 | 来源与边界 |
| --- | --- | --- |
| 身份 | 识别这是哪个逻辑 worker | Host 的固定 hostId；展示名称若需要，另行明确来源，不以物理设备名替代逻辑身份 |
| 联系状态 | online / offline | 中央服务的连接或心跳观测；不等于 Coordinator 本地是否仍运行，也不等于是否可接收新工作 |
| 时间与新鲜度 | 最后联系时间、最后收到状态更新时间、最近业务变更发生时间 | 各时间的语义见下文；尚无记录时为空，不伪造当前时间或推断 offline |
| 资源 | 当前配置、可用 binding 及 capacity、实际占用与剩余容量 | 生效的 HostResourceRevision 及成员关联 HostBindingRevision，再组合活跃 Run；配置 capacity 不等于实际空闲量 |
| 治理活动 | 本 Host 的 Run 正在为哪些 Requests、Targets、Objectives 作贡献 | 经本地 Run 追溯，不假设 Request 归属本 Host；整体请求进度另看 Request 子视角 |
| 执行 | 直接查看本 Host 的活跃 Run、近期终结 Run 及结果 | Run 是两个主视角交汇点；失联不能把 Run 自动结束或释放占用 |
| 异常与历史 | 需要关注的问题，以及资源配置、运行和治理活动的变化 | Fault、配置版本及 AO 事件；历史故障不自动等于当前故障，恢复须有依据 |

### 时间信息与 online / offline

- 最后联系时间：中央服务最近收到可信联系信号的时间；联系可来自连接、心跳或状态更新，具体协议待定。Host 没有业务变化时仍可保持 online。
- 最后收到状态更新时间：中央服务最近收到该 Host 状态更新的时间。心跳若不包含状态更新，不因此刷新该时间；收到消息不等于其已通过校验或已连续应用。
- 最近业务变更发生时间：中央已知的最新业务变更在 Host 上实际发生的时间，不是中央接收时间。离线期间的变更可以在重连后才收到；未知或未收到就为空，不推断 Host 当前没有活动。
- 本地发生时间与中央接收/联系时间来自不同时间来源，须保留区别。Host 内的最新事件按逻辑顺序判定，不能以不同设备的墙钟排序代替；延迟、补传、重复投递和时钟偏差的精确规则待同步协议收敛。
- online / offline 由中央的观测协议决定，不用“多久没有业务事件”直接推导。尚无足够联系证据时保持未确定，不把缺失记录默认成 offline；超时阈值及断连规则不在本轮假定。

### 同步内部信息与业务展示分离

Host 的主视图关注时间，不以“同步到哪个 revision”作为主要业务展示。事件序号、连续应用水位和缺口检查仍是同步、防重及重建所需的内部信息，不因 UI 不展示而删除。

每个 Host 的 Coordinator 状态变更共用一条有序事件序列，区别于 requestSeq 和各配置版本身份；重启继续原序列，不同 Host 没有天然全局顺序。收到较大序号不代表此前事件已连续应用；内部水位只能表示完整前缀。一个事件是否对应一次 CoordinatorState.revision、批次的原子边界仍须在事件协议中明确，不在 Host 视图需求中冻结。

Host 本地状态与中央联系观测分别保留来源和重建输入，不强行归入同一条 Host 业务事件序列。重放 Host 业务事件不能恢复中央曾经的连接事实；若需重建中央联系历史，中央也须保留相应观测记录或充分基线。

## Objective 观察需求

以稳定 objectiveKey 定位一个跨版本 Objective，展示来源及定义，并组合它的 revisions、Targets 和各 Host 的治理活动。Objective、Revision 与 Target 均是 append-only；最新上线版本、采用分布和推进情况是视图，不回写固定实体。

| 信息组 | 观察需求 | 来源与边界 |
| --- | --- | --- |
| 身份与定义 | 这是哪个 Objective，来源在哪里，定义了什么目标 | Objective 的固定来源与身份；定义内容须明确所展示的 Revision，不拼接不同版本的 level 或规则 |
| 版本 | 有哪些已知 revisions，最新上线版本是哪一个，何时上线 | 固定 ObjectiveRevision 与追加的发布/生效事实；仅发现 commit 不代表上线，无发布依据时最新上线值未知 |
| 采用分布 | Targets 下的 Requests 采用哪些版本，各 Host 的 Run 正在执行哪些版本 | 沿 Target → Request → ObjectiveRevision 与 Host → Run → Request 聚合；同一 Request 可由多个 Host 执行，不从历史 Run 推断当前采用 |
| 治理对象 | 应用于哪些 subjects、形成哪些 Targets，有哪些 Host 的 Run 参与 | Target 独立于 Host；同一 subject 升级版本不生成新 Target，同一 Target 可跨 Host 推进 |
| 期望与现实 | 各 Target 的期望 level、观察、差距与新鲜度 | 期望及观察按准确的 Request/Revision 解释；旧版本证据能否用于新版本判断须另定规则，不默认等价 |
| 推进与执行 | 哪些请求正在推进、受阻或满足，关联哪些 Run | 对应观察模型与依赖事实；Run 结束不等于请求已满足，不预设单一“Objective 已达标”总状态 |
| 异常与变化 | 哪里存在问题，最近有哪些发布、请求和执行变化 | 关联 Fault 与 AO 事实，保留 Host、Target、Request、Run 及版本来源；中央联系时间不冒充业务发生时间 |

### 最新上线版本与旧版本提示

Objective 可以有一个最新上线版本，不再采用“没有最新版本”的旧假设。它由具有明确发布作用域、可靠顺序和生效依据的追加事实推导；不按 commit OID 大小、时间戳或各 Host 的消息到达先后排序。具体发布记录身份、权威来源、并发与撤回协议尚未确定，本轮不编造 SQL。

正常规则是新版本上线后新创建的 Request 采用最新上线版本，内部依赖派生请求同样遵守。Request 一旦形成便固定版本和目标 level；发布不改写旧 Request、Run 或 Observation，不自动创建替代请求或取消执行。中央已知最新版本与 Host 已知版本可能不同，离线或滞后时是拒绝新建、等待同步还是其他策略，须另行收敛，不能静默降级。

旧版本提示至少区分“Target 下的当前请求仍采用旧版”和“某 Host 的旧版 Run 尚未结束”；当前请求的选取及替代规则待 Request 子视角收敛。历史记录仍按原版本展示，不将历史存在当成当前采用。Host 当前没有相关执行时不据历史推断落后；Host 本地定义缓存/同步版本若需单独展示，必须有额外事实，不从跨 Host 的 Request 猜测。提示是中央已知事实下的比较，不声称已获知离线 Host 此刻的状态。

后续校验应覆盖：同一 source 的两个 commits 保持同一 Objective/Target、形成不同 Revision；新请求采用新版本而旧请求/Run 不变；跨 Objective 的 Revision 引用显式拒绝；同名 level 跨版本不能默认语义相同；已发现但未上线的 commit 不替代最新上线版本；旧事件晚到不回退发布顺序；离线、无当前请求和仅有历史记录时的提示边界。

## 基础状态、视图与一致版本

- 基础状态包括业务实体、被采纳的关系/决定和 Coordinator 控制状态。决定如果影响查询结果，必须在基础状态中有可追溯的表达，不能只存在于物化视图或私有内存。
- SELECT 定义视图的完整语义；可以按需执行，也可以物化以加速查询。物化结果不允许绕过基础状态独立编辑。
- 每份查询输入限定为一个 Coordinator 作用域、一个一致的已应用事件前缀。表名省略宿主作用域键，不意味着多 Coordinator 可以混查，也不将实例 ID 加入领域模型。
- Host 是逻辑 worker 而非物理设备，资源配置与本地执行归属 Host，Objective、Target、Request 不因执行位置而分裂身份。Host 状态版本仍按 (hostId, revision) 解释，不构成中央全局时序；Request 的跨 Host 身份协议另定。下列旧 SELECT 仅是已有单来源草案，request_seq 是旧引用占位，不可直接用于跨 Host JOIN 或推导当前请求选择；待共享请求及下钻需求收敛后替换，不能将本地最新序号误当全局最新请求。
- 同一版本必须满足 `V_n = SELECT(B_n)`，其中 B 是基础状态、V 是视图。事件先确定基础变更，再维护受影响视图；纯回放不重新作业务决定或执行副作用。
- 原子提交实体与视图，或让异步投影公开 appliedRevision，并只提供同一版本的组合读取。物化可暂时落后，但不能把不同版本拼成一份一致状态，也不能据落后视图重复启动工作。
- SQL 使用普通 SELECT、JOIN、窗口函数和聚合表达逻辑；JSON 列作为不透明值传递。SQLite 可用于验证这些查询，不表示已选定生产数据库。

## SELECT 所需的基础关系

已有实体可逻辑映射如下；snake_case 对应 TS 的 camelCase，属性定义沿用 Types.md。ER 聚焦身份与主要查询属性，不穷举生命周期的所有列。

| 基础关系 | 查询使用的属性 | 来源与约束 |
| --- | --- | --- |
| objective | objective_key、source | 稳定来源身份，不含 commit |
| objective_revision | objective_revision_key、objective_key、version | 固定完整 commit 与所属 Objective；发布/生效来源协议另定 |
| regulation_target | target_key、objective_key、subject、introduced_at_revision | Coordinator 已知 target 的登记事实；introduced_at_revision 是首次纳入状态的版本，不是 Objective 固有属性 |
| regulation_request | request_seq、target_key、objective_revision_key、desired_level、priority | 已接受的不可变请求；Revision 与 Target 必须属于同一 Objective，外部与内部请求都固定准确版本 |
| regulation_run | run_id、request_seq、hostBindingRevisionId、executionLimits | Run 的不可变启动属性；执行阶段、进度、终结由 AO 变化记录推导，具体关系 schema 待 Run 观察模型收敛 |
| observation | observation_ref、run_id、current、observed_at、problems、gap_summary、versions、sources、recorded_at_revision | 成功观察事实；observation_ref 暂表示准确记录引用，业务记录主键的最终形式未定 |
| fault | host_id、kind、message、target_key、request_seq、run_id | host_id 必填，与所属 Coordinator 一致；下层引用在同一 Host 内校验，记录引用方式仍未定 |

以下来源是为可重算性明确列出的**待收敛基础事实契约**，不声称当前 TS 草案已经全部表达。SQL 在这些契约成立时有效；不能在实现中以时间猜测、静默默认或私有缓存代替：

| 基础关系 | 最小属性与行粒度 | 尚需明确的业务协议 |
| --- | --- | --- |
| probe_result | 每个 target 的一次 Probe 一行：(target_key, probe_order)、probed_at、recorded_at_revision、run_id?、result_kind、observation_ref?、fault_ref? | 包含成功和失败；probe_order 必须表达该 target 内可靠顺序且唯一，不以消息采纳版本或墙钟代替；顺序的产生、并发和恢复协议待定 |
| dependency_relation | 每条需求关系一行：(consumer_request_seq, provider_request_seq)、minimum_level、is_active | 请求级归属与安装/撤销事实；共享、有效性和满足协议待定，不按 target 对合并而丢失需求来源 |
| request_sequence | 每个请求序列一行：last_request_seq | 唯一发号水位；不以 MAX(request_seq) 重建，不因裁剪而降低 |

probe_result 的 observed 分支只引用 observation，error 分支只引用 fault；未知用没有 Probe 行表达，不伪造成功。所有 JOIN 的引用完整性、跨 target 一致性和字段合法性必须在基础状态转换时校验；不能把查询因坏引用丢行当成正常空结果。

## 视图目录

| 视图 | 行粒度 / 逻辑键 | 对应用途 |
| --- | --- | --- |
| v_latest_requests | 每个有请求的 target 一行 / target_key | 最新意图映射，不等于待执行队列 |
| v_active_runs | 每个未确认退出的 Run 一行 / run_id | 当前执行与恢复核实 |
| v_ended_runs | 每个已结束 Run 一行 / run_id | 终结结果集合 |
| v_actual_occupancy | 每个作用域一行 / singleton | 实际占用数 |
| v_target_state | 每个已知 target 一行 / target_key | 最近 Probe 与对象更新时间 |
| v_current_observations | 每个 target 的当前观察 / target_key | 由观察使用规则推导，不另存证据采纳事件；规则待定 |
| v_current_dependencies | 每条活跃需求关系一行 / 请求序号对 | 当前依赖，不丢失共享来源 |
| v_target_fault_counts | 每个 Host、target、kind 一行 / (host_id, target_key, kind) | umbrella 聚合查询示例，不强制新增顶层字段 |

下面每个 SELECT 的输出列就是该视图的属性，不额外保存完整实体副本。引用可在 DTO 装配时按同一快照解析；类型中的嵌套值不要求物理重复存储。

## 1. 最新请求

| 属性 | 类型 / 可空 | 来源 |
| --- | --- | --- |
| target_key | TargetKey / 否 | 请求的 target |
| request_seq | RequestSeq / 否 | 该 target 最大请求序号 |
| objective_revision_key、desired_level、priority | ObjectiveRevisionKey、string、number / 否 | 所选不可变请求的准确版本及该版本下的目标 |

```sql
-- view: v_latest_requests
WITH ranked AS (
    SELECT target_key, request_seq, objective_revision_key, desired_level, priority,
           ROW_NUMBER() OVER (
               PARTITION BY target_key ORDER BY request_seq DESC
           ) AS position
    FROM regulation_request
)
SELECT target_key, request_seq, objective_revision_key, desired_level, priority
FROM ranked
WHERE position = 1;
```

新请求形成后只影响对应 target；同值新请求仍替换身份，initial 也保留为请求而非删除行。排序消费可以按 priority、request_seq 升序，但这不表示就绪、启动或完成。清理必须保留当前请求或等价基线；不能删掉最新记录后让旧请求重新成为最新。若允许主动移除映射，须另定义成员撤销事实，本查询不臆造该语义。

## 2. 请求接收边界

Request 进入同一 actor 的状态即表示已被接受，不再维护已确认请求表或视图。接纳不代表已执行或达标；外部消息的持久化响应、去重与重试属于边界协议，不另造内部 acknowledgement 状态。

## 3. 活跃运行与终结记录

Run 固定属性与追加的启动、停止、恢复核实及终结事实共同决定当前状态。旧版从可变 regulation_run.phase 直接筛选的 SQL 已撤回；待 Run 观察需求与生命周期记录协议收敛后再给出完整 SELECT。终结不删除 Run，pending 不虚构 Run；失联不等于确认退出。

## 4. 实际占用

| 属性 | 类型 / 可空 | 来源 |
| --- | --- | --- |
| active_count | 非负整数 / 否 | 尚未确认退出的 Run 数量，包括 stopping/unverified |

从 AO 生命周期事实重建的 Run 当前状态计数，具体 SELECT 随 Run 模型定义；不从可变基础实体读取 phase。空集合也返回一行 0。资源期望缩减、换 binding、发出停止请求不会自动降低占用。该计数可物化，但不是独立可写的权威计数。

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

当前用于判断的 Observation 由明确规则从已有事实推导，不新增独立证据采纳或撤销事件。最新 Probe 失败后旧观察是否仍适用、何时过时，留待 Target 观察需求收敛；不提前假定最近成功即有效，也不把历史观察冒充此刻现实。旧的 evidence_selection 表与 SELECT 已删除。

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
| host_id、target_key、kind | HostId、TargetKey、FaultKind / 否 | Fault 的展开归属与分类，不能把各 Host 的同一 target 混为本地统计 |
| fault_count | 正整数 / 否 | 该 target、kind 下的全部 Fault 行数 |

```sql
-- view: v_target_fault_counts
SELECT host_id, target_key, kind, COUNT(*) AS fault_count
FROM fault
WHERE target_key IS NOT NULL
GROUP BY host_id, target_key, kind;
```

故障写入影响其 host/target/kind；合法裁剪也须更新统计。没有匹配故障时没有分组行，不伪造未知分类。此查询包括 target/request/run 故障，排除 Host/Coordinator 直接故障；provider 故障按自己的归属计数。Host umbrella 查询按 host_id 过滤，可覆盖全部四层，不限于这个 Target 分组视图。中央服务自身诊断不加入被观察 Host 的故障统计。它统计当前保留事实，不冒充裁剪前的全时累计量；若需全时统计，必须另保留充分基线。

## 9. Coordinator 摘要与快照边界

旧版包含资源确认、累计预算预留和可变 Run 基础行的 Coordinator 摘要 SELECT 已删除。当前资源来自不可变 Host 资源版本，单次限制属于 Run，没有共享总预算需求；内部发号水位和同步连续前缀仍必须可靠延续，但不是 Host 主要展示信息。

完整 CoordinatorState 由这些基础状态与视图表在同一版本组合，不用一个巨大的笛卡尔 JOIN 把所有集合拼成“快照表”。CoordinatorSnapshot 表示一致读取边界，不再作为单独的聚合图或新增实体。CoordinatorCheckpoint 是否保留输入包装与适配层接续信息，仍按 Types.md 的恢复边界处理，不把输入尚未接收的值混入 actor 的当前版本。

## 事件推导与增量维护

先定基础关系及其不变量，再写视图 SELECT，再列合法转换，最后推导 events。事件表示已经发生的领域事实，不是任意 SQL patch，也不为每个物化字段另造一套可竞争的写入命令。

对每个合法前缀 n，验证基础归约 `B_n = reduce(B_(n-1), event_n)` 后，增量维护结果与这些 SELECT 的完整重算结果相等。比较按逻辑键与值进行，不依赖数据库行枚举顺序；显式排序属于查询消费。

事实层只追加，解除关系、结束执行或停用配置由新记录表达；视图行可以随之更新或移除，不删除或改写原事实来表达业务撤销。外部消息重投的去重、断点接续和持久化原子性须明确；纯事件回放不重新分配请求、不重新作业务决定、不启动或停止外部进程。历史裁剪必须保留重算所需事实或充分基线，不能把物化缓存变成唯一真相。

Host 后续验证至少覆盖：未有联系或业务变更时的空值；在线但没有业务变化；离线补传使发生时间与接收时间不同；心跳不冒充业务更新；旧事件补传不替代最新事件；失联不结束 Run；配置缩容不释放真实占用；收到较大事件号但存在缺口；中央观测与本地业务事实分别重建。其余观察中心的查询用例随对应需求完善，完整重算、增量维护和跨重启恢复须在同一输入边界一致。
