# task-history-query 实施证据

## 范围与来源

- 仅在本 idea worktree 实施；未修改 ideal 子树、events.jsonl、gate modes 或部署种子。
- 初始实施基线 `f06876847bbe6dae139c8ee8296f76927f53b1b2`；
  已接受 ideal `6c8501eed9c002d4976b32aa1df444345858e884`。
- 初次 `silvermoon whats-next task-history-query --audience agent` 观察到 primary 已前进至
  `27301106f068ecf1742c4ffc2d5e00c76134490c`。按本轮委派，合并、同步、提交和 gates
  原先留给主 Agent；后续按明确委派进行下述安全集成，仍未进入 gate。
- 使用 Node v24.12.0、pnpm 11.22.0。本条未新增依赖、发布、客户服务、Web UI
  或 Schema 发现实现；集成上游已有 Schema 依赖及实现，不复刻另一条 idea 的成果。

## 上游 Schema 集成

- 当前集成基线 `a816432af4b19a159400d88b215565771ef0e43e`。
  原计划先提交实施 checkpoint，但 `silvermoon check --worktree` 相对新 primary
  明确失败：另一 idea 的事件历史 primary sequence 9、本地 sequence 3，
  `not-append-only`；没有绕过失败提交。
- 按主 Agent 明确授权，仅对本条已确认的 19 个路径执行 include-untracked stash，
  唯一名称 `task-history-query-integration-20261031-0139-9cdb8cd8`，
  恢复 OID **`48eecc069e84495b8466308572246d1cd204c6d5`**。
  然后 `git merge --ff-only origin/main`，再 apply 精确 OID；没有 pop、rebase、
  历史改写、push 或手工编辑他条 artifacts。stash 保留供主 Agent 在本条提交且
  确认 primary 可达后删除。
- HTTP 两条 GET 路由、Engine schema 编译/discovery 初始化、测试 fixture 和 Server
  import 冲突均保留双方语义。当前生产契约是 inputSchema + 编译生成 validate/equals，
  不再是 TaskType 作者自供 validate/equals。`list` 独立于 discovery 的 submit 权限，
  保留 If-Match/expectedRevision 和原 binding contractRevision 校验。
- 支持恢复的 v2 必须满足当前原契约身份要求；本条只补 updatedAt，不制造缺失的
  contractRevision。缺身份、同版本 schema 变化保持上游 `unsupported_contract`。
  历史目录展示原绑定 version，重做新提交使用当前契约而不自动附加旧版 precondition。

## 关键取舍

1. 目录读取权威 Facts，无新持久仓库或派生索引。新查询扫描有硬上限；固定摘要缓存
   受总计费内存、数量与有效期控制，不能容量不足时截断成功。每页 bytes 包含完整 JSON
   envelope 和 next。可变 page limit 不改变已冻结的查询，重试相同页大小可重现同页。
2. `list` 独立于原请求/详情权限；Caller 的 scope 和 subject 绑定游标，但不用于按原
   提交者过滤。每页检查完整成员，不只是待发送页，清理优先于稳定性。
3. 更新时间记录最后归属事件的 occurredAt，而非 max 历史时间；因此回拨是合法观察。
   新进度只更新当前绑定、未取消/未终结 Task，读取不更新。超时仍是原投影，
   新的恢复 interruption 失败是真实事实，不隐瞒为纯读取。
4. 当前支持的合法 v2 无 updatedAt 时可恢复：SQLite 与 MemoryStore 的 compact 都在仍有 Task/Execution
   时抛 `protected_history`，因此旧 checkpoint 即使没有 updatedAt，仍有完整受保护事件。
   从 floor 空前缀重放可精确补齐，包括进度与取消归属；缺事件抛 history_gap，
   不用 receivedAt/default/max 猜测历史。无格式升级，普通后续 append 持久化派生字段；
   原 contractRevision 的缺失或不匹配仍明确拒绝，不从重放事件补写身份。
5. 计费内存是保守预算而非 V8 精确 heap：每条 `2 × UTF-8 JSON bytes + 256`，
   另加固定/查询/身份开销；数量及扫描上限同时限制对象数量。5000 条无业务载荷目录
   验证初页和续页的有界遍历，不把该测试声称为吞吐 SLA 或客户规模测量。
6. 游标使用进程密钥 HMAC，缓存只在进程内；不持久化视图。有效期同时检查墙钟与
   单调时钟，时钟回拨不会无限延长。过期缓存惰性回收，close 全部释放。

## 测试对应

| 证据 | 覆盖 |
| --- | --- |
| `packages/task-engine/test/catalog.test.ts` | 类型/双时间 AND、时区及左闭右开、跨客户端/跨 scope、摘要字段白名单、同刻排序、回拨、共享进度/取消、纯读取、固定成员顺序摘要、重查、权限变化、游标篡改/混用/失效、已交付成员删除、实际 collect、Memory 重启/compact、页 bytes/总内存/扫描/视图数量与过期、5000 条有界扫描、v2 进度重放；Schema 集成后新增 discovery/list 权限隔离、旧绑定目录与当前契约重做、时间恢复不制造缺失 schema 身份 |
| `packages/task-engine-http/test/http.test.ts` | GET /tasks、严格重复/未知参数、时区编码、独立 request 权限边界的核心调用、分页及 400/403/410，既有 HTTP/SSE 回归 |
| `packages/task-engine-storage/test/catalog.test.ts` | 真实 SQLite v2 checkpoint 去除新字段后恢复进度/取消时间、原版本缺失、同版本 Schema 变化及 Prepared validator 强制转换拒绝、重启真实 interruption 更新、稳定重启、protected compact 与 floor 后的新旧数据恢复、原请求不注入版本 |
| `packages/task-engine-server/test/server.test.ts` | 现有本机隔离 listener 组装通过真实 HTTP 列出身份并验证未认证拒绝；测试退出关闭 listener |

