# 任务引擎 Web 工作台

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

首次连接需后端具备当前 `GET /task-types`、quoted `If-Match`、`GET /tasks`、
`GET /runs` 及请求/任务/事件接口；旧服务缺 Run 目录时明确报错，不用本机已见
Run 代替。`list-runs` 是独立授权操作；它与 Task 的 `list`、`submit`、
`request`、`task`、`history`、`subscribe` 均不互相授予权限。发现失败不关闭目录入口。
任务星标需要 `task` 和 `request`：UI Server 经这两个公开接口核对来源并保存原参数。

### Endpoint 与访问边界

- UI 只接受 `127.0.0.1` 或 `::1` 监听，默认 `127.0.0.1:4310`；
  `port: 0` 使用临时端口。未实现远程用户访问控制，拒绝非 loopback，
  不要经反向代理公开该服务。
- 浏览器必须使用启动日志中的准确地址；Host 必须匹配，Origin 若存在必须
  同源，修改请求必须有同源 Origin 和会话 CSRF 头；拒绝跨站 Fetch Metadata。
  重启后浏览器需刷新以获得新会话 token。
  更新 v0.6 只需重建并由授权操作者重启 UI，继续使用原配置、环境凭据和
  favoritesFile；不要用演示 fixture 替换现有 Backend，不需要数据迁移。
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
总计 200 项。目录最多保留最近 1000 条已加载摘要，释放前页明确标记，可重新查询。
各 Endpoint 观察列表最多保留 200 条 / 8 MiB 快照，选中对象详情独立保留；释放本机
视图不取消后端 Task。
这些是 UI 保护，不是服务治理配置。UI 不清理后端任务、历史、执行或资产。

## 操作

- **行内图标**：详情、重做/编辑、观察刷新/暂停、历史重读、草稿上移/下移及保存模板
  的查看/编辑使用单个 Lucide glyph。鼠标悬停或键盘聚焦显示中文提示，按钮有完整
  可访问名称；Esc 可关闭提示，Enter 仍执行原动作。新建、提交、实体名称、取消、
  未知回执重试保留文字，不把所有按钮机械图标化。`data-action` 和稳定 key 不变，
  图标按钮另有 `data-glyph-action`，不会因文字隐藏而改变提交身份或业务回调。
- **两个主 Tab**：标题、任务/执行 Tabs、受控服务选择、任务栏入口合在紧凑顶栏。
  默认任务页，整合当前/历史目录、筛选、选中详情与星标。
  执行页查询整个 Endpoint 获授权且保留的执行记录。一次只有一页进入布局和
  键盘顺序；Tab 箭头键、弹窗 Esc/焦点回归可用，跨 Tab 保留筛选、选中项和输入。
- **全宽列表与详情抽屉**：两个目录独占页面可用宽度，点击任务/执行后从右侧覆盖，
  不缩窄表格、不改筛选、原分页或列表滚动。关闭按钮、Esc 和宽屏遮罩可关闭，
  焦点回原入口；跨实体跳转只保留一个模态层。窄屏抽屉占满视口，内容内部滚动。
  关闭详情不取消 Task；观察事实及其历史分页对象独立于抽屉生命周期。
- **新建弹窗**：点“新建任务”，先发现当前类型，再选择类型；关闭重开保留本次
  表单（包括尚不合法的字段文本），提交成功关闭弹窗并定位新 Task。常用标量、枚举、数组、嵌套属性、
  本地引用生成表单。自由 object 和复杂组合字段提供局部 JSON 编辑及约束查看。
  可选字段需明确勾选；不强转原参数、不补 schema 默认值、不删除额外属性。
  数值字段输入 JSON 数字；完整 Schema 校验由 Task Server 执行。UI 不调用 Equals。
  `$ref` 带同级校验约束时保留联合语义，使用明确的局部 JSON 编辑，不浅合并或覆盖
  引用中的字段/required；属性读取仅使用原参数的 own properties。
- **提交任务栏**：顶部入口跨 Tab 常驻，展开草稿/回执面板，不是第三个主 Tab。
  直接提交自动建立独立单条批次，不动多条草稿。多条可以
  上下排序；发送只等待逐条提交回执，不等任务完成，中间拒绝/未知继续后项。
  同次重试保留 ULID、参数及 quoted revision。未知后遇 412 仍是未知，不能
  推断旧 Task 不存在。用“核对原 requestId”或原身份重试核对；主动再做一次
  明确生成新 ULID，可能产生另一 Task。成功项不会被整批重发。
  快捷提交合并 300ms 内的重复激活，即使首个回执很快返回也不把双击解释为主动新做；
  这只是交互防重，不取代服务 Idempotency-Key。
- **契约变化**：412 留下原参数及身份。重新发现不会自动重发；变化后需明确
  “按当前契约重新编辑”。原请求重试不换 guard；业务 digest 与 guard 无关。
- **Task / Run**：独立 Tab，以服务提供的 runId 关联。完整请求
  单独读 `/requests/:requestId`，Task 快照显示取消/阶段/结果/错误与关联 Run；
  Run 查看准备前开始、progress、逻辑完成、失败、封存和回收事件。未观察到回收
  不表示仍占资源。Run 详情通过 `GET /tasks?runId=…` 取得独立授权的已绑定
  关联任务，不扫描事件来拼执行目录，也不推测所有 owners/worker 统计。`ok:false`
  结果不会被标为系统执行错误。
