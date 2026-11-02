# 实施验证记录

## 当前状态

**Windows SDK consumer 修复后的完整 Inner 候选已就绪，等待主协调代理独立复验。**
源码、直接业务链路、真实 Chrome 和完整生产 tarball 消费已贯通；
此前本代理 `pnpm check` 退出 0，但主独立完整检查在 SDK consumer 的
node_modules rename 报 EPERM；不能以此前通过或“环境暂态”忽略。
修复后四轮真实 packed SDK 定向消费、正/负对照和新增两项回归均通过，
重新执行的完整 `pnpm check` **退出 0**。I 项恢复完成；D 项保持未勾选。
下述独立消费不是旧 registry fixture 或主线程资源桥，也不表示生命周期已经接受。

前置完成事件提交 `275ac6d84eb66b885a69c57e50d8833698ab5c61`
已只读核对为 origin/main 祖先，前置 Inner/Outer 均有匹配 submit/accept。
未改前置文档或生命周期，也未改本 Idea 的 Ideal、Outer、events。
本实施代理未 commit、push、发布 npm 或创建生命周期事件。

## 实现入口与边界

- `task-protocol/src/bundle.ts`、`task-sdk`、通用 archive/files：
  固定 `$schema` 同时选择声明和通信契约；三份 Schema 的传递闭包、原字节锁、
  `$id`/相对引用/fragment/anchor 离线解析；自包含 CommonJS；
  Git SHA-256 tree Digest；流式下载/解包、路径/链接/重复/特殊文件及容量检查。
  SDK 在 Run 命令后才求值作者模块，握手不执行业务模块。
- `task-engine/src/bundle-engine.ts` 是根导出的生产 Engine，
  没有注册/当前版本配置或 discoverTypes。内部 `engine.ts` 保留协调器及低层回归
  fixture 的私有入口，不能将那些测试当作无作者依赖的生产消费证据。
- preparation 按 Digest 共享，逐 Request 保存完整原意图、可信 Caller、窗口资格及
  preparing/accepted/rejected。默认四个内容获取/验证槽位，有界排队不增加整体截止。
  accepted 与 task.created 同次 append/SQLite 事务，rejected 同样保持幂等。
  关闭宿主中止获取但保留 preparing；重启继续准备，不重演已开始 Run。
- `type-supervisor.ts` 直接启动验证后的 worker.cjs，跳过 Bundle 历史业务复验。
  runId/generation/startedAt/scope 可信且不能被 Input 覆盖。
  每 Run 独立 Worker；结果仍须验证并观察物理退出，回收是另一事实。
  Worker 不继承一般宿主环境/凭据，仅保留必要的 Windows OS 路径事实并清空 NODE_OPTIONS。
- 新 Facts/SQLite 格式 **5**；submission.preparing / submission.resolved /
  submission.results-forgotten 与 Task/Run 共用事实和源 revision。
  原始到达资格跨窗口/重启保留；新到达重试仍独立检查窗口。
  receivedAt 在最终创建时锚定，准备不消耗 Task timeout。
- GET `/requests/:id/status?waitMs=…` 与原请求查询分开；unknown/forgotten 不伪造 preparing。
  POST preparing 为 202、终态为 200。long poll 到期/断开不取消处理。
  token 保留从原 terminalAt 起算；清理不删 Task/Run，幂等依据另行保留。
  缓存按 Digest 跨 URL 复用；租约保护在用内容，历史查询不依赖缓存或旧业务代码。
- HTTP、TaskClient、Server、UI、Check/Probe、examples/scripts 使用固定 Bundle 引用。
  UI 无注册选择器，preparing 仅为 Request 回执；accepted 后另读真实 Task。
  终态不回退，Endpoint binding 不被静默改投。目录按完整 Digest 过滤，name 只展示、允许重名。
  旧收藏模板不自动改写或直接重做，编辑后须明确填写 Bundle 引用。
- Check/Probe 的 `.run` 是普通可打包回调，资源动作在其自包含 Worker 内完成，
  不调用通用 Engine 的业务资源桥。Checker/观察 Worker 源码由
  `scripts/embed-task-workers.mjs` 嵌入，运行时不读取作者安装目录。
  构建身份同步生成，`pnpm task-workers:check` 检查确定性与过期产物。
  当前执行中的业务结果/内容/证据核验保留；只移除 Engine 历史业务代码复验。
- M01–M04 复用原源前缀体系：合法额外 Input 字段也比较；只有未取消且当前 eligible
  可以新增匹配/调度；真实提前退出使 terminates 匹配失效，纯 now 回拨及 recovery
  stopped 保留。失效/后续匹配的历史、updatedAt、摘要、集合与冷重放一致。

