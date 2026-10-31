# 完整 Execution 与资源授权讨论

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

## 需要精确定义的概念

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
- 宿主动态代码仍可能阻塞或终止宿主；删除 hook 不提供代码隔离，本 Idea 不承诺解决该问题。

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
