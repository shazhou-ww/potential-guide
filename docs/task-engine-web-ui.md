# 任务引擎 Web 工作台

Run 详情的独立 **Logs · 诊断日志** 支持跟随/暂停、历史分页、按序号续接与
并发/切换隔离；浏览器保留最多 300 条 / 1 MiB，显示未知尾部、缺口、截断、
过期、不支持和故障。详见 [Run Logs 与独立安装](task-run-logs.md)。

`apps/task-engine-web-ui` 是可选、私有的 Node/TypeScript 应用。它独立于
Task Server，仅使用公开 HTTP 协议；不会创建 Engine、读其 SQLite、加载业务
执行器，或因抽屉/页面/流/UI Server 关闭而取消 Task。示例执行器只属于显式启动的
fixture，生产 UI 入口不导入它。

展示层采用真正的 React/shadcn/ui 组件，Tailwind 构建为本地静态 CSS，不依赖 CDN、
字体下载、路由或 SSR 框架。组件来源固定为 `shadcn@4.23.0` /
`96da9cc7f1aa10580a3741664e2a77c721206c00`，详见
[来源、许可及适配说明](../apps/task-engine-web-ui/src/ui/SOURCES.md)。

## 构建与连接现有服务

需要 Node.js 22.13+、pnpm 11.22+。在仓库根目录运行：

```powershell
pnpm install
pnpm exec turbo run build --filter=@potential-guide/task-engine-web-ui...
```

由可信本机操作员准备配置，例如 `ui-config.json`：

```json
{
  "host": "127.0.0.1",
  "port": 4310,
  "favoritesFile": "D:\\Private\\task-ui\\favorites.json",
  "endpoints": [
    {
      "id": "development",
      "label": "开发服务",
      "url": "http://127.0.0.1:3000",
      "binding": "development-scope-v1",
      "bearerEnv": "TASK_UI_BACKEND_TOKEN"
    }
  ]
}
```

在启动 UI 的进程环境提供 `TASK_UI_BACKEND_TOKEN`，然后运行：

```powershell
pnpm --filter @potential-guide/task-engine-web-ui start D:\Private\task-ui\ui-config.json
```

凭据只在 Server 端读取，作为 `Authorization: Bearer …` 发给配置好的后端。
没有认证需求的可信后端可省略 `bearerEnv`。浏览器只接收 ID、名称和不可逆目标
binding 指纹；不接收后端 URL 或凭据。相对 `favoritesFile` 按 **UI 进程的
工作目录** 解析，推荐绝对路径。不要将配置中的敏感内容或收藏提交到 Git。
收藏包含完整业务参数，应将目录放在仅当前操作员可读写的位置；本工具不是
本机其他用户或恶意本机程序的隔离边界。同一收藏文件只由一个 UI 实例使用。

连接需后端支持当前 Task Bundle 协议：`POST /tasks`、
`GET /requests/:requestId/status`、`GET /tasks`、`GET /runs` 及请求/实体/事件接口。
提交携带准确 Bundle URL 和完整内容 Digest，不查询 `/task-types`，不发送旧 `If-Match` guard。
旧服务或缺失接口明确报错，不用本机已见 Run 代替服务目录。
`list-runs` 是独立授权操作；它与 Task 的 `list`、`submit`、`request`、`task`、
`history`、`subscribe` 均不互相授予权限。没有提交或详情权限也不关闭目录入口。
任务星标需要 `task` 和 `request`：UI Server 经这两个公开接口核对来源并保存原参数。

### Endpoint 与访问边界

- UI 只接受 `127.0.0.1` 或 `::1` 监听，默认 `127.0.0.1:4310`；
  `port: 0` 使用临时端口。未实现远程用户访问控制，拒绝非 loopback，
  不要经反向代理公开该服务。
