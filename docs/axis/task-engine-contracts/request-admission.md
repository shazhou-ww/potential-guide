# Request 受理与幂等处理

本契约约束 Request 到 Task 的受理过程，防止非法输入、重复创建及同一请求标识下的意图改写。

关联 [职责入口](../task-engine-responsibilities.md)：operation A1，提交 Request。

1. 在请求到达时检查 `requestId` 的 ULID 格式及可受理时间窗口；
   过期或过于超前的 ID 明确拒绝，包括新到达的幂等重试。
   通过检查的本次请求在 preparation 期间保留窗口资格，不因 Bundle 下载期间窗口推进而失效。
2. 在窗口内按完整 `requestId` 做幂等检查：相同原始意图且原记录仍保留时返回该请求当前的处理结果，
   包括原 tracking token、已创建的 Task 或已记录的失败；不另开一份处理。
   请求内容冲突则拒绝；原记录已清理时按下述保留规则明确报告不可用。
3. 新 Request 携带完整 Bundle URL 与 Digest，不要求预注册类型。
   Engine 按需获取并验证 Bundle，再使用其中的 Input Schema 校验输入；
   所有准入检查通过后才创建 Task。下载、制品验证或输入校验失败均为提交失败，
   不创建 Task，也不记作 Run 失败。缓存命中仍遵守相同校验要求；
   制品规则见[Task Bundle](./task-bundle.md)。
4. 在绑定数据域内，根据 `matchPolicy` 等匹配条件，决定是否需要调度新的 Run。Request 幂等与 Task–Run 匹配是不同的判断，不合并独立 Task。
5. 同一 `requestId` 并发提交也最多创建一个 Task；受理成功返回前，Task 的受理事实与幂等依据必须可靠保存。

## 提交结果与 tracking token

提交不要求同步等到 Bundle preparation 完成，逻辑上有三种返回结果：

| 结果 | 含义 |
| --- | --- |
| `accepted` | 校验通过且 Task 已可靠创建，返回其标识；不表示 Run 已开始执行。 |
| `rejected` | 已确定提交失败，返回明确错误，不创建 Task。 |
| `preparing` | Request 处理尚未完成，返回 tracking token，调用方可查询最终结果。 |

上述名称描述结果语义，具体 API 编码另行定义。

1. tracking token 直接使用 `requestId`，不额外生成独立查询标识；
   它对应一个 Request 的完整处理过程，不对应 Bundle 或共享 preparation。
   不同 Request 的 token 不同；同一 Request 的幂等重试和重启恢复均使用原 `requestId`，
   不能因共享 preparation 而合并 token。
2. token 关联的持久记录包含原始 Request、Bundle 引用、业务输入和处理上下文，
   足以在准备完成后判断该请求是否创建 Task、以什么原始参数创建 Task。
   这不要求把这些信息直接编码进 token，也不在准备完成前分配一个虚构的 Task。
3. 返回 `preparing` 前，必须可靠保存 Request、token 对应关系、处理状态、
   到达时窗口资格及恢复所需的 preparation 关联。仅在内存启动下载不能作为可靠跟踪承诺。
4. 按 token 查询返回该 Request 的 `preparing`、`accepted` 或 `rejected` 结果。
   已进入 preparing 的请求若下载、制品验证或输入校验失败，必须保存可查询的 rejected 结果，
   不把失败伪装成 Task 的终结。
5. Task 创建与该请求的 accepted 结果必须一致持久化；重启或并发重试不能创建多个 Task，
   也不能在已有 Task 时把该请求恢复成尚未完成受理。
6. token 查询不等于重新提交 Request，不重新检查新提交的 ID 时间窗口，
   不重新下载或创建 Task。
7. 可提供有界 long poll 等待处理结果；单次等待到期仍为 preparing 时，不等于提交失败。
   查询、停止查询和调用方是否继续等待都不影响原请求处理。
8. Request ID 超出新提交窗口，不使仍在处理的 token 失效。
   终态结果及 token 的查询保留期限由宿主配置，规则见下节；记录不可提供时必须明确报错，
   不能返回伪造结果或借查询重新处理请求。
