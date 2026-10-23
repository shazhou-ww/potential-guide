# Check Host：最小设计

本文是本 Idea 的唯一设计稿。只做**开始、取消、观察**；观察包括单项 check 和服务当前任务集合。
不提供 registration、binding、session、业务依赖回调或 Host 管理 HTTP 接口。
以下路由及数据形状为审阅建议，尚未实现；历史讨论由 Git 保存，不在当前稿维护多套方案。

## 0. 架构不动点

```haskell
executeCheck :: WorkerDirectory -> Revision -> Subject -> IO (Behavior CheckState)
```

IO 发起一次执行，Behavior 表达该次执行的**当前状态及后续变化**。
重复采样、订阅或重新观察同一执行，不再启动 check；终态包含 CheckResult 或执行故障。
Subject 就是业务输入，不包装为 `{ref, subject}`；运行预算、取消和视图能力属于执行上下文。

Check Host 对内核进行统一调度并封装为 Web Service。内核不依赖 HTTP；
HTTP 只投影同一状态源，不再维护另一套执行状态或调度队列。
Host 不理解 Objective/level/业务 check ID，只管理代码、执行及资源。

```text
开始(directory, revision, subject) → 一次执行 → checkId + Behavior CheckState
取消(checkId)                    → 向该执行发出取消请求
观察(checkId)                    → 当前状态及变化，不执行新工作
观察服务                         → 当前活动 check 集合，不执行新工作
```

CheckState 可表达排队、执行中、进度、完成、失败、取消，具体字段后续定稿。
Completed 的 CheckResult 可表示业务不通过；调用或清理故障属于 Failed。
请求取消不等于已经停止；清理确认前不能宣告正常完成/取消，也不能把 worker 放回池。

## 1. 调整范围

只新增 `packages/check-host` 可复用包，不新增应用目录、不拆多个空壳包。
同一包内区分执行内核、统一资源调度、HTTP adapter；复用既有 CLI 启动装配。

| 调整面 | 要做的事 |
| --- | --- |
| check-host | 用户级共享 Host、三个操作、活动任务集合、按目录加载和有界 worker 池 |
| pilot-protocol / objective-pilot | worker 契约与 adapter，Subject/CheckResult 和状态语义；业务层解释依赖结果 |
| cli-runtime 与 probe/regulate/supervise | 准备准确产物，开始执行、观察状态、取消；保留业务来源和证据归属 |
| 内置 Objective、生成器、脚手架及消费测试 | 进程入口迁移为 worker handler，不再逐 check 启动重进程 |

迁移仍覆盖 **6 个 Objective、16 个 check**：

| packages 下的 Objective | check IDs |
| --- | --- |
| objective-monorepo-standard | structure、deliveries |
| objective-monorepo-standard/package-standard | structure、deliveries |
| objective-devbox-health | identity、system、toolchains、order、sustainability |
| objective-pguide-setup | installation、configuration、sanity |
| objective-pguide-self-check | installation、configuration、sanity |
| objective-pguide-setup/sanity-fixture | marker |

旧运行协议明确拒绝；历史 schema、源码和固定证据不改写。系统工具或 Agent 等业务所需外部
能力不擅自删除，但其执行权限、子进程和清理责任仍归当前请求。

## 2. 代码加载与 worker 生命周期

- **规范化目录是 key，完整产物 hash 是 revision**。开始执行直接给出这两个值，无需预注册。
  首版采用自包含 Node bundle 加显式资源，不自动安装依赖或向目录外解析任意 node_modules。
- Host 验证目录权限、入口/资源边界及完整内容，准备不可变执行副本，不能只相信入口 JS 的 hash。
  同目录同 revision 复用；旧任务排空且旧线程退出后才能加载新 revision；在途版本冲突明确拒绝。
- 一线程同时执行一项 check，固定线程/队列上限；按任务数退役，异常或清理失败隔离退役。
  有余量时预热一个同版本替补，预热不执行真实 check，所有线程都计入资源限额。
- 每次任务结束清理输入/AST/Buffer 引用、监听器、定时器、句柄和外部任务；
  只保留有界的代码/编译器缓存。GC 和周期退役不能代替每请求清理。
- 强制终止线程不保证 finally 或外部子进程已结束；未确认清理不能重新使用相关执行资源。
  Worker Threads 不是恶意代码沙箱。

业务模块的内部适配建议为 initialize、execute(subject, context)、dispose；
runner 负责生命周期和消息。execute 可以在 worker 内返回最终业务结果并报告进度，
内核对外始终提供 Behavior，而不是只返回一个最终 Promise。
具体函数签名、容量和资源阈值在实施前定稿，不展开为管理平台。

## 3. worker MessagePort 消息