## 命令与结果

环境：Windows，Node **v24.11.1**，pnpm **11.22.0**，真实 Chrome **156.0.8078.76**。
只在依赖清单调整后安装；没有发布或持久部署服务。

| 命令 | 退出 / 结果 |
| --- | --- |
| `pnpm install --ignore-scripts` | 0 |
| `pnpm --filter @potential-guide/probe-task... build` | 0，相关十一 workspace，含嵌入 Worker 生成 |
| `pnpm exec tsc -p tsconfig.test.json --pretty false` | 0 |
| `pnpm --filter @potential-guide/check-task exec tsx --test test\restart.test.ts` | 0，真实 HTTPS/file 两项进程重启 |
| `pnpm --filter @potential-guide/probe-task exec tsx --test test\restart.test.ts test\resource-release.test.ts` | 0，三项，含真实父子 Run 失联恢复 |
| `pnpm --filter @potential-guide/task-engine-http test` | 0，16 项 |
| `pnpm --filter @potential-guide/task-engine-server test` | 0，12 项 |
| `pnpm --filter @potential-guide/check-task test` | 0，20 项，业务负结果/内容/证据/资源核验保留 |
| `pnpm --filter @potential-guide/probe-task test` | 0，19 项，观察/Child 证据/权限/物理释放核验保留 |
| `pnpm run layers:check` | 0 |
| `pnpm task-workers:check` | 0，嵌入 Worker 及源身份与生成器完全一致 |
| `pnpm schemas:check` | 0 |
| `pnpm exec biome lint scripts examples\task-server` | 0 |
| `node scripts\check-packages.mjs` | 0，全部生产 tarball、隔离安装、公开 exports、全部消费场景 |
| `pnpm exec tsx apps\task-engine-web-ui\fixture\browser-smoke.ts "C:\Program Files\Google\Chrome\Application\chrome.exe" .cache\bundle-browser-eebd9954-9eee-4220-81ba-d5d54c013dc1` | 0，真实 Chrome，checks.json 与十张截图 |
| `pnpm check` | 修复后最新完整重跑 **0**；此前主独立 EPERM 与处置详见下节，未忽略该失败 |

最后完整 workspace 测试结果：SDK **3**、protocol **36**、Engine **154**、
Storage **47**、HTTP **16**、Server **12**、Check **20**、Probe **19**、Web UI **64**，
上述相关套件均零失败。UI 的十四条分页 fixture 使用真实最早 Run 时间作为过滤下界，
不以“一分钟内能跑完 fixture”的偶然速度替代过滤语义；未删除分页/失序/失效查询断言。
Chrome 的 Task 事件焦点测试等待真正的 Task 终结变化，不把独立 Run progress 当 Task 事件。

## Windows SDK consumer 隔离修复

主独立完整检查发现旧 SDK consumer 在同一 Node 进程加载 `/build` 后 rename
node_modules 为 author_modules 时 EPERM。旧实现将编译器/服务仍可能存活的进程与
依赖目录隔离放在同一生命周期，无法作为可靠的 Windows 验证；本轮不把该失败
忽略成“环境暂态”，也不声称仅一次旧实现定向通过就排除了问题。

改动限于 consumer scripts、两项脚本回归测试及本 Inner 证据：

- `scripts/check-task-sdk-consumer.mjs`：父编排仅用 Node 内置模块。
  SDK `/build` 在独立作者 Node 进程运行；复用既有 run() 的 **child close** 边界，
  不以 ready、构建完成消息或发送退出请求代替真实退出。之后才一次性隔离依赖，
  在新的 Node 进程消费成品，最后恢复目录。没有新增 sleep、重试或错误忽略。
- 新增真正的依赖可见性正/负对照：同一故意依赖 SDK 的 Worker，
  隔离前实际 import 成功，隔离后必须报 ERR_MODULE_NOT_FOUND。
  实际成品消费者也明确断言 SDK、Check、Probe 均不可 resolve 或 import，
  然后才执行完整 Worker 握手、progress、结果、ack/released。
  作者 callback.ts 和 task.yaml 均删除；没有改为源码消费。
- `scripts/check-task-sdk-consumer.test.mjs` 两项测试验证模块隔离正/负对照，
  以及消费失败必须原样失败并恢复依赖目录。这里的小型包是隔离机制单元 fixture，
  不冒充 SDK/业务生产证据；生产证明仍使用实际 packed SDK 与实际构建输出。