- 浏览器必须使用启动日志中的准确地址；Host 必须匹配，Origin 若存在必须
  同源，修改请求必须有同源 Origin 和会话 CSRF 头；拒绝跨站 Fetch Metadata。
  重启后浏览器需刷新以获得新会话 token。
  仅更新 UI 的前提是 Backend 已支持当前 Run 协议。旧 Execution 服务不能直接承载
  当前 UI；演示升级应另建匹配版本的隔离 fixture，不迁移旧演示数据。
  UI 不启动、迁移或清理 Backend；既有服务的停止和切换由操作者另行授权。
- URL 仅在可信配置中指定，支持 HTTPS 或 loopback HTTP、可选固定路径前缀。
  禁止 URL 用户名/密码、query/hash 和任何后端重定向。不转发浏览器的
  Authorization、Cookie 或任意头；只允许协议方法、路径、查询和必要身份头。
- CSP 不使用 unsafe-inline / unsafe-eval，脚本只允许 self；每份 HTML 提供随机
  style-only nonce，专供 Radix scroll-lock 的受信样式，禁止任意内联样式属性。
  不插入 HTML 业务内容。Schema 不加载外部引用，不访问
  输入 URL、制品或文件。
- 修改原目标 URL、身份环境变量名或 `binding` 会改变目标指纹。将原 ID 指向
  不同逻辑服务或权限范围时，操作员**必须更新 binding**。凭据常规轮换不必
  改 binding。旧收藏仍可读，但不能再发；必须明确创建面向新目标的新收藏，
  不会自动迁移。未声称能识别同 URL/同 binding 背后的未声明服务替换。

### 资源限制

请求体 64 KiB，普通后端响应 2 MiB，最多 32 个并发 UI 请求、8 个事件流、
64 个连接；普通代理超时 15 秒。事件流每 60 秒或 8 MiB 结束，由浏览器用
最后确认游标续接，不重提任务。异常最多连续自动重连 5 次；权限/过期错误停止
重连并要求显式重新观察。后端的错误状态码和错误事实不会伪装成空目录。

收藏最多 200 条 / 4 MiB，原子替换写入本机文件；最近事件窗口最多 500 条 /
2 MiB，清理会明确标记，历史当前页单独保留。任务栏最多 100 批次、每批 50 项、
总计 200 项。每个目录窗口/完整集合最多保留 10,000 条 / 8 MiB 摘要，
表格按本机页大小渲染已加载记录；超限明确失败，保留上次确认窗口，
不截断成员或推进游标。
各 Endpoint 观察列表最多保留 200 条 / 8 MiB 快照，选中对象详情独立保留；释放本机
视图不取消后端 Task。
这些是 UI 保护，不是服务治理配置。UI 不清理后端任务、历史、执行或资产。

## 操作

- **表格内查询与分页**：Task、Run 和任务收藏使用 TanStack Table，沿用现有
  React/shadcn/Tailwind 视觉，不额外引入组件主题。每个列头将标题、排序和筛选图标
  合为一行；所有筛选（包括收藏）均在弹出面板内，不展开或撑高表头。
  面板使用原生 Popover API，支持点外部、关闭按钮或 Esc 关闭，并保留输入；
  CSS anchor 定位使面板贴近触发图标且避开视口边缘，不被表格滚动容器裁切，
  不支持 anchor 定位时居中显示。需要支持 Popover API 的现代浏览器。
  已加载条数、实时/快照状态、水位、基线和查询错误统一位于表格底部，与分页同区，
  不再在表格上方占一行；实时信息换行只改变底部高度，不推移表头。
  关联 Run 筛选放在任务列筛选面板中。表格滚动容器预留滚动条空间，底部信息
  不参与滚动锚定，避免状态变化造成表头抖动。
  名称/完整 ID 搜索、状态筛选作用于已加载记录；Bundle Digest、带明确时区的时间
  范围仍通过表格底部“重新查询 / 刷新执行目录”提交服务端。收藏开关位于收藏列的弹出面板。
  底部支持每页 10/25/50/100 条、上一页/下一页和清除列筛选与排序；该清除操作不改
  服务端查询输入。原“目录下一页 / 执行目录下一页”独立加载原查询快照的下一批，
  不读取尚未应用的输入。未取得完整目录时，明确标示筛选、排序和页码仅针对已加载
  记录，不宣称服务端全量命中数或支持随机跳页。完整基线仍保留最多 10,000 条 /
  8 MiB 的预算，不再只展示前 1000 条。实时更新保留列筛选、排序、分页和弹出面板状态；
  数据缩减会收敛页码，新查询回到首页，切换 Endpoint 清除本地列筛选与排序。