## 验证结果

初始实施验证（f068768 基线，2026-10-31，Node v24.12.0 / pnpm 11.22.0）：

- `pnpm --filter @potential-guide/task-engine-server... build` 通过，涵盖协议、Engine、
  HTTP、SQLite、Server 的依赖链。
- `pnpm --filter @potential-guide/task-engine exec tsx --test test\catalog.test.ts`：
  最终 **13/13** 通过；5000 条目录初页/续页探针约 **50 ms**（单机样本，不作 SLA）。
  包含墙钟回拨时单调过期、旧进度回拨重放以及无 payload 投影仍拒绝缺失 result 的不变量。
- task-* 全套回归最终在完整 check 中：protocol **3**、Engine **84**、HTTP **6**、
  SQLite **25**、Server **10**，合计 **128**，全部通过。
- `pnpm exec tsc -p tsconfig.test.json --pretty false` 通过。
- 最终 `pnpm check` **exit 0**：layers/build、Biome format/lint、typecheck、全仓测试、
  pack 检查和既有独立 packed consumer 回归均通过；Turborepo test 阶段 **66/66** 成功。
  验证进程使用本 worktree 内的 `.cache` scratch，测试 listener 已按测试生命周期关闭。
- `git diff --check` 通过；未 stage、commit、push 或运行 submit/accept。

验证过程保留的异常：首轮完整 check 的已有 Probe wall-budget 测试一次得到
`Child …: running.`，不满足 `/wall|interrupted/i` 文本断言。未改动无关 Probe 代码；
用 `pnpm --filter @potential-guide/probe-task exec tsx --test --test-name-pattern
'wall/depth/check-count budgets' test\probe.test.ts` 单独重跑通过，随后两轮完整
`pnpm check` 均通过。作为已观察到的时间敏感测试风险交给主 Agent，不隐藏首轮失败。

Schema 集成后验证（a816432 基线）：

- `pnpm --filter @potential-guide/task-engine-server... build` 通过。
- `pnpm --filter @potential-guide/task-engine exec tsx --test test\catalog.test.ts test\discovery.test.ts`
  **18/18**（目录 14 + discovery 4）通过；5000 条有界目录样本约 60 ms。
- `pnpm --filter @potential-guide/task-engine-http test` **7/7** 通过。
- `pnpm --filter @potential-guide/task-engine-storage exec tsx --test test\catalog.test.ts`
  **1/1** 通过。
- 集成后的完整 `pnpm check` **exit 0**：全仓 build/layers、format/lint、typecheck、
  测试与独立 packed consumer 检查全部通过，Turborepo test 阶段 **66/66**。
  task-* 回归为 protocol **11**、Engine **89**、HTTP **7**、SQLite **25**、
  Server **10**，合计 **142**，全部通过。此轮没有重现前述 Probe 时间敏感失败。
- `silvermoon check --worktree --audience agent` **exit 0**，baseline 为 a816432。
  `silvermoon check --staged --audience agent` **exit 0**，只 staged 本条显式列举的 19 个路径。
  I-* 已据新基线证据重新完成，不沿用旧候选结果。没有创建 checkpoint/merge commit、
  push 或 submit/accept；修改以 staged/uncommitted 状态交回主 Agent。

## 审查注意

主 Agent gate 前审查（2026-10-31）：

- 审读目录视图、Engine/HTTP 接入、投影更新、SQLite 回填与 Schema 集成差异及核心测试，
  未发现阻止实施验收的问题。确认不因查询缓存绕开当前授权或记录清理，且实际绑定版本
  不被复制成原请求的显式版本。
- 独立重跑 Engine 目录 **14/14** 与 SQLite 目录恢复 **1/1**，均通过；
  `git diff --cached --check`、`silvermoon check --staged --audience agent` 均通过。
- 有界扫描与缓存的取舍、进程内游标及历史 contractRevision 拒绝规则有明确文档和测试。
  真实打包消费、独立 HTTP、持久化重启与资源回收仍属于下一阶段，不借用单测替代。
- 此记录是审查证据；准确 inner revision 的 submit/accept 由主 Agent 在同步后单独记录。

- `Operation` 新增 `list`、`TaskService` 新增 `listTasks`；自定义服务实现与穷举 allowlist
  需显式适配。缺 list 授权应拒绝，而不是复用原请求权限。
- 原类型/版本及 contractRevision 必须保留；目录未绕开 `Engine.start` 的 checkHistory，
  不能把列表能力当作缺失旧版本/身份时的恢复捷径。缺少 schema 身份的 pre-Schema v2
  并非当前 Engine 支持的合法恢复输入；沿用已集成上游的明确拒绝，不执行旧数据库迁移。
- 新查询默认预算可能比 maxTasks 更早满，服务返回明确 capacity_exceeded；部署方需按
  自身保留规模配置。无自动 collect、无跨 scope 管理员权限、无高级输入过滤。
- 缓存 view 是本机进程内资源，不提供跨实例续页；负载均衡需使用同实例或接受重查。
  大型/多租户保留集超过 scan/view 预算时明确失败，需可信配置调整；没有自动扩大容量。
