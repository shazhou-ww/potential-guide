# 任务操作面板：能力与缺口调研

日期：2026-10-30。本文支撑 [Idea.md](Idea.md) 和[需求确认稿](Requirements.md)，不是实施方案或新的需求契约。

## 调研范围与证据边界

- 基线为本会话独立 worktree 的提交 [`5681098ff36151d4bc379a63a1e7c84de2c27072`](https://github.com/shazhou-ww/potential-guide/tree/5681098ff36151d4bc379a63a1e7c84de2c27072)。下列源码路径及行号均对应此基线。
- 核对源码、现有测试和工程配置，不查询其他会话的未提交工作，不启动用户已有服务，不清理真实缓存，不发布包。
- “已有”指此仓库快照中的公开能力，不代表客户运行的 Endpoint 或 npm 最新发布包已经具有相同行为。正式接入前仍需确认实际版本和配置。
- “建议”尚未由用户选择。本次不调整十一则故事的范围、开发优先级或 gate，不把调研完成当作构想接受。

## 结论

核心任务操作已有可用基础，不需要为了 UI 重做引擎；但“只在现有 HTTP API 上加页面”无法覆盖全部需求。

主要缺口包括任务类型及输入 schema 发现、类型资产的查询/版本选择/受限清理、本机收藏，以及后续访谈明确要求的 Endpoint 全量历史公开查询。调度观察已有 Task 与 Execution 的事实关联，但不等于拥有全服务器资源拓扑或完整任务目录。

## 需求 → 现有能力 → 缺口 → 建议归属

| 需求 | 已核实的能力 | 缺口或限制 | 建议归属，尚未授权实施 |
| --- | --- | --- | --- |
| US-01 类型发现、按类型填表 | 服务启动时注册类型及当前版本；类型拥有运行时输入校验函数 | 没有类型/schema 发现路由；TaskType 没有输入 schema 字段。Check/Probe 的 subject 还受所选制品 schema 约束 | 通用发现契约由协议、HTTP/Server 与类型提供者协作；类型资产提供 subject 元数据；UI 负责渲染 |
| US-02 单条提交 | `POST /tasks`、ULID 格式 `Idempotency-Key`、202 快照、原请求查询与幂等冲突 | 无现成表单或提交状态机；响应未知不能当作确定失败 | UI 管理同一次提交身份及显式错误；复用协议 |
| US-03 任务篮 | 可逐条提交，提交返回不等待任务完成 | 无原子批量接口，也不需要为现有故事新增；发送与执行顺序不能混淆 | UI 准备、排序、按序提交，逐条显示失败或未知并继续 |
| US-04 stage、过程、事件 | 快照含准备、分配、执行时间；有事实历史、分页、SSE、progress 和结果/错误 | 不是所有内部过程都有通用事件；progress 为类型定义的 JSON；无 UI 展示层 | UI 通用时间线和原始详情；额外语义解释由类型提供，不猜事件 |
| US-05 排队、合并、资源观察 | `queued`/`running`、`executionId`、分配绑定和执行回收事件可作为证据 | 无公开 worker 清单、池容量/队列位置接口；不能枚举某 Execution 的所有 Task owners | UI 展示已知任务的真实关联；若确需完整池视图，再由引擎/执行器提供受限遥测 |
| US-06 取消、超时 | 显式取消、独立 canceledAt、deadline 与执行事实；断开 SSE 不取消任务 | deadline 不是强制终止开关；取消一个共享任务不等于执行已回收 | UI 保留独立维度，遵循现有语义，不新增暂停/恢复或调度控制 |
| US-07 缓存查看 | Check/Probe 可复用有权限校验的 ArtifactSource；内部按精确 digest 缓存 | 没有公开列举、容量/占用查询或资产管理路由；现有通用来源缓存是进程内 Map | 资产所有者提供受限管理能力；UI 通过明确契约访问，不读后端磁盘 |
| US-08 选历史版本 | 引用可带精确 digest；不匹配会失败；Probe 支持 Objective bindings | 没有历史版本目录；知道 digest 不代表内容仍可取得；Check 未固定输入的实际解析 digest 没有通用公开回读入口 | 类型资产提供版本目录、可用性和必要的解析证据；UI 明确选择并提交精确引用 |
| US-09 清理旧缓存 | 资产来源有关闭时清空缓存；执行临时目录由 worker 生命周期清理 | 没有选择性清理 API、在用保护或删除结果契约；不能把关闭来源当“清缓存” | 资产所有者定义范围、并发与在用保护、逐项结果；UI 不承担路径删除 |
| US-10 同机收藏、模板 | 原始任务输入可表达类型和 artifacts/subject；本机存储可独立于任务服务 | 无现成收藏模块或多 Endpoint 收藏契约 | UI 自有本机状态；保存完整类型输入和目标关联，不为此增加账号/同步 |
| US-11 Endpoint 历史与重做 | 已知 taskId 可取快照，再用 requestId 取原始请求；SQLite 持久化任务与事件 | 没有全量任务列表及类型/时间筛选；用户已明确需要 Endpoint 历史，而非本机索引；保留期不是永久保证 | 通用服务侧补充获授权的历史列表和类型/时间查询，保留与清理由 Service 配置治理；UI 查询并以原参数直接或编辑后重做 |

任务及 HTTP 证据见 E1–E5；资产与版本见 E6–E9；工程与接入见 E10–E12。

## 影响产品选择的事实

### 1. 自动表单需要两层信息，而不只是一个类型列表

通用请求把 `type`、`timeoutMs`、`eligibleAt`、`seriesId`、`executionMatch`、`recurrence` 与类型输入放在同一 JSON 对象中；Engine 移除通用字段后调用该类型的 validator。不能擅自改成统一的 `{ input: ... }` 包装（E1、E3）。

Check 类型输入含 `checker`、`subject`，可选 `context`、`language`；Probe 含 `objective`、`subject`，另有 bindings 等字段。两者的具体 subject schema 来自所选 Checker/Objective manifest，并在准备阶段验证（E6、E8、E9）。因此：

- 只知道“Check 的 subject 是 object”不足以生成具体字段。
- 任务类型描述与“所选精确制品的 subjectSchema”都需要可信公开来源；当前均没有对应的 HTTP 发现入口。
- 仓库已有 JSON Schema/Ajv 校验基础，但不能从任意 JavaScript validator 自动推导 schema。提供 schema 时应与真实 validator 一致，不能在 UI 再硬编码第二套业务真相。
- 建议先用实际 schema 确定表单支持范围；遇到不支持的结构应明确提示，不能伪造字段。是否提供补充 JSON 编辑入口仍是交互选择，不以其替代按类型填表。

### 2. 已有调度事实够做实验，但不能画成全局资源大盘

相同 `executionId` 和 `task.allocation.bound` 能证明已观察任务共享一次执行。共享还受类型/版本、环境、scope、输入与 Prepared 相等性、时间匹配策略影响；相同表单输入不保证所有情况下都合并（E3）。

`execution.reclaimed` 在执行跟踪确认回收后持久化，可展示为该执行的回收事实。单独的 `canceledAt`、完成结果或停止接收事件都不能替代这一证据（E4）。

需要特别避免两种误导：

- 已取消 Task 的 stage 可以冻结为 `running`；已超 deadline 的 Task 也可能仍是 `queued`，或者后来完成。UI 应组合展示 stage、取消、超时与执行事实，不能只画互斥的状态色块（E2、E5）。
- 按 executionId 查询返回执行历史，不是所有 owner 的目录；只掌握三个任务，就只能声称观察了这三个任务。Check 的池诊断目前是进程内属性，不是公开 HTTP 遥测（E3、E6）。

Probe 已产生 child、child.started、child.completed 等类型 progress，并保留子任务身份；可先显示原始详情，不能把 Probe 的事件结构强制解释为每一种任务都拥有的关键过程（E9）。

### 3. “历史事件”和“历史任务列表”是两件事

历史 API 要求 taskId、executionId、seriesId 中恰好一个过滤条件；它不能列出“此服务器以前有哪些任务”。已有 taskId 可通过快照中的 requestId 查询原始请求（E1、E3）。

历史分页有固定 watermark，分页 `next` 与转接 SSE 的 `cursor` 不同。无 resume 的 SSE 从当前边界开始，不会自动返回全部旧事件；完整回看需分页后接续，按 sequence 去重，遇到 `history_expired` 明确显示缺口（E1、E3、E5）。

Engine 默认 retentionMs 为一天，但 collect 是整组不活跃引用关系的保守回收，不是“每条任务恰好保存一天”；这是可配置实现事实，不应直接成为 UI 的历史保存承诺。回收后原请求也可能不可获取（E3）。

**后续访谈已明确范围：** 用户需要查询该 Endpoint 上的所有历史任务，包括其他工具提交的任务，而不是本机已知任务清单。保存期限、是否清理以及定期清理由 Service 配置和治理；UI 如实展示当前权限及保留范围，不另外决定历史保留期限或恢复已被清理的内容。原先“本机已知历史”的候选不能满足这项需求，不作为替代方案。

因此服务端公开历史列表/检索是必要依赖，不仅是 UI 增加本机存储。用户进一步明确基础查找按任务类型和时间；按 Input 参数筛选仅是后续高级候选。时间口径及具体协议仍待收敛，不能把对局部已加载页的筛选当作全范围查询；不预设新增通用查询语言、全局事件订阅或绕过 scope 授权，也不默认增加 UI 治理控制台。

### 4. 当前“缓存”不是一个可直接管理的磁盘目录

需要区分至少四种对象（E6–E8）：

1. `createArtifactSource` 的进程内缓存：默认最多 32 条，按 scope、kind、URL、精确 digest 区分；满时显式拒绝，不自动淘汰；关闭来源会终止其操作并清空缓存。
2. 每个任务持久化的 Prepared：包含经验证的精确文件内容，用于恢复原执行，不是公开缓存目录。
3. Check worker 的逐执行临时目录：执行器拥有并负责回收，不可让 UI 当作旧缓存任意删除。
4. `check-artifacts` 另有 `prepareCheckArtifact` 磁盘缓存入口，但它不等于 Check/Probe 当前 `createArtifactSource` 的管理面。

因此，“手动清理旧缓存”需要先由资产侧定义明确的清理对象及安全规则。建议管理能力只接受受控资产标识，逐项返回结果；不接受任意路径，不修改运行中的快照、持久化恢复数据或原始制品。

进程内缓存返回克隆，Prepared 又保存精确内容，不能据此推导“清理永远安全”：Probe 运行期间还可能解析动态 Objective，精确缓存也可能是原地址被删除后的唯一可用来源。清理与并发解析、历史版本可用性的关系仍需资产所有者定义。

### 5. “恢复旧任务”“重试提交”“重做新任务”必须分开

- 恢复既有任务：引擎使用持久化绑定及 Prepared，不静默下载新内容。
- 重试同一次提交：保留原 ULID 和完全相同的原始请求；不同意图沿用键会冲突。
- 从历史或收藏重做：套用当时用户填写的参数，创建新提交身份，而非恢复旧执行；用户未修改的参数不应被 UI 静默改写。生成身份与用户可填写的时间/series 参数须区分，具体通用参数表单仍需对照协议，不复制旧 requestId 冒充新任务。

未固定 digest 的新请求会重新读取来源。相同 URL 的内容变化后，新任务可能运行新版；精确 digest 已缓存且仍获授权时，即使原文件删除也可能命中缓存，但跨服务重启不能依赖这个进程内缓存（E7）。

尤其是 Check：原始请求只保留用户提交的引用，解析后的精确 digest 在 Prepared 中；公开事件会移除 Prepared，业务结果也没有通用的解析版本字段。因此，不能承诺“任何旧任务都能按当时实际版本重做”。用户已明确重做仅套用原参数，不要求自动锁定上次实际版本；不能再以这项未提出的保证为由强加解析证据接口或永久内容归档。其他明确版本选择/观察需求如需解析证据，应由相应故事单独确定，不能让 UI 直接读取 Engine 的内部数据库（E3、E6）。

**调研后的用户确认：** 收藏与历史重做采用相同的原参数模板语义，均可直接发起或编辑确认后发起。固定引用不自动升级，浮动未锁版本允许更新，浮动已锁版本仍原样提交并如实报告可能的不匹配；UI 不按上次实际解析结果自动补锁或解锁。这不要求固定上次实际版本，也不承诺内容永久可用，见[需求确认稿 US-10、US-11](Requirements.md)。

## UI 接入与本机存储的候选方向

这些是调研建议，不是已选架构或实施授权：

- 独立 UI Server 提供页面、受限后端代理和本机状态；Task Server 继续独立启动、退出。UI 只关闭自己拥有的观察连接，不调用 Engine 的 close。
- 为配置好的 Endpoint 分配稳定逻辑 ID，并展示名称与目标地址；收藏记录目标 ID 和完整类型输入。凭据仍在可信服务端配置中，不进入收藏、浏览器或导出内容。若目标被移除或地址被重新绑定，应明确提示，不能自动改投当前选中的服务；具体迁移规则待讨论。
- 优先考虑由本机 UI Server 管理持久状态：不绑定某次页面或开发端口，不需要账号体系。浏览器存储实现较轻，但按 origin/浏览器隔离且可能被清除；应基于用户的同机使用方式选择，不能声称已有定案。
- 收藏属于 UI 自有本机状态；历史列表的权威来源是 Endpoint 的公开服务能力。UI 不直接读取 Task Server 的 SQLite 内部表，也不用自己的历史索引冒充服务端列表；不需要现在就决定收藏用 JSON 文件还是 SQLite。
- 仓库目前的 workspace glob 只有 `packages/*`，没有已纳入的 `apps/*` 或现成 React/Vue/Svelte/Vite 应用依赖。按项目规范新增可执行 UI 时需要补 workspace 覆盖并接入已有 build/lint/test/typecheck；本次不提前改配置或选前端框架（E10）。
- 既有 Check Host HTML 是旧 `/checks` 协议的操作手册，不是可直接复用的通用任务 UI。不能据此引入旧 Host 执行器或协议（E11）。
- “不做账号体系”只排除收藏账号/同步系统，不取消独立 UI 代理的访问控制、凭据保护及非 loopback 暴露边界。现有后端鉴权可复用其协议，但不会自动替 UI 完成这些工作（E1、E12）。

## 后续建议

现在不需要再做一轮无边界的需求访谈，也不适合直接开工。收藏与历史重做的原参数模板语义、Endpoint 历史范围、类型/时间基础筛选和 Service 治理归属均已确认；后续围绕未决的同机收藏及多 Endpoint 使用场景继续访谈，具体时间口径与服务协议一起细化，不重复询问已决定的问题。

技术侧应分别跟进通用类型发现、类型资产管理/subject 元数据以及新增明确的 Endpoint 全量历史查询依赖。解析版本证据只在其他具体场景确有需要时补充，不作为原参数重做的前提。不为解决缺口擅自修改 Check/Probe/Regulate 的其他 idea，不把已缺失的能力从需求中删掉。

## 后续独立追踪

2026-10-30 用户同意在 Task 定义层用 Schema 替代作者提供的 validate、equals，并要求先拆分独立 ideas。已建立：

- [task-type-schema-discovery](../../../../01M66MRFCSDK99MAEN8RN3NKBH/outer/inner/ideal/Idea.md)：Task 输入声明、生成校验/判等与受控类型发现。建议沿用 JSON Schema Draft 2020-12 的标准语义并明确运行约束，表单能力单独分层；判等建议沿用 canonical JSON，但这些细则尚待确认。
- [task-type-artifact-management](../../../../01M66N2BDVY4B6VAHVEEVB94EW/outer/inner/ideal/Idea.md)：类型资产查询、精确版本、subject 元数据与受限清理；不是通用内核的业务资产管理器。

两个 idea 均只记录准备材料，未实现或验收；上文基线中的缺口仍然存在。UI 的收藏、历史重做和 Endpoint 体验继续在本 idea 讨论，不因拆分而删减故事或继承开工授权。

## 证据索引

| 编号 | 本地源码或现有测试，行号对应调研基线 | 支撑内容 |
| --- | --- | --- |
| E1 | [HTTP handler](../../../../../../packages/task-engine-http/src/index.ts)，L80、L148–225；[协议类型](../../../../../../packages/task-protocol/src/types.ts)，L17–45、L171–230 | 完整路由集合、身份、过滤、SSE、TaskType/TaskService 形状 |
| E2 | [projection](../../../../../../packages/task-protocol/src/projection.ts)，L4–16、L168–232 | 时间匹配、快照投影、取消与超时独立维度 |
| E3 | [Engine](../../../../../../packages/task-engine/src/engine.ts)，L42–97、L257–380、L494–520、L612–684、L970–1191 | 输入拆分、幂等、共享、已知 ID 查询、公开事件脱敏、分页订阅与保留期 |
| E4 | [Engine 回收](../../../../../../packages/task-engine/src/engine.ts)，L722–747、L875–924 | 回收事实来自 tracking/执行器确认，不从 Task 状态猜测 |
| E5 | [HTTP tests](../../../../../../packages/task-engine-http/test/http.test.ts)，L8–180；[Engine tests](../../../../../../packages/task-engine/test/engine.test.ts)，L104–173、L209–248、L379–414 | 原请求查询、鉴权、断流、过期 cursor、共享取消、超时与分页恢复 |
| E6 | [Check 类型](../../../../../../packages/check-task/src/index.ts)，L35–118、L218–302；[Check tests](../../../../../../packages/check-task/test/check.test.ts)，L140–187、L278–385 | 真实输入、精确 Prepared、仅进程内 diagnostics、业务结果与公开历史 |
| E7 | [ArtifactSource](../../../../../../packages/check-task/src/prepare.ts)，L21–142；[source test](../../../../../../packages/check-task/test/source.test.ts)，L13–83；[file-source test](../../../../../../packages/check-task/test/file-source.test.ts)，L274–306 | 缓存结构、授权、容量、精确命中及不固定版本的读取语义 |
| E8 | [制品契约](../../../../../../packages/check-artifacts/src/contracts.ts)，L16–50、L232–233、L307–328；[旧磁盘准备入口](../../../../../../packages/check-artifacts/src/index.ts)，L248–300；[Check worker](../../../../../../packages/check-task/src/worker.ts)，L25–59、L100–197 | 制品 subjectSchema、digest、不同缓存/执行目录及结果边界 |
| E9 | [Probe contracts](../../../../../../packages/probe-task/src/contracts.ts)，L30–105；[Probe 类型](../../../../../../packages/probe-task/src/index.ts)，L201–279、L353–405；[Probe tests](../../../../../../packages/probe-task/test/probe.test.ts)，L138、L217、L279、L299、L345 | Objective bindings、子任务事件、精确证据与隔离父任务容量 |
| E10 | [workspace 配置](../../../../../../pnpm-workspace.yaml)，L1–40；[根包](../../../../../../package.json)，L11–44；[Turbo](../../../../../../turbo.json) | 工程现状、无现成前端框架依赖、验证入口 |
| E11 | [Check Host 手册](../../../../../../docs/check-host-manual.html)，L142–168 | 旧 `/checks` 操作说明，不是通用 `/tasks` 应用 |
| E12 | [Server](../../../../../../packages/task-engine-server/src/index.ts)，L9–35、L56–132；[Probe 组装例子](../../../../../../examples/task-server/probe-config.mjs)，L6–40；[SQLite Store](../../../../../../packages/task-engine-storage/src/index.ts)，L25–85 | 可信注册与权限、资源所有权、内部存储不是 UI 接口 |

本报告为源码与既有测试的能力核查，没有执行新的浏览器验收或客户 Endpoint 验证；工程校验结果在本次会话交付说明中报告，不作为功能已交付的证据。