- **Bundle 缓存**：与任务、Run 并列的独立页面，管理当前 Endpoint 机器上的内容缓存，不是浏览器本地文件。
  提供分页列表、大小/占用、声明契约及显式确认的单项清理；与 Task/Run 目录权限独立。
  忙碌内容清理被拒绝，清理不删除任务历史或原归档；后续运行可能需要重新获取。
  详细权限、并发与接口见 [Endpoint Task Bundle 缓存管理](./task-bundle-cache.md)。
- **数据行导航**：Task 与 Run 目录的类型是普通文字，不是按钮。点击数据行，或聚焦行后
  按 Enter / Space 打开详情；关闭 Sheet 回原行，表格仍保留真实 table/row/cell 语义。
  星标、重做/编辑及整个操作单元格（包括空白、禁用按钮和提示包装区域）独立处理，
  不再重复打开行。选中文字、拖选、修饰键和非主键点击不导航。
  Task 行不再保留重复的“详情”图标。
- **行内图标**：重做/编辑、观察刷新/暂停、历史重读、草稿上移/下移及保存模板
  的查看/编辑使用单个 Lucide glyph。鼠标悬停或键盘聚焦显示中文提示，按钮有完整
  可访问名称；Esc 可关闭提示，Enter 仍执行原动作。新建、提交、实体名称、取消、
  未知回执重试保留文字，不把所有按钮机械图标化。`data-action` 和稳定 key 不变，
  图标按钮另有 `data-glyph-action`，不会因文字隐藏而改变提交身份或业务回调。
- **三个主 Tab**：标题、任务/Run/Bundle 缓存 Tabs、受控服务选择、任务栏入口合在紧凑顶栏。
  默认任务页，整合当前/历史目录、筛选、选中详情与星标。
  Run 页查询整个 Endpoint 获授权且保留的运行记录，缓存页提供缓存列表、契约与单项清理。
  一次只有一页进入布局和
  键盘顺序；Tab 箭头键、弹窗 Esc/焦点回归可用，跨 Tab 保留筛选、选中项和输入。
- **全宽列表与详情抽屉**：两个目录独占页面可用宽度，点击任务/执行后从右侧覆盖，
  不缩窄表格、不改筛选、原分页或列表滚动。关闭按钮、Esc 和宽屏遮罩可关闭，
  焦点回原入口；跨实体跳转只保留一个模态层。窄屏抽屉占满视口，内容内部滚动。
  关闭详情不取消 Task；观察事实及其历史分页对象独立于抽屉生命周期。
- **Bundle 引用**：新建任务使用单个 `Task Bundle 引用（URL#digest）` 字段，
  填写获取 URL 与完整 `sha256:` 摘要。共享协议辅助函数解析和校验后，
  请求仍提交结构化 `{url, digest}`。编辑重做从原引用拼合，不改写 URL 或摘要。
  任务/Run 目录、详情与提交回执展示完整引用为可选取的纯文本，不访问该 URL；
  长引用可换行，不改变列表导航。内容判等与缓存仍以 Digest 为准。
- **新建弹窗**：填写固定 `URL#digest` Bundle 引用、timeoutMs 和可选时间/匹配参数，
  在独立 JSON 对象编辑器输入业务字段。UI 不下载或执行 Bundle，不猜测其业务 Schema，
  不再从类型发现生成业务表单；完整输入校验由服务取得 Bundle 后按声明契约执行。
  业务字段不得覆盖 Bundle、Request 身份或通用时间参数。
  可选参数需明确勾选，不强转原参数、不补默认值、不删除额外业务字段。
  关闭重开保留本次表单及尚不合法的原文本。同步取得 accepted 与快照时定位新 Task；
  异步 preparing 则先保留任务栏回执，不伪造任务详情。
