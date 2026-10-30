# task-history-query 独立消费验证

## 结论与来源

本阶段的五项 D-* 已由实际打包消费完成验证；没有发现生产实现 blocker。
本记录是执行证据，不是 submit/accept 或 gate 审批。

- 打包 checkout：`8ebcaa9a22d95553aa479a315c4ed88e11740f8b`。
- 生产实施提交：`533f88485acfa75fc00b5e349ff88b7cb2e18f26`；
  五个生产包与打包 checkout 的 Git 差异为空。
- 已接受 inner：`33a3627d9baf20f0741c0908e0a559d6c1426862`。
- 开始验证时已同步的 deploymentRevision：
  `23986aa273d235c16c4109a9edbf0e279bd5933d`。
  Deployment.md 未改；本次新增 supporting evidence 会形成新的 outer 修订，
  最终准确 revision 的同步、审查和提交由主 Agent 处理。
- 观察到的 events digest：`f9fc88a169fa6b1501162541114dd9de53356482`；
  未改 events、gateModes、inner、生产代码或其他 idea。
- Node `v24.12.0`、pnpm `11.22.0`；最终运行时间
  `2026-10-30T17:54:25Z` 至 `2026-10-30T17:54:32Z`。

完整的精确 SHA-256、包大小、源码树、模块实际解析路径、HTTP 断言证据和进程回收
见 [result.json](evidence/result.json)（约 27 KB）；没有保存冗长安装日志或数据库。
运行脚本见 [run.mjs](evidence/run.mjs)、[verify.mjs](evidence/verify.mjs)、
[host.mjs](evidence/host.mjs) 与 [client.mjs](evidence/client.mjs)。

## 隔离与可信控制面

操作自有目录为本工作树下
`.cache\task-history-query-proof-380a54dd-dddd-45ad-b78a-ddeb0be0ef0b`，
其 `consumer` 自带独立 package.json、pnpm-workspace.yaml 和本地 tarball overrides。
对 Server 的完整内部生产依赖闭包执行 `pnpm pack`：
protocol、Engine、HTTP、SQLite、Server，全部版本为 `0.1.0-rc.0`。
consumer 使用 `pnpm install --ignore-scripts`，store/cache 也在这个唯一目录内；
第三方依赖正常解析，内部依赖全部指向本次 tarball，不发布 npm。

服务子进程逐包验证解析文件的 realpath 位于 consumer 内，记录入口 SHA-256；
不是 workspace 链接、源码 import 或同进程 handler 调用。
HTTP 客户端 A 为 PID `3488`，独立客户端 B 为 PID `42600`。
测试身份由专属服务内固定映射决定 scope，不能通过查询参数设置 scope。

两次服务均以 `127.0.0.1:0` 请求系统分配端口，并在 IPC ready 后用
`GET /task-types` 的 HTTP 200 确认可用，再执行后续测试：

| 阶段 | PID | HTTP 地址 | 当前 echo 版本 |
| --- | --- | --- | --- |
| 初次启动 | 47644 | `http://127.0.0.1:64052` | 1 |
| 相同 SQLite 重启 | 42396 | `http://127.0.0.1:64236` | 2 |

可信控制面仅为父子 Node IPC，不暴露 HTTP 管理路由。它控制 fixture 执行器的
progress/completion、授权撤销、专属 Store 的显式 collect，以及**服务子进程内**
固定 Date.now。生产 Server 不提供注入 Clock 配置，因此 fixture 在该子进程覆盖
Date.now；真实网络、事件循环计时器和单调时钟保持不变。
queryLifetimeMs=`120000`、retentionMs=`2000`、executionWallMs=`600000`，
均使用既有公开可信配置。

fixture 只通过公开 Store 包装器计数 append/compact；不直接查询 SQLite，
不读取存储内容替代 HTTP 业务断言。所有目录、详情、原请求、Schema、历史 watermark
与失败 code 均来自独立客户端的真实 HTTP 响应。

## 契约覆盖

| 契约 | 可观察结果及证据 |
| --- | --- |
| D-S01 | 五包 tarball 闭包安装成功；consumer 内真实解析、哈希、两个客户端进程、独立 scope 和类型/时间样本均记录于 result。 |
| D-S02 | 下述十组外部断言全部通过；SQLite 关闭再启动后，新查询保持既有摘要，旧游标明确失效。 |
| D-S03 | 记录命令/输入/关键响应和真实重试；仅回收本次 PID/目录，并确认退出、端口拒绝连接和目录不存在。 |
| D-AC01 | 跨客户端发现、双时间交集、归属新进度、固定页摘要、重查、详情/原请求及读取无副作用均通过。 |
| D-AC02 | 撤权、非法/过期/重启/collect 游标失败路径、恢复、无自动清理及隔离回收均通过。 |

`result.proof.checks` 保存十组结果，断言的完整可执行定义在 verify.mjs：

1. A/B 在不同 receivedAt 提交相同未来 eligibleAt，启动后绑定同一 Execution。
   同 scope A/B 查询均得到三个 Task，另一 scope 只见自己的 Task。
2. `type + createdFrom/Before + updatedFrom/Before` 全部取交集。
   分别验证两个时间轴的含下界/不含上界、类型排除和 `+08:00` 等价边界；
   进度使两个已绑定活跃 Task 的 updatedAt 同步变为 `.400Z`。