9. 调用方可以直接按 `requestId` 查询，不要求先收到 preparing 响应。
   该 Request 已有终态记录时直接返回原 accepted/rejected 结果，不重复准备。
   未知或已清理的请求明确报告不存在或结果不可用，不能将“没有记录”解释为 preparing。
10. Bundle 缓存命中不代表该 Request 已受理：仍须按请求校验 Input，
    只有可靠创建 Task 后才返回 accepted。

## 统一状态查询与 long poll

按 `requestId` 查询受理状态使用同一个操作，通过可选 `waitMs` 控制是否等待。
逻辑签名如下，正式方法名与传输编码另行确定：

```ts
getRequestStatus(requestId: string, options?: { waitMs?: number }): Promise<SubmissionResult>;
```

1. `waitMs` 省略或为 `0` 时立即返回当前处理状态。
2. `waitMs` 为正时，仅在当前状态为 preparing 时等待；形成 accepted/rejected 后立即返回，
   最多等待指定时长。等待结束仍未形成终态时返回 preparing，不报告提交失败。
3. 已有终态结果直接返回；未知或已清理的请求明确报错，不等待记录出现，
   也不借查询启动处理。
4. `waitMs` 必须为非负有限整数，单次等待上限由宿主配置；
   非法值或超过上限明确拒绝，不静默截断等待参数。
5. 单次 long poll 的等待期限只属于查询，不是 preparation 的超时，
   不改变请求处理、共享准备或记录保留。调用方停止等待不停止处理。
6. 此操作查询 Request 的处理结果，不替代读取不可变原始请求的 `getRequest`。

## 跟踪结果保留

1. Preparing 请求的持久记录、tracking token 及恢复依据必须继续保留，
   不因记录年龄或 Request ID 超出新提交窗口而清理，不适用终态结果保留期。
2. Accepted/rejected 终态跟踪结果的查询保留期由可信宿主配置，
   从该请求首次可靠形成终态的时间起算，协议不固定天数。
   查询、幂等重试和 Engine 重启不重新起算。
3. 保留期届满后可清理终态跟踪结果，但不能破坏幂等保证；
   仍处于可受理窗口或仍有保留资格在途请求所需的幂等凭据须继续保留。
4. 跟踪结果已清理时，token 查询明确报告结果不可用，
   不将其变回 preparing、不重新处理 Request，也不创建新的 Task。
5. 跟踪结果清理不取消或删除已经创建的 Task，不改变其 Run 或历史事实；
   Task/Run 与跟踪结果分别遵守各自的保留规则。

## 共享 Bundle preparation

1. 多个 Request 可以共享同一 Bundle 的获取与验证工作，但各自保留原始意图、
   tracking token、准入判断和最终处理结果。
2. 共享 preparation 只产出已验证 Bundle，不能替代各 Request 的 Input Schema 校验。
   同一 Bundle 准备完成后，一个 Request 可以创建 Task，另一个可以因输入无效而 rejected。
3. 共享必须满足各请求指定的内容身份，不能用其他 Digest 的准备结果替代。
   单个请求校验失败不因此终止其他有效请求仍需要的共享准备工作。
4. 此 preparation 属于受理前制品装载，不是 Task stage、Run 或 Run 内的业务准备阶段。
   共享 preparation 不合并 Request/Task，也不预先决定未来 Task 是否共享 Run。
5. Engine 重启后恢复 preparing 请求及其 preparation 关联，继续准备并逐个完成准入。
   已验证完整内容可以复用；未完成下载不能伪装成有效 Bundle。
   恢复不要求保存网络连接或调用栈，也不表示重新执行已开始的 Run。

## 受理前等待与 Task 时间

Bundle preparation 不配置整体等待预算或截止时间，不因网络慢或持续时间长而判定提交失败。
明确的获取、制品验证或输入校验错误仍形成 rejected；无整体时限不等于忽略错误或无限重试。
下载与校验期间 Task 尚未创建，不存在 Task 的 eligible 或 timeout 状态，也不消耗 Task `timeoutMs`。
`receivedAt` 取所有准入检查通过后受理并创建 Task 的时间，不取网络入口时间或下载开始时间。
实际生效时间不早于创建时间，Task 超时从实际生效时间计算；
具体公式见[Task 生命周期](./task-lifecycle.md)，准备边界见[Task Bundle](./task-bundle.md)。