- **提交任务栏**：顶部入口跨三个 Tab 常驻，展开草稿/回执面板，不另占主 Tab。
  直接提交自动建立独立单条批次，不动多条草稿。多条可以
  上下排序；发送只等待逐条提交回执，不等任务完成，中间拒绝/未知继续后项。
  preparing 只表示 Request 正在准备，尚无 Task，也未开始 Task 超时；
  UI 定期查询 `/requests/:requestId/status`，accepted 后按真实 taskId 读取快照，
  rejected 显示明确拒绝。处理状态观察失败不撤回已确认事实，也不取消后端处理。
  同次重试保留 ULID、完整 Bundle 引用和原参数。提交结果未知时，后续请求被拒绝也不能
  据此推断原 Task 不存在。用“按 requestId 核对结果”或原身份重试核对；主动再做一次
  明确生成新 ULID，可能产生另一 Task。成功项不会被整批重发。
  快捷提交合并 300ms 内的重复激活，即使首个回执很快返回也不把双击解释为主动新做；
  这只是交互防重，不取代服务 Idempotency-Key。
- **契约与内容身份**：Bundle Digest 固定完整内容，名称只用于展示。
  修改 URL、Digest 或业务输入是新意图，需用新身份提交；重做不会偷偷改投最新内容。
  服务端拒绝旧类型发现 guard；UI 不提供双协议选择或自动迁移旧参数。
- **Task / Run**：独立 Tab，以服务提供的 runId 关联。完整请求
  单独读 `/requests/:requestId`，Task 快照显示取消/阶段/结果/错误与关联 Run；
  Run 详情直接使用 `GET /runs/:runId` 的快照，展示原始快照、进展、结果、故障、
  类型结果报告、停止请求、退出/恢复裁决和清理未知证据；不要求先读取关联 Task 或事件历史。
  有值才展示字段，`false`、`null` 仍是有效结果。结果报告、实际退出和资源回收分开：
  progress 或 outcome 不证明已退出，发出停止请求不证明已停止，清理未知不证明已释放资源。
  完成与失败时间取当前快照或目录摘要，不假造已不再存在的 `run.completed` / `run.failed` 事件。
  展开状态在实时更新中保留；历史和关联任务读取失败独立显示，不隐藏已取得的 Run 诊断。
  未观察到回收不表示仍占资源。Run 详情通过 `GET /tasks?runId=…` 取得独立授权的已绑定
  关联任务，不扫描事件来拼执行目录，也不推测所有 owners/worker 统计。`ok:false`
  结果不会被标为系统执行错误。
- **Task 展示状态**：列表、最近查看、关联任务和详情标题复用协议纯函数
  `aggregateTaskStatus(task, now)`，仅将语义标识映射为本 UI 的中文文案。
  主状态优先展示运行结局，再判断取消、超时，最后展示当前推进阶段；
  不再并列拼接“未取消”“时间 timeout”。取消或超时但运行未结束时提供提示，
  已终结后取消则说明需求已撤回。详情保留原始快照、取消时间和截止时间；
  当前已越过截止时间不表示结果逾期，已完成任务不会随时间流逝变成失败或超时主状态。
- **事件**：首次历史页的 stream cursor 接续 SSE，历史 next 独立分页。按
  sequence 去重，过滤后的序号跳跃不直接推断缺口；断流、失效、未加载历史、
  窗口截断均标明。可逐页查看全部可取的公开事件，公开协议隐藏的内部过程不猜测。
  实时区按稳定对象/事件键更新 DOM，保留 disclosure 展开及键盘焦点。Task 快照按
  来源保护：快照和事件按 dataDomain 与 revision 判断源位置，普通 GET 还使用本地读世代；
  不从连接活跃或同刻 timestamp 推测新旧。旧 GET/SSE 不能撤回已确认取消，
  独立取消回执不会被在途观察丢弃；取消并不冻结整个 Task，后续匹配 Run 的 stage、
  结果和退出事实仍可推进。
  timestamp 仅为观察时间，不用于版本排序。
