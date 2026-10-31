# v0.5 实施验证

## 基线与边界

- 基于 primary `b213324a421096463a352e0213e3c0585270968b`，准确 Ideal
  `4a6c2c31f6b37d552c5401f9ae4b06e80c23350a` / acceptIdeal#10。
  原实现 worktree 在干净状态下普通 fast-forward，保留并发文档与事件历史。
  提交检查时 primary 又有另一 idea 的纯文档推进，已无冲突 fast-forward 至
  `cdd81137b9db81db981242a432707c4bad3ebe99`；本轮代码及测试基线未被并发修改。
- 本轮只修改本实现 worktree；未触碰用户 UI `62952`、Backend `61109`、
  Chrome for Testing `9223`、父工作树 dist 或用户试用目录。
- 第一轮的 [Verification.md](Verification.md)、Review 和 Outer 证据保留为历史。
  本文不是主 Agent 的独立 review/acceptance，也没有 push、submit 或接受操作。

## 实现与 API 决策

| 项目 | 本轮实现 |
| --- | --- |
| 主界面 | 只有任务 / 执行两个 tabpanel；活动页独占布局与键盘顺序，列表及详情各自在页内组织，不再是六块长页 |
| 创建与复用 | 原生 dialog，新建/编辑重做共用真实 Schema 表单；关闭/重开及切 Tab 保留输入，成功定位 Task；统一任务栏从顶部紧凑入口展开 |
| 星标 | 行/详情标星；UI Server 经公开 Task + Request API 获取完整原参数后才保存；binding + taskId 幂等，不吞权限/清理错误 |
| 星标兼容 | 保留旧 JSON 收藏，不做破坏性迁移；无 source 的旧模板在创建弹窗兼容入口；星标过滤覆盖全部本机记录，原来源清理后有明确模板标签，全部 Endpoint 被删除也能只读查看副本 |
| 执行目录 | 新增 `TaskService.listExecutions`、ExecutionQuery/Summary/Page、GET `/executions`，独立 `list-executions` 操作 |
| 目录边界 | type、startedAt 半开区间、started-desc；同刻 executionId 升序。摘要仅身份/类型/时间/状态，不含输入、Prepared、结果、绑定或 Task IDs |
| 关联导航 | GET `/tasks?executionId=…` 是准确已绑定关联的 Task 目录过滤，独立 Task `list` 授权；不扫描 Task/事件来拼执行目录，不推测全部 owners |
| 存储 | 共用 FrozenCatalog，直接读已持久化的 Facts.executions；Memory/SQLite 都适用，无新增数据库/派生索引/迁移，不改调度或匹配 |
| 预算与游标 | Task/Execution 分别有受限视图缓存、签名密钥和 namespace；同一套既有预算分别应用于两种目录，每页复核全部成员/权限，保留/重启/过期返回明确错误 |
| 观察收尾 | 流 controller 与详情/历史生命周期分开；Task 真终结及关联执行逻辑终结/回收充分后自动结束，Execution 同时需要逻辑终结与回收；明确暂停/重新观察，停流不废弃历史页 |

既有 quoted If-Match、未知身份、按序批次失败继续、取消跨通道不可逆事实、
Schema 联合约束/own properties、凭据结构化脱敏、keyed DOM 焦点和目录错误世代保护均继续使用。

## 自动化检查

环境：Node v24.12.0，pnpm 11.22.0。

- `pnpm exec turbo run build typecheck test --filter=@potential-guide/task-engine-web-ui... --output-logs=errors-only`：
  六个相关 workspace，**18/18 个任务成功**。
- UI **39 tests / 39 pass / 0 fail / 0 skip**。
  - 原有 31 项回归保持；新增真实 HTTP 星标完整原请求、并发幂等、旧模板、重启、
    来源清理与权限失败；真实 UI 代理访问执行目录/跨客户端/独立权限/独立游标。
  - 观察终结、取消释放关系、运行超时后迟到完成、完整目录摘要终结证据及坏摘要拒绝。
  - 直接加载实际 browser entry：双 Tab、保留弹窗 DOM/原输入、Esc/焦点环、
    成功定位、全部星标/清理模板、暂停/自动结束后历史页仍可读、无 Task 快照的执行 SSE 收尾。
  - 零 Endpoint 配置仍显示旧星标副本，不产生后端请求或改投。