- **事件**：首次历史页的 stream cursor 接续 SSE，历史 next 独立分页。按
  sequence 去重，过滤后的序号跳跃不直接推断缺口；断流、失效、未加载历史、
  窗口截断均标明。可逐页查看全部可取的公开事件，公开协议隐藏的内部过程不猜测。
  实时区按稳定对象/事件键更新 DOM，保留 disclosure 展开及键盘焦点。Task 快照按
  来源保护：watermark 只用于 SSE 之间的排序，普通 GET 使用本地读世代；
  HTTP 回执没有可比较的水位，不从 lastSeen 推测其位置。已确认取消依据公开契约
  冻结完整 Task 事实，旧 GET/SSE 不能撤回，独立取消回执不会被在途观察丢弃；
  后续同一取消快照只更新观察时间，Run 事件仍继续接收。
  timestamp 仅为观察时间，不用于版本排序。
- **观察收尾**：任务终结与关联执行逻辑终结/回收证据齐备后停止对应 SSE，显示
  “观察已结束”。执行自身要同时有逻辑终结和 reclaimed 事实；执行目录的终结/回收
  摘要也可提供这一证据。运行超时不是执行停止，迟到完成仍保留超时标签。
  取消后的未知释放关系不猜测，允许手动暂停。暂停/自动结束仅释放流，仍可分页历史；
  “重新观察”重新读取事实并建立新流（已结束对象会据实再次收尾），不创建或取消 Task。
- **任务目录**：整合在任务页，独立向后端查询，含其他客户端授权任务。类型精确匹配，receivedAt
  含下界、不含上界，必须填写带时区时间；固定 created-desc。目录 observedAt /
  expiresAt / 摘要不被 SSE 改写，翻页使用原过滤条件。410/query_expired 后明确
  重新查询，旧视图仅供参考。详情可能比摘要更新，摘要不含业务结果。
  页和错误状态绑定同一查询世代，旧查询的成功/失败不能覆盖新的结果或错误。
- **Run 目录**：直接 `GET /runs`，按 type / startedAt 的含下界、不含上界
  筛选，started-desc 排序，同刻 runId 升序。摘要不含输入、准备证据、结果、
  scope 或 Task 身份；共享执行只出现一次。执行目录游标与任务/事件游标分开，
  同样冻结 observedAt/expiresAt/成员/摘要，410 要明确重查。
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

1. 在任务页打开“新建任务”，`echo` 填 text、timeoutMs；`survey` 填 nested subject、active、scores。
   验证不同表单、普通自由对象、完整结果及事件。
2. 先加入多条，再单条快捷；检查草稿不被发送。准备三项并排序，中项填写不合
   Schema 的值，观察拒绝后仍提交后项。执行顺序由服务决定，不由 UI 保证。
3. 要演示共享，准备两个相同 echo 输入（含相同 durationMs），
   eligibleAt 设为同一未来时刻，第三项 text 不同；在资格时间前按序发送。
   两个同输入 Task 可在开始事件绑定同一完整 Run，另一项等待单资源。
   取消其中一个，另一 Task 不被取消；取消与 Run 回收分开观察。
4. durationMs 大于 timeoutMs 可观察运行超时后迟到结果；正常 `ok:false`
   是 fixture 的业务结果。关闭浏览器或只关闭终端 B，终端 A 继续执行。
5. 在任务页查询目录并打开原请求重做；切换执行页直接查询其他客户端执行，不需要先打开任务。
   切换“只读目录”验证发现/详情拒绝但两个目录可读；
   切换“独立 scope”验证数据隔离。
6. 在任务行标星、启用“只看收藏”，只重启终端 B，确认原参数/原目标保留；
   原参数发起新身份，编辑后发送不改原星标。观察完成且回收后不再持续更新时间，
   停流后仍可分页历史。用窄窗口和 Tab/Enter/Esc 操作两页、弹窗、任务栏和详情。

关键自动化入口：`#tab-tasks` / `#tab-executions`、`#tasks` / `#executions`（tabpanel）、
`#new-task` / `#create-dialog`、`#only-favorites`、`.star[aria-pressed]`、
`#bar-toggle` / `#submission-dialog`、`#directory` / `#execution-directory`、
`#task-detail-sheet` / `#execution-detail-sheet`（`[data-slot="sheet-content"]`）、
`#task-detail` / `#execution-detail`（抽屉内容）、`[data-close]`。
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
覆盖权限/作用域、两种 Schema、guard/身份、批次、目录快照/失效、
Task/Run、取消/超时/断流、收藏重启与重做。`test/model.test.ts`
补充丢回执后 412、迟到响应、游标/去重、DOM 表单和参数保持。
`test/presentation.test.ts` 与实际 browser entry 测试使用 jsdom 26.1.0，
覆盖 React/Radix 所有权、键控焦点、单层切换、原字段节点保留、忙状态与快速双击；
纯 Schema 测试继续使用 linkedom。实际布局、原生键盘与 CSP 以独立 Chrome 脚本为准，
不以 DOM 模拟器冒充浏览器布局证明。
fixture 和自动测试不是生产部署或独立验收；正式审阅由主 Agent 执行。