- **观察收尾**：未匹配 Run 的 Task 确认取消后停止其 SSE；已匹配的 Task 即使终结或取消，
  仍可观察后续控制和 Run 事实，不因终态自动冻结。Run 自身要同时有终结和 reclaimed
  事实才停止对应 SSE，显示“观察已结束”；Run 目录的终结/回收
  摘要也可提供这一证据。运行超时不是执行停止，迟到完成仍保留超时标签。
  取消后的未知释放关系不猜测，允许手动暂停。暂停/自动结束仅释放流，仍可分页历史；
  “重新观察”重新读取事实并建立新流（已结束对象会据实再次收尾），不创建或取消 Task。
- **任务目录**：整合在任务页，独立向后端查询，含其他客户端授权任务。按 Bundle Digest 精确匹配，
  receivedAt 含下界、不含上界，必须填写带时区时间；固定 created-desc。完整基线使用集合 SSE，
  按完整源 revision 原子应用成员加入、更新和移出；尚有下一页时每 5 秒采样一次。
  采样从无 cursor 的新查询开始，按已加载页数读取同一冻结快照，全部成功后整体替换
  已加载窗口及其 observedAt、expiresAt、revision 和 next，不混拼新旧快照，也不保证窗口
  外成员实时。新窗口已完整时自动转为 SSE；翻页始终使用当前确认快照的 cursor 和原过滤条件，
  未提交的筛选输入不影响采样。刷新失败保留旧窗口并显示陈旧/错误，按 10、20、30 秒退避
  （上限 30 秒）；权限或无效查询错误停止采样，需要显式重新查询。
  页面隐藏时暂停采样，回到可见时继续；详情弹层打开、表格内键盘焦点或文字选区存在时，
  主目录暂不自动替换，避免移动用户正在操作的行。独立详情及原有选中 ID 不被窗口刷新重置。
  翻页/重新查询/切换 Endpoint/页面关闭使旧观察失效，不并发采样或让迟到响应覆盖新查询。
  手动翻页遇到 410/query_expired 后明确重新查询，旧视图仅供参考。
  本机预算不足或不完整基线不得截断后伪装成完整集合。
  详情可能比摘要更新，摘要不含业务结果。
  页和错误状态绑定同一查询世代，旧查询的成功/失败不能覆盖新的结果或错误。
- **Run 目录**：直接 `GET /runs`，按 Bundle Digest / startedAt 的含下界、不含上界
  筛选，started-desc 排序，同刻 runId 升序。摘要不含输入、准备证据、结果、
  Task 身份；共享执行只出现一次。Run 目录游标与任务/事件游标分开，
  使用与任务目录相同的完整集合 SSE / 分页窗口采样机制，410 要明确重查。
  Run 详情中的可读关联 Task 列表同样按完整基线或分页窗口观察，不推断全体 owners。
  Task/Run 详情保留原 SSE，尚未创建 Task 的 preparing / unknown Request 回执仍每秒核对状态；
  本地时间标签重绘不等于目录网络轮询。
- **星标/重做**：在任务行或详情标星，服务端成功取到完整原请求后才保存成功；
  同目标同 taskId 重复标星幂等。保存完整原参数、来源 taskId/requestId/receivedAt
  和 Endpoint，不含新提交身份/guard/凭据。“只看收藏”查询全部本机星标，不限于
  已加载目录页；源记录清理后仍显示“来源已清理”的保存模板，取消星标不取消 Task。
  原目标缺失/重绑的星标仍可查看，但禁止改投。历史无 Task 身份的旧参数收藏完整
  保留在新建弹窗的“旧参数模板”兼容入口，不冒充服务任务。
  历史直接或编辑后重做只取原请求、剥离 requestId，不注入摘要 version、不改
  URL/digest/seriesId/eligibleAt，不自动补锁或解锁。原参数无权读取或已清理时
  明确失败，不使用空输入；已有星标可以明确选用此前保存的完整副本。编辑重做也用
  新建弹窗，派生不会修改原收藏。