- `node scripts\check-packages.mjs --task-sdk` 是新增定向入口，
  使用真实四个 packed workspace 及 production consumer 安装。
  完整 `pnpm check` 仍执行全部消费者，未缩小正常流水线。

定向结果（Windows/Node24）：

| 命令 / 轮次 | 结果 |
| --- | --- |
| 修改前 `node scripts\check-packages.mjs --task-sdk` 一轮 | 0，本次未复现；不否定主实际 EPERM |
| `node --test scripts\check-task-sdk-consumer.test.mjs` | 0，两项全部通过 |
| 修改后 `node scripts\check-packages.mjs --task-sdk` 三轮独立安装/消费 | 均 0；每轮都有 visible、missing 与真实成品成功三个对照 |
| 最终增加 resolver-level 缺包断言后 `node scripts\check-packages.mjs --task-sdk` 一轮 | 0；不是依靠某个已存在包的传递依赖损坏来满足 import 失败 |
| `pnpm exec biome lint scripts\check-packages.mjs scripts\check-package-consumers.mjs scripts\check-task-sdk-consumer.mjs scripts\check-task-sdk-consumer.test.mjs` | 0 |
| 修复后 `pnpm check` | **0**，完整 layers/format/lint/typecheck/test/pack；含新两项回归、SDK正/负对照及全部原消费者 |

既有 Check/Probe 独立安装消费者没有降低约束，也没有改动任何业务语义测试。
本次修复不改变 V03–V09 的实现与证明；强化 V01/V10 的 Windows 成品隔离验证。
浏览器源码与产物未改，前述真实 Chrome 证据保持其原轮次含义，不冒充本次重新执行。

## 独立生产消费及外部复跑

`scripts/check-task-bundle-consumer.mjs` 由完整 pack 检查和
`node scripts\check-packages.mjs --task-bundles` 共同调用。
构建后可用后者只复跑本轮供应链场景：

```powershell
pnpm --filter @potential-guide/probe-task... build
node scripts\check-packages.mjs --task-sdk
node scripts\check-packages.mjs --task-bundles
```

它创建**两个独立的 production 安装**：作者端有 SDK/Check/Probe；宿主端只装通用
Engine/HTTP/Storage/Server，依赖遍历及 require.resolve 均证明没有 Check、Probe、SDK
或旧 Host。作者构建两个同名、不同 Digest 的 Bundle，随后移除 authored .ts/.yaml，
将作者 node_modules 改名为不可解析路径，再由独立 Node/TCP 宿主直接执行 archive。
没有源码链接、作者模块加载或主线程资源 bridge。业务归档是 Bundle 内不透明资源，
由业务回调自己的 Source 策略实际解析、核验和运行。

Check 真实返回 `ok:false` 及 `bad` problem，校验 prepared Checker Digest、executionId；
Probe 真实返回 `initial` 和该业务缺口，校验 Objective Digest、checker local ID、
内层 problem、Child Request/Prepared Digest、完整快照、实际 Run/history 及 Child
Bundle Digest。不是仅 assert callback 返回某个预制 JSON。
同一完整 pack 还运行 echo、Check HTTPS/file、Probe、CLI、SSE 补读、历史及 SQLite reopen，
既有业务结果断言未移除。旧 Host/Pilot 等范围外消费者继续通过，未改其实现。

Chrome 复跑使用**新的、仓库内、不存在的**输出路径；脚本拒绝覆盖 profile，
只使用并关闭自己拥有的 UI、Backend 和 Chrome，保护用户端口：

```powershell
pnpm --filter @potential-guide/task-engine-web-ui... build
pnpm exec tsx apps\task-engine-web-ui\fixture\browser-smoke.ts "C:\Program Files\Google\Chrome\Application\chrome.exe" .cache\new-bundle-browser-proof
```

成功证据：`.cache\bundle-browser-eebd9954-9eee-4220-81ba-d5d54c013dc1\checks.json`。
所有布尔检查通过：真实三态受理、表单草稿、焦点、键盘/表格语义、完整分页、
SSE 稳定性、抽屉与列表身份、星标、相关 Run 导航、窄屏、CSP、
暂停观察不取消、终态首次取消、取消后继续观察共享 Run、独立需求存活。
实际 app.js SHA-256 为 `6cf61ea3920015404e06ce9a9df88c4c3b951e83338ba55a0708021c7581463e`。

## V01–V10 映射