## 提交与调用方等待无关

1. 向 Engine 提交完整 Request 是一次性的单向处理通知，不建立需要调用方持续维持的连接或会话。
   Engine 被调用并取得完整 Request 后，即按准入规则开始处理。
2. 调用方是否继续等待结果不影响处理，不构成撤回或改变本次请求的窗口资格。
   校验通过后创建 Task，失败按提交失败处理；开始处理不等于已受理成功。
3. 传输层负责将完整 Request 交给 Engine，连接状态不进入 Engine 的受理契约。
   受理结果的返回或观察不改变这一单向处理语义；未观察到结果不证明 Task 未创建。
4. 调用方以同一 `requestId` 和原始意图重试时，仍遵守到达时窗口检查及幂等规则。
   已持久化的 preparing 请求在 Engine 重启后继续恢复处理，token 保持不变。

## ULID 可受理窗口

1. 以服务端时间检查 ULID 的时间部分：拒绝早于可受理下界的 ID，也拒绝超过允许时钟偏差的未来 ID。
2. 可受理下界在数据域内只前进、不后退；时间回拨、重启或配置调整不能使已经过期的 ID 重新有效。
3. ULID 时间由外部参与者提供，只用于准入检查，不证明实际生成时间，也不替代服务端 `receivedAt`。
4. ID 过期只限制提交及重试，不取消已受理 Task，不改变其时间边界，也不限制它预约未来生效。
5. 更换 ID 属于新 Request，不享有原 ID 的幂等保证。
6. 公开配置默认 windowMs=86,400,000、futureSkewMs=60,000；windowMs 为正，futureSkewMs 可为 0。
   每个请求到达时，以服务端到达时间检查窗口，先可靠推进下界
   L=max(已持久下界, 到达时间-windowMs)，再检查时间戳 t 满足
   L <= t <= 到达时间+futureSkewMs，两端包含等号，包括新到达的幂等重试；
   新域下界初始化为 now-windowMs。扩大窗口也不得回退已持久下界。
7. 通过到达时窗口检查的本次请求，在 preparation 期间保留该资格，无整体等待时限。
   下载后创建 Task 时不以新的当前时间再次判为 ID 过期；仍须通过输入校验、
   其他准入检查及原子幂等裁决。保留资格不等于 Task 已创建或已受理成功。
8. 保留资格仅属于本次在途请求，不延长该 ID 对新请求的有效期，也不回退全域窗口下界。
   后续重试按新的到达时间重新检查，不继承原请求的窗口资格。
   到达时间仅用于该窗口资格判断，不替代 Task 创建时确定的 `receivedAt`。

## 幂等凭据保留

1. 在 ID 仍可能被受理期间，必须保留足以核对原始意图并定位原 Task 的幂等凭据。
2. ID 确定过期且不存在仍需这些凭据的保留资格在途请求后，才可清理对应凭据；
   后续新到达的重试按过期拒绝，不能重新创建 Task。
3. 清理 Task 详情不能提前失去幂等保证；原记录不可提供时应明确报告不可用，不返回伪造 Task 或当作新请求。
4. 幂等凭据过期不要求立即删除 Task 历史，两者的保留目的不同。
5. 已保留窗口资格的在途请求仍可能合法创建 Task。
   清理不能只因 ID 已落在当前窗口外，就删除这些请求完成幂等裁决所需的凭据；
   也不能让并发保留资格的请求在原记录清理后重复创建 Task。
6. 凭据覆盖 preparing 和 rejected 等请求处理记录，不只覆盖已创建的 Task。
   同一 Request 的失败结果不能因没有 Task 而丢失幂等依据；token 查询保留与新提交窗口分别管理。

跨重启与清理的约束见[持久化与重启后的行为](./persistence-recovery.md)。