3. 更新降序、同刻 taskId 升序；初页后取消、新进度、新增 Task，
   全部续页的成员/顺序/完整摘要保持原值，同游标重放一致。
   新查询包含新增与更新；取消 Task 停在 `.500Z`，共享伙伴进度更新至 `.600Z`，
   后续 completion 也不推进取消 Task。
4. 目录 IDs 可进入详情和另一客户端的原请求接口。原请求逐字段等于提交内容，
   嵌套对象/数组/字符串 `007` 不变，无 version/expectedRevision；
   用新的 requestId 可提交，数字字段传字符串返回 `400 invalid_input`。
   Schema discovery 同时可用。
5. 无身份 401、拒绝身份 403；reader 可 list 但不能读取原请求或 discovery。
   五成员、单条分页的四次 continuation **逐次撤权**均返回 403，
   每次恢复权限后才允许继续，不把旧游标当授权凭证。
6. 非法、篡改、换查询、换 subject、换 scope、事件游标六类均返回
   `400 invalid_cursor`；额外 scope 参数和重复 type 参数也被拒绝。
7. 所有执行器完成后重复目录/详情/原请求/discovery，公开历史 watermark=`47`、
   全部目录摘要及 prepare/execution/append/compact 计数均不变。
8. SQLite 服务重启，新查询与重启前完整摘要逐字段相同，原请求不变，
   旧游标返回 `410 query_expired`。当前 discovery 升为 echo v2，但旧目录仍 v1；
   从旧原请求以新身份和当前 If-Match 重做绑定 v2，原请求仍无 version。
   重启本身没有重新执行已完成任务。
9. 可信墙钟推进超过 lifetime，旧游标返回 410；重查仍保留六个同 scope Task，
   虽已超过 retention，摘要/计数/历史 watermark=`55` 仍不变：读取没有自动 collect。
10. 新建查询后仅通过 IPC 对该专属 Store 显式 collect 一次；compact 一次，
    旧游标明确 410，新查询两个 scope 都为空，旧详情/原请求 404。
    这里的空目录是显式清理的预期结果，不用空结果掩盖查询失败。

## 真实重试与边界

[attempts.json](evidence/attempts.json) 保留两次 harness 失败及清理证明：

- 首次沿用旧消费模式把 overrides 放 package.json；pnpm 11 忽略它，
  内部传递依赖 registry 404。改为 consumer 的 pnpm-workspace.yaml 后安装成功。
- 第二次先启动第一个 Task，较晚提交第二个，却错误期望共享早于其 eligibility
  的 Execution。实际两个 executionId 不同，断言失败。
  fixture 改为两个不同创建时刻、同一未来 eligibleAt 后通过；未修改产品或验收标准。

两次修正后连续两轮完整外部验证通过，最终证据来自最后一轮。没有产品失败被转为空结果。
这里只证明本地打包产物和专属 SQLite/HTTP 场景，不声称 npm 已发布、客户已迁移、
多实例共享游标或性能 SLA；游标仍按原契约为进程内上下文。

## 命令、验证与回收

在仓库根执行：

```powershell
pnpm --filter @potential-guide/task-engine-server... build
node .silvermoon\ideas\01M66TPNEMSQ8Y8SDSN2CDN6BA\outer\evidence\run.mjs
```

两条命令均 exit 0；run.mjs 校验固定 HEAD、生产源码差异和开始时契约 revision，
并保存五次 pack、一次独立 install 的命令/退出码。
四个 `.mjs` 的 `node --check`、显式范围 Biome format/lint 均通过。
仓库默认 Biome 排除 `.silvermoon`，因此本轮用操作自有的临时配置显式检查六个
脚本/JSON 文件，采用仓库的双引号、分号、2 空格和 100 列设置；配置检查后删除。

两次服务 close 都 exit 0，独立 TCP 检查均收到 ECONNREFUSED。
额外以具体 PID 检查 `3488/42600/47644/42396` 均已不存在。
本次唯一目录已递归删除并 stat 确认不存在；此前两次失败及前一轮成功目录也未遗留。
SQLite、WAL/SHM、consumer、tarball、私有 pnpm cache/store 一并回收。
没有操作来源工作树 `D:\Code\potential-guide`，没有遗留后台进程或客户资源。

最终 `silvermoon check --worktree --audience agent` 与 `git diff --check` 通过。
未 stage、commit、push、submit、accept；未重复运行与本次 supporting-only 变更无关的全仓
`pnpm check`，生产包已有 inner 阶段完整 check，本阶段独立外部结果不以单测替代。

## 主 Agent gate 审查

主 Agent 已审读打包隔离、真实 HTTP 客户端、可信 IPC fixture 与十组可执行断言，
核对结果与已同步部署契约一致；没有以测试夹具直接读取数据库代替公开查询结果。
两次失败属于已记录的验证夹具/安装配置问题，修正没有改变生产代码或验收要求。

独立检查 result 的 success、十组结果及进程退出记录，并再次核验两服务 PID 不存在、
两端口均拒绝连接、该 consumer 根目录不存在；worktree 校验与 diff 空白检查通过。
未发现阻止 outer gate 的问题。准确 outer 修订的 submit/accept 在此证据同步后单独记录，
不以本文替代生命周期事件，也不把本地隔离消费成功表述为 npm 发布或客户部署。