| 场景 | 可复跑证据 |
| --- | --- |
| V01 | SDK test；protocol bundle/schema；SDK独立作者进程退出后的依赖隔离、真实缺包负对照；独立生产 Check/Probe 作者/宿主安装与删除作者源后的实际执行 |
| V02 | check-artifacts archive/files；Engine bundle.test；SDK build/pack；Git tree/raw bytes、压缩元数据、链接/重复/路径/特殊文件/容量和摘要拒绝 |
| V03 | Engine bundle-admission；HTTP bundle-admission；同 Digest 跨 URL 缓存与逐 Request 独立校验/结果；生产无注册宿主 |
| V04 | Storage bundle-admission：accepted/rejected 的 beforeCommit/afterCommit 四个真实 process.exit(73)；准备跨重启/窗口；原子至多一个 Task；新重试窗口独立 |
| V05 | Engine/HTTP bundle-admission：受控长准备、最终创建锚点、waitMs 立即/到期、HTTP 断开不撤回；真实 Chrome Request 回执 |
| V06 | Engine bundle-admission/cache；Server bundle.test 删除 archive/cache 后重启；原 terminalAt、token 清理不删 Task/幂等、历史不取旧代码 |
| V07 | protocol schema/qualification；Engine schema-sharing 与 bundle-admission；额外合法字段、共享引用、Validate/Equals/幂等区分 |
| V08 | protocol qualification；Engine qualification-cancel/sharing；now 回拨、真实早退、pending/timeout/取消、starts 保留及替代资格 |
| V09 | qualification 源前缀/历史/updatedAt/集合与 SQLite 冷重放；Storage/Server 新域；真实 Check HTTPS/file 与 Probe 父子 running-crash 后 stopped、不重跑 |
| V10 | 全 HTTP/Server/UI 及 Check/Probe suites；独立生产 bundle 消费、公开 examples/CLI、真实 Chrome 全链路 |

SQLite crash 场景不是内存模拟：独立 Node 在真正事务提交前/后退出 73，然后同一数据库
恢复，恰有一个原终态、最多一个 Task。真实业务 running-crash 场景先观察外部 marker，
杀死进程，重启后保持原 runId、deadline、结果/历史，marker 没有再次出现；
recovery stopped 不伪造 exitedAt 或物理资源回收。

## 持久格式与公开错误边界

- 只使用显式 **v5 新域**，不迁移 v4；生产默认库名不偷偷变化。
  示例沿用原默认名称，操作者须设置新 TASK_SERVER_DATABASE。
  旧 registry 配置在打开库前拒绝；旧/混合格式在修改前拒绝。
  原库、WAL、SHM、owner 原字节不变的真实文件测试均通过。
- 原请求、处理结果、Task/Run、内容缓存各自有保留边界；
  preparing 不适用终态结果保留，查询不是重新提交。
- 新到达的认证/窗口/格式或可靠写入失败属于接口错误。
  已持久进入处理后的获取、归档、Schema、Input、准备容量错误保存为原 rejected，
  结果查询不重新下载或无限重试。同 ID 改原意图为 idempotency_conflict。
- 主要公开错误：invalid_request、unsupported_request、invalid_bundle、invalid_schema、
  unsupported_runtime、capacity_exceeded、bundle_digest_mismatch、bundle_fetch_failed；
  旧注册配置为 invalid_config，窗口为 request_expired/request_future。
  unknown 为 not_found，已清理为 record_unavailable。
  observation_aborted（HTTP 499）只结束观察，不得渲染为确认拒绝。
- 历史内容不可用不授权改 Digest、伪造业务结果或重跑原 Run。
  Check/Probe 依旧核验当前实际业务结果和因果证据；历史读取仅依赖通用事实/锁定 Schema。

## 剩余边界

- 实际生产/浏览器验证环境为 Windows + Node 24 + Chrome 156；最低 Node 22.13 和其他
  OS 的真实部署仍由 Outer 处理，本轮未发布 npm 或替用户部署。
- Worker 是隔离执行/退出裁决单元，不是安全沙箱；回调必须只接收可信执行授权，
  并负责确认自己的外部资源。crash 后 stopped 不等于外部 OS 副作用已撤销。
- Probe 的 Child 凭据属于明确的私有作者配置，示例不继承宿主一般凭据；
  含凭据 Bundle 不应公开分发或提交真实密钥。
- 不设置 preparation 整体截止是契约要求；运维应按宿主容量、请求状态和明确网络错误
  观察积压，不能把 long poll 到期当处理取消。
- 用户接受、primary 同步及 Outer 验证由主协调代理执行；本记录不代替任何接受事件。
