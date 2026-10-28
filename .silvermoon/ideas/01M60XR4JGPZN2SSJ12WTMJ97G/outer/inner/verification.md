# 实施执行证据

## 2026-10-28 当前实施切片

已完整读取 accepted Ideal 五份文件、Implementation、Deployment 和 ledger。
fresh implementing 报告：primary `89a7cef2e265611702006dc8d3f7e5a0825cd20b`，
event digest `2b215b58e537d2aec51888d07707f55bd5c74535`。
该报告未包含额外 guidance；accepted Ideal 未修改。

- `pnpm install --reporter=append-only`：manifest 提取底层包后运行，成功，未添加第三方依赖。
- 首次 `pnpm --filter @potential-guide/check-host build`：失败，发现 Reference 类型访问和
  exactOptionalPropertyTypes 初始化问题；源码已修正。
- 第二次相同 build：失败，Node fetch `.json()` 的 unknown 不可赋给公开类型；
  改为边界解析器而非断言类型。

这些是实施中间结果，不是完整通过、submitInner 或外部部署证据。

## 已执行的完整切片

首个可恢复提交：`8544049`（制品分层、v2 状态机/API/SDK 和八个确定性测试）。
该提交前 `silvermoon check --worktree` 与 `--staged` 均成功；未提前提交 gate。

- `pnpm --filter @potential-guide/check-host build` + 指定 `v2-scheduler.test.ts`：
  八个测试全部通过，覆盖排队强语义共享、运行中强/弱分流、late-resolution、
  新版本不匹配旧执行、独立期限/取消、迟到 timer、幂等/权限/context、订阅竞态。
- `pnpm typecheck`：25 个 workspace 成功（9 个缓存），根测试 TypeScript 检查成功。
- 后续消费者迁移编译先发现 probe 尚未从公共入口导出和 evidence 的布尔字面量拓宽；
  修复导出和类型后，`cli-runtime`、`objective-regulator` build 和根测试类型检查成功。
- 真实 TLS 测试初次子进程继承 `NODE_TEST_CONTEXT`，未实际执行内部测试；删除该继承后
  强制断言子进程报告 `fail 0`，不是把空输出当通过。
- `pnpm --filter @potential-guide/check-host exec tsx --test test\v2-scheduler.test.ts test\v2-real.test.ts`：
  9/9 通过。内部真实 HTTPS/HTTP/worker 测试通过，运行约 5.8 秒。
  浮动 V2 digest 为 `sha256-pguide-check-v1:2403e32a51c44d04288e3cffa327293f00b5a1ddfc6532c40cf83c5dee4327e2`；
  V3 为 `sha256-pguide-check-v1:3a34d4a7728eb24457f3833dc830f67e7a0a844ea49eeb7c6f24f9294c9c97b6`。
  两份同时执行，业务 `ok:false` 仍 completed；固定 V2 不增加来源请求。
  记录 3 次实际来源传输、12 个 Execution、3 次 worker 初始化，失控执行墙钟断言
  `800 <= elapsed < 3500ms`，实测约 987.5ms。失控 worker 拥有真实子进程，
  邻 worker 正常完成；等待 `ownedProcesses === 0` 后再验后继执行。
  协作取消实际写清理标记，错误/脏清理均 reject，诊断不泄露 worker 私有消息。
  HTTPS 证书通过独立测试根受信，移除根的独立 Node 请求实际失败；未关闭 TLS 验证。
  重定向循环、HTTP 降级、超大响应、坏归档和未授权 origin 全部明确失败。
- 真实 Objective 流先暴露 regulator 仅接受 file resourceBase；
  将新增服务地址限制为携带准确 owning digest 的认证 loopback v2 Reference 路径后重测成功。
- `pnpm --filter @potential-guide/cli-runtime exec node --test test\host-v2.test.mjs`：
  通过。真实 TLS→同进程 Host→SDK→Pilot→regulator，六条
  `check.host-observation` 证据均含 Task/Execution/digest/实际 revision，11 次实际执行。
  Objective digest `sha256-pguide-objective-v1:5a245467a4a0403b2b4672dc15e4be0d2f8263a66fbe259bc7d72fa9ebe1affa`，
  固定 Check `sha256-pguide-check-v1:0519d4256ec62cb2f936311eff8bd86cf84cb8a8cf33e8b297076f6136b72d1a`。
  断言客户端缓存只有 Objective 数据、无 Check 物化；来源切换 V3 后准确恢复仍运行固定旧版，
  继承 Reference 的 owning artifact 与服务地址保留。