| 方向 | 消息 | 最小内容 |
| --- | --- | --- |
| Host → runner | initialize | 验证后的产物/入口、revision、worker 代际及配置 |
| runner → Host | ready | 初始化完成 |
| Host → runner | execute | checkId、Subject、受限执行上下文 |
| runner → Host | started / progress | checkId 及执行进度，驱动内核当前状态 |
| Host → runner | cancel | checkId、原因 |
| runner → Host | done | checkId、结果/错误/取消及清理报告 |
| Host → runner | dispose | 停止接新任务并卸载，Host 等真实线程退出 |

消息须匹配协议版本、worker 代际和当前 checkId，迟到消息不得改变另一任务。
done 清理成功后内核才能形成正常终态；线程异常退出由内核独立处理。
证据和日志保持请求归属及既有保护边界，不为它们新增公开管理接口。
这里没有 Objective dependency 请求、响应或递归调度消息。

## 4. 对外 HTTP RPC

**三个操作、四条路由**：开始、取消，以及两个粒度的观察。

| 操作 | 建议路由 | 行为 |
| --- | --- | --- |
| 开始 | POST /checks | directory、revision、subject → 创建一次执行，返回 checkId；不等待业务完成 |
| 取消 | POST /checks/{checkId}/cancel | 请求取消已存在的执行；最终结果从状态观察确认 |
| 观察单项 | GET /checks/{checkId} | 读取该执行的当前 CheckState，或订阅当前快照和后续变化 |
| 观察服务 | GET /checks | 读取当前活动 check 的集合，或订阅集合当前快照和后续变化 |

建议开始请求使用以下形状；checkId 是调用者预先生成的关联 ID，成功响应返回同一 ID：

```json
{
  "checkId": "client-generated-unique-id",
  "directory": "D:\\workers\\repo-check",
  "revision": "sha256-of-artifact",
  "subject": {}
}
```

开始成功返回 201 与 checkId；同 ID 不重复创建执行，内容不一致拒绝。
响应丢失时可按该 ID 观察，不能生成新 ID 盲目重跑；Host 不承诺跨重启恢复任务。
格式/身份/大小/路径等前置拒绝不创建任务；已创建任务的加载、排队、执行故障由 Failed 表达。
取消受理可返回 202，已终态返回当前状态；取消请求和实际 Cancelled 状态不是一回事。
未知或已回收 ID 明确返回不存在，不触发加载或新执行。

观察建议通过同一路由的 Accept 区分：JSON 返回当前快照，NDJSON 返回初始快照及后续更新。
单项观察始终来自同一个 Behavior，采样与订阅原子衔接；集合观察从同一活动任务表投影，
不另建执行器。集合只包含调用者有权查看的排队、运行、取消/清理中的任务摘要
（checkId、当前状态、必要的产物身份），默认不展示 Subject、结果详情或秘密值。
任务终结后从活动集合移除；尚在有限保留期的终态可按 ID 单独读取。
集合流发送有界的完整摘要快照，不引入事件日志、cursor、ack 或历史重放。

**观察断开不取消执行**，再次观察仍是同一个 check；明确取消走取消操作。
开始请求受理后连接断开也不自动变成取消，避免把交付失败当作执行停止。
每次执行仍受有界截止约束，不因无观察者无限运行。
终态在明确的有限保留窗口内可读，期满后释放状态与订阅引用；活动任务不因无人观察被淘汰。
保留容量不足时背压或拒绝新执行，重复 ID 防护在有效期内不能失效。
具体期限/容量留待实现前量化，不建设持久结果库；Host 重启后的旧 ID 不能指向新任务。

Host 显式监听 loopback，校验调用者及访问能力、负载大小和路径边界；
checkId 不是权限。取消一项任务不能影响其他调用者，慢观察者只受连接背压/断开处理，
不能触发业务重跑或取消。Host 发现、启动、就绪和进程回收属于部署/内部生命周期，
不增加 registration、binding、session、view 或 Host 管理 HTTP API。

## 5. 业务结果与验收

Objective 依赖属于某类内置 check 的返回值：检查执行正常完成，可返回业务不通过，
并告知目标 Objective、目标 subject 和要求 level。Host 原样承载 CheckResult，
不解释或递归处理依赖，不让 worker 等待上层处理后才结束。
依赖要求不等于已观察事实；上层按业务规则取得真实证据、处理目标并必要时重查。
旧 currentLevelId/同轮证据机制需随业务层迁移，不能捏造状态或跳过依赖验证。

最小验证链路：

1. 两个 CLI 开始任务，共用 Host 和可复用 worker，取得不同 checkId。
2. 多次观察同一任务不重复执行；观察集合能看见并发任务及其离开，不能泄露他人数据。
3. 取消一项不影响另一项；断开再观察不取消、不重跑；终态/过期 ID 行为明确。
4. 内置依赖结果由上层处理，业务输出与证据正确；完成全部 16 个入口迁移。
5. 连续成功/失败/取消负载证明资源有界、线程初始化减少及真实冷/热收益。

不做预注册、任务恢复、可靠事件队列、自动依赖安装或远程平台。
本次仅设计，具体状态字段、路由编码和资源限额后续定稿；不记录生命周期验收。
