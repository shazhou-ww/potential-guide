# 任务引擎 Web 工作台

`apps/task-engine-web-ui` 是可选、私有的 Node/TypeScript 应用。它独立于
Task Server，仅使用公开 HTTP 协议；不会创建 Engine、读其 SQLite、加载业务
执行器，或因页面/流/UI Server 关闭而取消 Task。示例执行器只属于显式启动的
fixture，生产 UI 入口不导入它。

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

首次连接需后端具备当前 `GET /task-types`、quoted `If-Match`、
`GET /tasks` 目录、请求/任务/事件接口；旧服务或权限拒绝会明确显示错误。
`list` 独立于 `submit`、`request`、`task`、`history`、`subscribe`；
发现失败不关闭目录入口。

### Endpoint 与访问边界

- UI 只接受 `127.0.0.1` 或 `::1` 监听，默认 `127.0.0.1:4310`；
  `port: 0` 使用临时端口。未实现远程用户访问控制，拒绝非 loopback，
  不要经反向代理公开该服务。
- 浏览器必须使用启动日志中的准确地址；Host 必须匹配，Origin 若存在必须
  同源，修改请求必须有同源 Origin 和会话 CSRF 头；拒绝跨站 Fetch Metadata。
  重启后浏览器需刷新以获得新会话 token。
- URL 仅在可信配置中指定，支持 HTTPS 或 loopback HTTP、可选固定路径前缀。
  禁止 URL 用户名/密码、query/hash 和任何后端重定向。不转发浏览器的
  Authorization、Cookie 或任意头；只允许协议方法、路径、查询和必要身份头。
- CSP 无 inline/eval；不插入 HTML 业务内容。Schema 不加载外部引用，不访问
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

- **创建**：先发现当前类型，再选择类型；常用标量、枚举、数组、嵌套属性、
  本地引用生成表单。自由 object 和复杂组合字段提供局部 JSON 编辑及约束查看。
  可选字段需明确勾选；不强转原参数、不补 schema 默认值、不删除额外属性。
  数值字段输入 JSON 数字；完整 Schema 校验由 Task Server 执行。UI 不调用 Equals。
- **提交任务栏**：直接提交自动建立独立单条批次，不动多条草稿。多条可以
  上下排序；发送只等待逐条提交回执，不等任务完成，中间拒绝/未知继续后项。
  同次重试保留 ULID、参数及 quoted revision。未知后遇 412 仍是未知，不能
  推断旧 Task 不存在。用“核对原 requestId”或原身份重试核对；主动再做一次
  明确生成新 ULID，可能产生另一 Task。成功项不会被整批重发。
- **契约变化**：412 留下原参数及身份。重新发现不会自动重发；变化后需明确
  “按当前契约重新编辑”。原请求重试不换 guard；业务 digest 与 guard 无关。
- **Task / Execution**：独立区块，以服务提供的 executionId 关联。完整请求
  单独读 `/requests/:requestId`，Task 快照显示准备/分配/取消/阶段/结果/错误；
  Execution 查看开始、progress、逻辑完成、失败、封存和回收事件。未观察到回收
  不表示仍占资源；已观察关联任务不是全体 owners/worker 统计。`ok:false`
  结果不会被标为系统执行错误。
- **事件**：首次历史页的 stream cursor 接续 SSE，历史 next 独立分页。按
  sequence 去重，过滤后的序号跳跃不直接推断缺口；断流、失效、未加载历史、
  窗口截断均标明。可逐页查看全部可取的公开事件，公开协议隐藏的内部过程不猜测。
- **历史目录**：独立向后端查询，含其他客户端授权任务。类型精确匹配，receivedAt
  含下界、不含上界，必须填写带时区时间；固定 created-desc。目录 observedAt /
  expiresAt / 摘要不被 SSE 改写，翻页使用原过滤条件。410/query_expired 后明确
  重新查询，旧视图仅供参考。详情可能比摘要更新，摘要不含业务结果。
- **收藏/重做**：收藏完整原参数和 Endpoint，不含 UI 提交身份/guard/凭据。
  历史直接或编辑后重做只取原请求、剥离 requestId，不注入摘要 version、不改
  URL/digest/seriesId/eligibleAt，不自动补锁或解锁。原参数无权读取或已清理时
  明确失败，不使用空输入。编辑派生不会修改原收藏。
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

1. `echo` 填 text、timeoutMs；`survey` 填 nested subject、active、scores。
   验证不同表单、普通自由对象、完整结果及事件。
2. 先加入多条，再单条快捷；检查草稿不被发送。准备三项并排序，中项填写不合
   Schema 的值，观察拒绝后仍提交后项。执行顺序由服务决定，不由 UI 保证。
3. 要演示共享，准备两个相同 echo 输入（含相同 durationMs），
   eligibleAt 设为同一未来时刻，第三项 text 不同；在资格时间前按序发送。
   两个同输入 Task 可在开始事件绑定同一 Execution，另一项等待单资源。
   取消其中一个，另一 Task 不被取消；取消与 Execution 回收分开观察。
4. durationMs 大于 timeoutMs 可观察运行超时后迟到结果；正常 `ok:false`
   是 fixture 的业务结果。关闭浏览器或只关闭终端 B，终端 A 继续执行。
5. 查询目录并打开原请求重做。切换“只读目录”验证发现/详情拒绝但目录可读；
   切换“独立 scope”验证数据隔离。
6. 保存收藏，只重启终端 B，确认原参数/原目标保留；原参数发起新身份，
   编辑后发送不改原收藏。用窄窗口和 Tab/Enter 操作表单、排序、详情及历史页。

用 Ctrl+C 先关闭 UI、再关闭自己启动的 fixture，确认两个进程退出后，仅删除
本次 `$demo` 目录。自动化测试也只在工作区 `.cache/ui-test-<uuid>` 建立并清理
自己拥有的文件/端口。

## 检查

```powershell
pnpm exec turbo run build typecheck test --filter=@potential-guide/task-engine-web-ui...
pnpm check
```

`test/integration.test.ts` 使用真实独立 HTTP listener 和现有 Task Server，
覆盖权限/作用域、两种 Schema、guard/身份、批次、目录快照/失效、
Task/Execution、取消/超时/断流、收藏重启与重做。`test/model.test.ts`
补充丢回执后 412、迟到响应、游标/去重、DOM 表单和参数保持。
fixture 和自动测试不是生产部署或独立验收；正式审阅由主 Agent 执行。