- **切换目标**：关闭自己持有的观察流、隔离迟到响应。原目标任务栏回执仍保留
  在原分区；切换不会取消或重新发送 Task。未加入任务栏的表单不是持久草稿，
  切换前请先加入任务栏或收藏。重启后仅收藏持久化；本次回执与观察集合不充当历史。

## 隔离浏览器验证（真实 Task Server）

以下两个进程各自独立启动。使用一个从未用过的、属于本次验证的目录，
fixture 拒绝覆盖已有配置/凭据。不要连接、停止或清理其他用户的服务。

终端 A（仓库根目录；保持运行）：

```powershell
$demo = Join-Path (Get-Location) ('.cache\ui-demo-' + [guid]::NewGuid())
pnpm --filter @potential-guide/task-engine-web-ui exec tsx fixture\main.ts $demo
```

记下输出中的目录路径；fixture 只使用内存 Store、单资源模拟执行器和随机端口，
不读写用户任务库。凭据写在拥有的 `credentials.json`，不打印值。

终端 B（仓库根目录）：

```powershell
$demo = 'D:\path\to\the-owned-fixture-directory'
$credentials = Get-Content (Join-Path $demo 'credentials.json') -Raw | ConvertFrom-Json
$credentials.PSObject.Properties | ForEach-Object {
  [Environment]::SetEnvironmentVariable($_.Name, $_.Value, 'Process')
}
pnpm --filter @potential-guide/task-engine-web-ui start (Join-Path $demo 'ui.json')
```

打开终端 B 打印的准确 URL（端口自动分配）：

1. 在任务页打开“新建任务”，填入终端 A 打印的 `echo` 或 `survey` Bundle URL/Digest，
   以及 timeoutMs。echo 的业务 JSON 示例为 `{"text":"hello","durationMs":100}`；
   survey 示例为 `{"subject":{"name":"demo","active":true},"scores":[1,2],"mode":"brief"}`。
   验证 preparing 回执不冒充 Task，accepted 后能打开真实任务、完整结果及事件。
2. 先加入多条，再单条快捷；检查草稿不被发送。准备三项并排序，中项填写不合
   Schema 的值，观察拒绝后仍提交后项。执行顺序由服务决定，不由 UI 保证。
3. 要演示共享，准备两个相同 echo 输入（含相同 durationMs），
   eligibleAt 设为同一未来时刻，第三项 text 不同；在资格时间前按序发送。
   两个同输入 Task 可在开始事件绑定同一完整 Run，另一项等待单资源。
   取消其中一个，另一 Task 不被取消；取消与 Run 回收分开观察。
4. durationMs 大于 timeoutMs 可观察运行超时后迟到结果；正常 `ok:false`
   是 fixture 的业务结果。关闭浏览器或只关闭终端 B，终端 A 继续执行。
5. 在任务页查询目录并打开原请求重做；切换执行页直接查询其他客户端执行，不需要先打开任务。
   切换“只读目录”验证提交/详情拒绝但两个目录可读；
   切换“独立 scope”验证数据隔离。
6. 在任务行标星、启用“只看收藏”，只重启终端 B，确认原参数/原目标保留；
   原参数发起新身份，编辑后发送不改原星标。Run 终结且回收后自动停流，
   Task 仍可继续观察取消与时间变化；停流后仍可分页历史。
   打开 Run 详情查看结果、故障与退出诊断，不把无历史权限误解为没有结果。
   用窄窗口和 Tab/Enter/Esc 操作三个页面、弹窗、任务栏和详情。

