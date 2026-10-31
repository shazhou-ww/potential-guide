# 完整 Run、Match Policy 与类型隔离讨论

## 当前概念命名

用户于 11:22 要求采用 Match Policy 命名并补全文档。完整可复用过程采用 Run，
避免 Execution 同时指整体与其中的实际执行阶段。以下历史讨论保留当时的 Execution /
Execute 用语；其中表示完整尝试的含义，在当前设计中对应 Run，不延续到新的子阶段命名。

| 概念 | 名称 | 职责 |
| --- | --- | --- |
| 需求 | Task | 表达 Input、生效时间、等待期限及匹配政策 |
| 完整可复用单元 | Run | 承担准备、分配资源与实际执行的一次完整尝试 |
| 类型执行实现 | Executor | 编排 Run，管理具体工作及资源复用 |
| 内部阶段 | Preparation / Allocation / Execution | 分别表示准备、资源分配及实际执行，不各自充当 Task 匹配对象 |
| 匹配政策 | Match Policy；MatchPolicy / matchPolicy | 决定 Task 可匹配哪些 Run |

原 executionMatch / ExecutionMatch 在新协议中对应 matchPolicy / MatchPolicy，
不采用 matchingPolicy / MatchingPolicy，也不把字段命名绑定为 runMatching。
Match 作名词修饰语表达“关于匹配的政策”，不是单独的匹配结果字段。
Idea 的 ID 与别名 whole-execution-reuse 保持稳定；别名中的旧用词不定义新协议概念。

## Run 事件与匹配语义

started-after-eligible 和 terminated-after-eligible 两个政策值保留，
但 started / terminated 均指 Run 的事件边界，不指内部 Execution 子过程。
前者要求 Run 开始事件时间不早于 Task 的实际 eligible；
后者要求 Run 逻辑终结事件时间不早于该 eligible。接收先于匹配事件的持久化顺序边界仍保留，
不因改名而倒查接收前的已终结 Run，也不把 deadline 变成普遍的结果匹配上界。

Run 的开始不能再默认等于已经分配到业务 Worker、开始实际 Execution。
完整开始事件的精确提交时点及分配类型守护 Worker 与分配具体业务资源的区别，仍待定义。
开始后可以准备、等待资源，再实际执行；准备或分配失败也可使 Run 失败终结。
物理清理完成不是 Run 逻辑终结的同义词。

同 Input、版本、环境、scope 等兼容边界内的需求可共享同一个 Run；
Prepared 是该 Run 实际固定内容的中间事实，不是接收 Task 的共享资格。
浮动 URL 的当前目标变化不使已选 Run 的旧内容失去匹配资格，Match Policy 不保证内容新鲜度；
需要确切内容时在 Input pin digest。

Engine 对类型边界只需要一个完整运行入口，不再分别调用 Prepare、Allocate、Execute。
将入口命名为 run(Input, context) 是与上述概念一致的候选，尚未确认精确函数签名。
Prepared 是否可选、使用 yield 还是消息报告，以及中间事实的校验和持久化，仍待定义；
不因概念命名而预设 generator API 或恢复调用栈能力。
后续 [TaskType 与 Progress 草案](./TaskType.md) 给出单一 run 及 context.progress 的候选，
区分最终返回值、业务中间进度与运行生命周期事实；具体签名尚未批准。

取消一个 Task 首先撤销它的需求，不自动取消其他需求共享的 Run。
需要取消 Run 时向类型守护 Worker 投递指定 Run 的请求，正常取消不通过杀守护 Worker 实现。
类型守护 Worker 的健康重启与业务资源回收单独处理；重启不是对旧 Run 的自动重跑授权。
类型内的物理 Worker 热复用不改变 Run 身份或 Match Policy，
其 Bundle digest 匹配由类型实现负责，Engine 不理解 Bundle 版本调度。

## 用户讨论形成的方向

2026-10-31，用户指出根因是 Prepare 与 Execution 被切成两段，而共享只覆盖后者，
由此容易推导接收 Task 必须先完成 Prepare 才能判断复用。这与 Input 和 Execution Match Policy
决定复用的原原则不一致。

讨论比较了两种方向：改用 prepared 仲裁，或把准备纳入 Execution 的完整过程。
用户随后针对第二种方向确认浮动 Checker URL 的语义，并明确要求创建新 Idea 跟踪本调整。
创建请求不是对本次新构想精确 revision 的验收，也不授权立即实施。

浮动 URL U 在 Execution 准备时解析为 A，后续可能指向 B。若其原始 Input 匹配，
且 Execution 在接收 Task 的 eligible 之后终结，使用 A 不违反 terminated-after-eligible；
该规则约束终结时间，不承诺 Checker 内容的新鲜度。需要确切内容时应在 Input pin digest，
Prepared 记录实际使用的不可变内容而不是接收方的匹配资格。

用户确认同一可信 scope 内由服务权限决定结果接收，不要求每个接收 Task 重查资源。
因此本方向包括取消通用 TaskType.authorize；实际资源访问仍在可信宿主边界授权。
用户后续询问 Authorize 是否可整体去掉，讨论明确区分该 hook 与服务授权、资源动作授权、
资源替换控制，不把这些机制一并删除。

## 早期讨论中待定的概念

