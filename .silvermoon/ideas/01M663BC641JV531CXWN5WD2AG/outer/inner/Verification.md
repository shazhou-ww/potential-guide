# 实现验证证据

## 边界与候选

- 日期：2026-10-31。实现基线：`2484b5b500c7e234ada734a262ca124041ac5f14`，
  本 idea 已有准确 `acceptIdeal#4`。
- 仅在 `task-engine-web-ui-implementation-d0b16149` worktree / 对应 agents 分支实现；
  没有修改 Task Engine、发现、目录或公共 DTO 的语义。没有修改事件、Review、
  ideal、Deployment 或 D-* ledger；没有推送、提交生命周期事件或自行接受。
- 入口：[应用](../../../../../apps/task-engine-web-ui/README.md)、
  [Server](../../../../../apps/task-engine-web-ui/src/server.ts)、
  [工作台](../../../../../apps/task-engine-web-ui/src/browser.ts)、
  [模型](../../../../../apps/task-engine-web-ui/src/model.ts)、
  [表单](../../../../../apps/task-engine-web-ui/src/form.ts)。
- 正式独立 review/acceptance 属于主 Agent。本文是实施者的实际验证记录，
  不是接受决定或生产部署证明。

## 自动检查

在指定 worktree，Node v24.12.0 / pnpm 11.22.0：

| 命令 | 实际结果 |
| --- | --- |
| `pnpm exec turbo run build --filter=@potential-guide/task-engine-web-ui...` | 6 个相关 workspace 构建成功 |
| `pnpm --filter @potential-guide/task-engine-web-ui build` | 成功，生成独立 Server 与 browser bundle |
| `pnpm --filter @potential-guide/task-engine-web-ui typecheck` | 成功，包含 src / fixture / test |
| `pnpm --filter @potential-guide/task-engine-web-ui test` | 18 tests，18 pass，0 fail / skip |
| `pnpm --filter @potential-guide/objective-monorepo-standard exec tsx --test --test-name-pattern="real repository" test\pilot.test.mjs` | 2 tests 通过，新应用的实际工作区标准通过 |
| `pnpm check` | 最终退出码 0；包含 layers / format / lint / typecheck / test / pack，隔离 packed consumers 全部通过 |

定向测试实际使用现有 `startTaskServer`、独立 Node listener、MemoryStore 和受限
执行池。UI 仅经 HTTP 接入，未用静态页或 mock 替代集成。模型测试中的丢包/412
注入专门验证未知状态规则，不被当作真实网络故障已全面模拟。

新增 `apps/*` 后，全仓检查曾发现真实工作区需要 package-owned objectives、
工具层分类及计数更新；已补齐。该独立 Node 工具位于 apps 的单路径布局声明
记录在根 objectives，未修改标准检查逻辑或放宽其他包边界。浏览器联调发现目录
不能假设后端 pageSize ≥25，已移除固定 limit，使用实际服务默认值。

## I-AC01：单任务与边界

- `integration.test.ts`：真实发现 echo / survey；不同 Schema 提交；quoted
  If-Match 与真实 412；原请求/原身份重试；类型错误没有强转为合法值。
- `model.test.ts`：生成标量、数组、嵌套本地引用和自由对象；保留额外字段、
  false/null/原参数；不插入 schema default；非有限 JSON 明确拒绝而非变成 null。
- 未知回执后重试保留 ID/guard，后续 412 仍未知；成功响应形状错误不转为成功。
- 真 HTTP 验证 loopback 拒绝公开监听、Host/Origin/跨站/会话 token、路径/方法/
  query allowlist、body 413、重定向拒绝、浏览器 Authorization 不覆盖后台凭据。
- 8 个流的上限及断流释放已验证；关闭 UI 后，独立后端的运行 Task 正常完成，
  canceledAt 仍为空；正常业务 `ok:false` 的 Task stage 为 completed、无 error。

## I-AC02：多条与观察