关键自动化入口：`#tab-tasks` / `#tab-executions` / `#tab-cache`、
`#tasks` / `#executions` / `#cache`（tabpanel）、`#bundle-cache`（缓存列表与详情）、
`#new-task` / `#create-dialog`、`#only-favorites`、`.star[aria-pressed]`、
`#bar-toggle` / `#submission-dialog`、`#directory` / `#execution-directory`、
`#task-detail-sheet` / `#execution-detail-sheet`（`[data-slot="sheet-content"]`）、
`#task-detail` / `#execution-detail`（抽屉内容）、`[data-close]`。
数据行使用 `#directory tr[data-row-action="task"]` 与
`#execution-directory tr[data-row-action="run"]`，完整 ID 在 `data-entity-id`；
`.entity-type` 是普通文字，`td[data-row-controls]` 是独立操作区。
`execution-*` 仅保留为现有 DOM ID，实际协议始终为 `/runs`、`runId`，不兼容回退旧接口。
Dialog/Sheet 关闭后不在文档中，不能再检查原生 `dialog.open`；
用 `[role="dialog"][data-state="open"]`，并等待入场动画结束后测几何。
`#form-fields` 由 Schema 编辑器独占 DOM，重新打开会挂回同一份原始字段。
其余组件由 React 独占渲染；不要直接改写其子节点。
不要对用户已有进程/浏览器页执行验证或清理。

用 Ctrl+C 先关闭 UI、再关闭自己启动的 fixture，确认两个进程退出后，仅删除
本次 `$demo` 目录。自动化测试也只在工作区 `.cache/ui-test-<uuid>` 建立并清理
自己拥有的文件/端口。

## 检查

```powershell
pnpm exec turbo run build typecheck test --filter=@potential-guide/task-engine-web-ui...
pnpm check
```

可选原生浏览器冒烟验证（需要已安装 Chromium/Chrome；输出目录必须尚不存在）：

```powershell
pnpm --filter @potential-guide/task-engine-web-ui exec tsx fixture\browser-smoke.ts `
  'C:\Program Files\Google\Chrome\Application\chrome.exe' `
  'D:\path\to\new-owned-evidence-directory' '9223,64319,61123,61144,62952,61109'
```

此脚本只启动自己拥有的随机端口 Backend/UI、全新的 headless 浏览器 profile，
不会附着现有 Chrome。第三参数为禁止连接的保留端口列表，可按环境指定。
验证真实组件、紧凑顶栏、方向键/Tab/Esc/遮罩、焦点回归、弹窗输入保留、SSE 焦点、
完整分页后的抽屉宽度/滚动/筛选保持、关联跳转、完成后停流、其他客户端执行、
390 CSS px 列表与抽屉，以及 nonce 样式可用、任意 inline script/style 被 CSP 阻止。
保存截图/checks.json；最终关闭自己的进程并删除自己 profile/临时收藏。
不能把用户既有 profile 或试用目录作为输出位置。

`test/integration.test.ts` 使用真实独立 HTTP listener 和现有 Task Server，
覆盖权限/作用域、两种 Bundle、异步受理/身份、批次、目录快照/失效、
Task/Run、取消/超时/断流、收藏重启与重做。`test/model.test.ts`
补充丢回执后的拒绝、迟到响应、游标/去重、DOM 表单和参数保持。
`test/run-diagnostics.test.ts` 使用实际 browser entry 验证没有历史或关联 Task 权限时仍可读取
Run 结果与故障，区分结果报告/停止/回收，保留实时折叠状态且不将业务内容作为 HTML 执行。
`test/presentation.test.ts` 与实际 browser entry 测试使用 jsdom 26.1.0，
覆盖 React/Radix 所有权、键控焦点、单层切换、原字段节点保留、忙状态与快速双击；
纯 Schema 测试继续使用 linkedom。实际布局、原生键盘与 CSP 以独立 Chrome 脚本为准，
不以 DOM 模拟器冒充浏览器布局证明。
fixture 和自动测试不是生产部署或独立验收；正式审阅由主 Agent 执行。