- 新增执行目录定向测试 **6/6**：
  - Engine 4：跨客户端/共享去重/跨 scope、独立权限、冻结成员和状态/游标域/
    collection/restart、时间/扫描/缓存/页字节预算负向。
  - SQLite 1：现有 v2 权威 Execution 事实重开后可查询，旧进程游标明确失效。
  - HTTP 1：严格参数、401/403、独立授权、稳定续页和 410。
- 原 Task 目录 14 项定向回归已运行通过；六个相关工作区完整测试也通过，不以新目录牺牲原语义。
- 最终 `pnpm check` **退出码 0**：全仓 layers / format / lint / typecheck / test /
  pack 通过，包括所有 isolated packed consumer。

初次全仓检查发现新增 HTTP 测试中的 Response.json 需要显式 unknown 类型收窄，已修复；
DOM harness 的 tabindex=0 差异通过测试侧兼容模拟原生属性，不放宽产品焦点逻辑。

## 原生浏览器验证

使用 [browser-smoke.ts](../../../../../apps/task-engine-web-ui/fixture/browser-smoke.ts)
显式启动**新 headless Chrome 进程、新独立 profile、随机 Backend/UI 端口**。
脚本拒绝既有输出目录，并显式禁止连接 `9223,62952,61109`，不附着用户 Chrome。

最终运行：

```powershell
pnpm --filter @potential-guide/task-engine-web-ui exec tsx fixture\browser-smoke.ts `
  'C:\Program Files\Google\Chrome\Application\chrome.exe' `
  'D:\Code\potential-guide.worktrees\task-engine-web-ui-implementation-d0b16149\.silvermoon\ideas\01M663BC641JV531CXWN5WD2AG\outer\inner\evidence\v05' `
  '9223,62952,61109'
```

实际结果：[checks.json](evidence/v05/checks.json)。

- 两个主 Tab，活动 tabpanel 数量始终 1。
- 原生 Escape 关闭 dialog 后焦点回到新建按钮；跨 Tab / 弹窗关闭重开，原输入节点和值保持。
- 通过真实 UI 提交 Echo，完成并回收后显示“观察已结束”，最后读取时间不再持续变化。
- 标星成功；执行目录包含脚本以另一 subject 提交、UI 未打开过的 Survey 执行。
- 1440×1000 与 390×844 布局验证，窄屏没有整页横向溢出；没有未处理浏览器异常。
- 本次实际 UI 为 `52236`、Backend 为 `52235`，均由脚本拥有；完成后已关闭二者及浏览器，
  删除自己的 profile/临时收藏。输出只保留截图和检查结果，不含凭据。

截图：

- [任务页](evidence/v05/tasks.png)
- [执行页](evidence/v05/executions.png)
- [创建弹窗](evidence/v05/popup.png)
- [窄屏](evidence/v05/narrow.png)

## 主 Agent 复查入口

- [使用与运行说明](../../../../../docs/task-engine-web-ui.md)，其中列出可重建的独立 fixture、
  新权限和主要 selectors；验证应另起服务，不能重启用户内存后端。
- UI：`#tab-tasks` / `#tab-executions`、`#create-dialog`、`#only-favorites`、
  `.star[aria-pressed]`、`#submission-dialog`、`#directory` / `#execution-directory`。
- API：`packages/task-protocol/src/types.ts`、`packages/task-engine/src/frozen-catalog.ts` /
  `catalog.ts` / `engine.ts`、`packages/task-engine-http/src/index.ts`。
- 行为：`src/lifecycle.ts` / `navigation.ts` / `browser.ts`，以及新的目录、存储和工作台测试。

## 未扩大范围与限制

- 未发布 npm，未接入生产数据、账号同步、远程用户访问控制、资产管理或全局 worker 遥测。
- 浏览器验证为当前 Windows Chrome 的独立 headless profile；父 Agent 的 Chrome for Testing
  最终视觉/操作验收仍需独立完成。Node DOM harness 不被当作原生浏览器的替代证明。
- 执行目录要求新 `list-executions` grant；关联 Task 与历史/订阅权限仍独立。未知回收不自动猜结束，
  用户可暂停；超时运行仍可迟到完成。
- 收藏文件仍是单实例、操作员保护的同机文件；服务替换需显式更新 Endpoint binding。
- 目录和详情有清楚的时间边界：冻结摘要可能比实时详情旧；不是从 UI 缓存拼出的全量目录。