- 三项批次中项被拒仍接受后项；先创建多条草稿，再快捷提交，草稿保持 draft；
  重发批次不发送已成功项。未知项同样不阻塞后续项，主动再做生成不同 ULID。
- 真实受限执行池中，两个未来同资格时间/同 Input Task 绑定同一 Execution，
  第三项 queued；取消一位不取消另一位。运行超时后仍可完成；Task cancel、
  stage、timeout 与 Execution completion/reclamation 分开断言。
- 公开历史逐页读取；SSE 初始与 Last-Event-ID 续接均成功；断开不取消任务。
  保留期到期并由 fixture 的公开 collect 回收后，历史/流旧游标为 410，
  原请求为 404，不用空输入重做。
- 事件 sequence 去重、目录/历史/流游标独立、500 条窗口截断、端点切换
  AbortSignal / 迟到响应隔离及新查询覆盖旧查询均有模型回归。

## I-AC03：目录与复用

- 真实目录包含另一 HTTP 客户端提交的任务；列表权限独立于发现/详情/原请求；
  另一个 scope 的列表为空、跨 scope 详情拒绝。
- 验证 receivedAt 含下界/不含上界、目录没有 input/result、分页观察时刻和
  失效时刻固定、后提交 Task 不插入旧快照。真实 query_expired 后只保留旧视图，
  明确重查；没有拼接新旧快照。
- 原请求重做剥离 requestId，不注入摘要 version；用户 URL、digest、seriesId、
  eligibleAt 等原值保持。原参数错误/无权读取不会替代为空输入。
- 收藏文件在 UI 重启后保留完整参数和原目标，文件无后台 token / bearerEnv。
  派生发送不改原收藏，binding 变化后旧收藏操作为明确 409。

## 浏览器实际试用

通过集成浏览器连接两个独立进程：显式 Task Server fixture 与 UI Server，
均使用随机 loopback 端口。复现命令在[工作台指南](../../../../../docs/task-engine-web-ui.md#隔离浏览器验证真实-task-server)。

实际操作并观察：

1. echo 填字段、加入草稿后快捷提交；草稿仍在，独立单条回执进入真实 Task，
   SSE 显示 completed 与业务否定结果。
2. survey 按本地引用渲染 subject.name / active，动态添加 scores 数字项；
   提交完成。把 `<script>window.injected=true</script>` 当普通参数输入，
   页面没有执行脚本。
3. 打开关联 Execution，读取逻辑完成事实；切换“只读目录”后发现为明确 403、
   目录仍显示两个授权任务。再切换其他 scope，真实目录成功但为空，
   原 Task / Execution 详情已清空，不串目标。
4. 保存收藏，仅重启 UI 后收藏仍在，原后端历史仍可查询。收藏编辑派生发送后
   原收藏仍为原文；从目录“编辑后重做”取得新任务的原参数。
5. 390×844 窄窗口下页面无整体横向溢出（bodyWidth=375）；Tab 从目标选择进入
   导航，从消息输入进入可选字段，焦点可见。大表格仅自身横向滚动。

试用后页面导航至空白释放流，已停止仅本次创建的 UI / fixture 进程，
删除仅本次拥有的配置、随机凭据与测试残留目录。没有停止用户服务或清理用户数据。

## 尚未声称验证的范围

- 未连接客户真实生产 Endpoint，未部署远程服务，未发布 npm；TLS 代理、
  多用户访问、账号同步和资产管理不在本实现范围。
- 浏览器实际验证为当前集成 Chromium；未做所有浏览器/屏幕阅读器矩阵。
- Schema 复杂组合使用局部 JSON 与服务完整校验，不声称每个 Draft 2020-12
  关键字都有专门图形控件；普通 object、数组、嵌套、本地引用不是全任务 JSON 替代品。
- 本机收藏文件依赖操作员目录权限，文档要求单实例使用同一文件；没有把 loopback
  当作防恶意本机程序的账户隔离。显式重新指向逻辑服务/授权范围时必须更新 binding，
  不声称可识别未声明的同 URL/同 binding 服务替换。