- 准备工作及 Prepared 归属 Execution，不归属每个接收 Task 的共享资格。
- 建议将 Execution start 定义为完整尝试开始、先于准备；这是设计建议，
  用户没有逐项确认其精确事件契约。准备期间才接收的 started-after-eligible Task
  是否必须等待另一尝试，要随完整 start 定义明确，不悄悄保留旧业务执行起点。
- 准备失败如何形成 Execution 终结事实，以及 Task 等待期限、取消与物理资源回收的关系，
  必须明确；概念合并不强制准备 IO 与业务 Worker 共用容量。
- 目前新 Task 不倒查接收前已终结 Execution；保留这一事件先后边界，
  不把完整复用扩展为历史结果搜索。
- 取消 hook 会改变资源拒绝时点及匹配时撤销行为：未获许可的新资源动作仍拒绝，
  但同 scope 的结果接收不因接收方未准备或资源许可已撤销而自动拒绝。
- 删除 hook 本身不提供代码隔离。后续讨论明确将类型内存状态隔离原则纳入本候选；
  具体执行通道尚需定界，不将目标扩大为完整安全沙箱。

## 后续讨论：执行入口与信任边界

用户提出进一步收敛为单一 Execute：独立 Prepare 注入入口可以取消，Prepared 是执行期间
可报告的中间事实；准备、申请具体资源、运行和清理由类型执行实现编排。
具体报告使用 yield 还是消息、哪些中间事实持久化及如何恢复，仍待定义。
持久化 Prepared 不等于能恢复函数调用栈，也不授权自动重跑可能产生副作用的执行。

讨论曾提出每次 Execution 一个 Worker、在其中直接调用 Check Bundle 函数以避免双层开销，
随后因 Bundle 热 Worker 复用和独立插件边界撤回默认单层建议。当前 check-task 每次尝试
创建新业务 Worker，复用的是容量槽位；旧 Check Host 的固定制品 Worker 机制与之不同。
Execution 的需求共享和物理 Worker 的跨尝试复用是两种职责，不可混称。

用户提出类型级守护 Worker 候选：Engine 对每个类型的 Worker 投递 Execute 和指定 Execution
的 Cancel；类型 Worker 管理下游工作和资源池。取消某次 Execution 不通过杀类型 Worker 实现。
Engine 管理类型 Worker 健康与按需重启；Crash 重启不意味着旧 Execution 自动重跑，
取消确认、逻辑终结、物理退出、残留资源及代际消息必须分别定义。
每个 type 名称一个 Worker 是否跨版本、环境共用，尚未确认。

用户于 11:14 明确的原则：

1. Worker 切分首先遵循业务信任边界：Engine、TaskType、类型下进一步定制的工作
   是不同层次，跨信任边界的动态代码不放在同一 Worker。
2. Engine 只认识类型对应的执行 Worker；类型内部是否再建工作 Worker、如何调度及热复用，
   由类型实现负责，不让 Engine 理解 Check Bundle 版本。
3. 另一种切分理由是真实的多线程并行需求。普通异步 IO 并发不自动要求新增 Worker，
   也不以 Execution 数量机械决定 Worker 数量。

以上原则已明确；类型级守护 Worker 是当前候选架构，不是已经验收的精确接口。
类型自身处理不跨信任边界的工作可以留在类型 Worker；额外定制代码跨边界时必须分离。
Check 的 TaskType 插件与 Checker Bundle 若属于不同信任域，就应分别运行，
不能仅为省 Worker 而合并执行。

用户随后澄清“数据窃取”不是严格信息安全意义的攻击，主要指内存状态相互干涉：
类型代码修改 Engine 内部对象造成异常，或将不必要获得的 Engine 主线程信息对外发布。
因此本候选要求独立内存状态与明确数据接口，不要求新增完整安全沙箱或操作系统权限隔离。

Node worker_threads 的独立 JS 堆符合这一内存隔离目标。Engine 不向类型代码提供内部对象
或可变引用，默认不使用 SharedArrayBuffer 等共享可变内存；消息只传必要字段，
不把整个 Engine 状态发送给类型 Worker。进一步定制的工作跨边界时遵循同样规则。
隔离防止直接接触未传递的内部状态，不保证禁止插件发布已经明确传给它的数据；
文件、网络和进程能力仍由现有可信资源边界控制，不混同这两类保护。

## 来源与证据

- [既有 Input 匹配原则](../../../../01M66MH9YKNJ406ESX7J1HTY7J/outer/inner/ideal/Discussion.md)：
  不依赖接收 Task 的 Prepared，但不能越过身份和权限边界。
- [当时代理提出的 hook](../../../../01M66MH9YKNJ406ESX7J1HTY7J/outer/inner/Preparation.md)：
  独立同步授权是代理的实现方案，不是用户点名要求的通用 Task 接口。
- [可信环境权限原则](../../../../01M65APBJ0WQ9VNWNZPN3BGJAQ/outer/inner/ideal/Discussion.md)：
  权限属于 Agent 及可信执行环境，不属于任务或投入方；保留 Server 调用与历史边界。
- EngineOptions.authorize 在 732b212a 已存在；TaskType.authorize 在 a9180578 新增。
  bdb4983 说明 delegated supervisor reviewed，不能据此声称用户逐项批准该 hook。

这些关联文档仅作来源，本 Idea 不修改它们的契约、验收或生命周期。