## 完整检查的发现与修复

操作日志位于仓库忽略目录 `.cache\check-host-v2`，不是交付或部署证据：

1. `check-first.log`：完整 `pnpm check` 的 build 在 license 收集器遇到依赖内部
   仅声明 `type`、没有 `name` 的 package.json 时失败。新 Host 制品依赖使该真实路径出现；
   收集器改为继续向上找到有名的真实包，仍要求完整许可证，不跳过许可验证。
2. `check-second.log`：build 成功，分层检查拒绝未分类的共享底层及 protocol→tools。
   将纯制品基础库与 private files 分类为 protocol；它们不依赖业务层，仍禁止环。
3. Windows Biome 不展开传入字面通配符，改用明确目录；格式检查不被跳过。
4. `check-third.log`：新增两项状态机回归尚未格式化，format 检查明确失败；已格式化。
5. `check-fourth.log`：layers/format 通过，lint 指出消费者 `let metadata` 缺显式类型；
   添加 `ArtifactMetadata` 类型，没有使用 any/cast 掩盖；同时完善关闭时中止和等待准备 IO。
6. `check-fifth.log`：关闭方法插入到了 acquire 方法内，编译明确失败；
   将方法移到类边界后先单独 build 成功，再进行完整复验，没有跳过检查。
7. `check-sixth.log`：layers/format/lint/typecheck 与多数相关测试通过，发现两项接线：
   Node 默认 `--test` 会执行 test 目录中的 TLS-only case；共享包需要自己的 objectives/test task，
   并进入根交付依赖闭包，补全声明、真实 primitives 测试和本地 pack 验证（不扩大发布授权）。
   单独仓库义务测试须用既有 tsx loader；直接 node 启动曾因 TS 源码导入失败，已按仓库工具重试。
8. targeted 仓库义务检查最终 2/2 通过，新增共享包及交付闭包准确接线。
   将 TLS-only helper 放在 test-support 曾触发生产入口跨包边界检查，未绕过：
   helper 留在 test 目录，无测试根时显式 skip，由真正建立 CA 的 driver 独立运行，
   driver 强制断言子进程 `pass 1/fail 0/skipped 0`。
9. `check-seventh.log`：完整复验进行中，最终结果在提交 gate 前补齐。

扩展后的 targeted v2 命令 11/11 通过（`v2-final-targeted.log`）：
额外验证终态保留过期通知不反转 completed、迟到执行墙钟 timer 不允许新需求关联旧执行、
新 ArtifactManager 直接复验磁盘固定 digest 而不请求 latest、引用保护导致容量拒绝、
释放后真实回收、篡改 capsule fail closed 且不联网兜底，以及 HTTP 幂等在来源切换后
仍返回原 Task/版本/受理点。扩展实测 7 次传输、13 个 Execution、3 次初始化，
强杀测试实际墙钟约 975.7ms，清理后的 ownedProcesses 为零。

业务入口复验通过（`business-discovery.log`）：真实 Pilot/regulator 六条 Host 观察与固定版本恢复继续成功。
测试证据中的 Objective digest 含受控制品服务器的随机端口，因此不同运行允许改变，
这不是同一固定内容被静默升级。

最后补强了真实大快照的初始订阅：状态机只登记有界通知，实际 SSE 写在异步批次；
两个 100000/100001 字符业务结果的初始终态快照都能经过 drain 交付，不会在每次
重连时重复断开。`v2-bounded-stream.log` 的 11/11 通过，真实 worker 15 次执行、
3 次初始化、7 次来源传输，强杀墙钟约 995.8ms。
对应新版测试制品 V2 `sha256-pguide-check-v1:b8eec981ed87520b1f317e8f2d978407832d22ea3d3574b9909a2ddb53e93cee`，
V3 `sha256-pguide-check-v1:41a4cfee778d8cd096bec67890adb7efe03b7b1bc2f792103eab863280491503`；
与前面原始测试源的摘要不同是显式增加 blob 测试字段所致，不是来源缓存漂移。
固定缓存/共享准确下载保留真正原始 acquisition origin，不将后来调用的 URL 冒充为已确认来源。

以上全部为源码工作树内的自包含实施验证，不宣称 npm、Release 或独立用户部署成功。
