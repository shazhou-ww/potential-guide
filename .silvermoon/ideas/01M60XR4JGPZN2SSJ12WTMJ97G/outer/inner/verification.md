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
9. `check-seventh.log`：完整 `pnpm check` 成功，退出 0。build/lint/typecheck 各
   25/25，workspace test 图 50/50，根 scripts 36/36；24 个内部包的本地 tarball
   消费及 npm-objectives/protocol/main/pilot/regulation/coordinator/objectives/config/agents/combined
   十组独立安装图通过，没有 npm/Release 发布。
10. 完整检查期间进一步明确 cleanup/verify/schedule 错误阶段，并补初始订阅实际 deadline。
    冻结源码复验 `check-final.log` 暴露 discovery 旧测试计数锚点的真实竞争：
    四个 early 恢复调用会在被杀 Host 的 close 通知被观察前启动替代 Host，测试却在
    await close 后才取 before，实际仅两次 spawn 反被期待为三次。将基线严格移到 kill
    之前，仍断言恰好一次替代，不放宽条件、不修改生产恢复算法。
    此后一次 targeted 另见末轮 published 的 `13 != 12` 启动计数波动；
    增加仅失败时的受控进程 journal 诊断，不放宽断言。紧接的一次及三次连续完整
    六阶段 crash 重试全部成功（`discovery-race-detail.log`、`discovery-repeat-1..3.log`）。
    当时没有据重复成功宣称已定位根因，继续完整验证。
11. `check-gate.log` 再次复现额外启动。受控 journal 证明一个替代进程先 exit 1，而非
    两个已发布 Host；进一步捕获该进程 stderr，在完整 Host 压力下稳定复现
    `EPRIVATE, native 5, publish/Publish`（`host-context-repeat-1.log`）。
    根因为 Windows MoveFileEx 对未开放 delete-sharing 的安全读者可返回 access-denied 5，
    既有代码只重试 32/33，导致仍满足 owner/ACL 的原子发布被当作永久安全失败。
    仅对已验证、已加互斥的同一次 rename 增加 bounded 5 重试，仍最多 100 次/每次 10ms；
    不改 ACL、不降低 no-follow、不把通用 EPRIVATE 当成功。附加诊断只含原生数值和操作名，
    没有 token、内容或路径。
    真实 PowerShell FileShare.Read 持有受保护目标文件的回归证明：持续占用时有界失败且旧内容
    不变，释放读者后准确 expected-content 发布成功。完整 Host 回归连续三次退出 0
    （`host-fixed-repeat-1..3.log`，每次 44 pass/2 个既有 POSIX skip）。
    最终完整检查改为 `check-gate-fixed.log`，提交 gate 前核实其退出结果。
12. 最终兼容检查进一步封闭 legacy 控制面：真实 HTTP 证明 v1 的集合不暴露 managed
    Execution，拿 v2 executionId 去 v1 GET/cancel 均明确 404，原 Task 仍正常完成。
    `v2-legacy-boundary.log` 13/13 通过。制品上限确定为 32，而非临时设计的 64：
    为既有 private-directory 64 项安全扫描保留 mutex/暂存余量，配置 >32 明确拒绝，
    不放松已接受的 ACL/no-follow 原语或修改 Ideal。损坏缓存统一 503/cache_invalid/verify，
    无网络兜底。以上最后边界均在最终稳定完整检查前重跑 targeted 验证。
13. `check-gate-fixed.log` 完整 `pnpm check` 退出 0，原生发布修复在完整并发压力下通过：
    shared-files 2/2，Host 44 pass/2 个既有 POSIX skip，根 scripts 36/36，
    十组打包安装图通过。随后最后的 legacy/32 制品上限/cache_invalid 边界
    `v2-complete-targeted.log` 13/13，无跳过。对全部冻结源码正式复验
    `check-gate-final.log`；此轮之后补齐下面的有限 JSON/完整观察结果边界，故还需对
    最终稳定快照重跑完整检查，不把中间通过当作最终 gate。
14. SDK `result()` 进一步使用明确的 `CheckObservation` 保证准确证据字段，拒绝缺项的
    completed。Worker/SDK 不再用 JSON stringify/parse 的隐式转换掩盖无效业务值；
    真实 worker 在允许任意附加属性的 resultSchema 下返回 NaN，现明确 failed/reject，
    不再可能被传成 completed/null。纯 guard 回归覆盖 Date、循环、getter（不会被调用）、
    symbol、稀疏数组及深度边界，正常共享子对象与 null-prototype JSON 可通过。
    `v2-json-complete.log` 14/14、独立真实 HTTPS 子测试 1/1 通过，cli-runtime build 成功。
    完整 Host `host-json-regression.log` 为 45 pass/2 个既有 POSIX skip，真实业务消费者
    `business-json-regression.log` 通过，说明没有靠只测替身跳过实际旧调用链。
15. SDK 文本 Reference 改为 fatal UTF-8 解码，不能把损坏字节替换为看似原始内容；
    额外 HTTP 边界单元测试证明缺项 completed 与坏 UTF-8 均 reject，且只发送 GET，
    不新建或取消 Task。补上“旧 Task 真正超期但 timer 未派发，新弱 Task 先解析”的
    确定性竞争，证明旧 Execution 不被新需求复活；兼容 key 的 canonical seed 预先计算。
    最终相关组合 `v2-final-races.log` 16/16 无跳过（含真实 HTTPS 子进程 1/1）。

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

最终 targeted `v2-gate-targeted.log` 为 13/13：12 项纯状态机测试，以及真实 TLS/HTTP/
SDK/多 worker driver（其内部独立子测试 1/1）。新增断言原始不合 schema 的正常输出为
`invalid_result/verify`，脏清理为 `cleanup_failed/cleanup`，入场失败为 schedule，
订阅初始快照也实际检查 deadline，不依赖 timer 恰好先运行。强杀不仅确认子进程消失，
还等待物理 worker 数从两条降到一条，再验证健康 worker 的后继执行。

Windows 平台限制：既有 POSIX executable/SQLite lock、原生 Linux dispatch、区分大小写
realpath 场景不适用而被既有条件跳过；Windows ACL/native helper 与本项真实清理路径实际执行。
TLS-only helper 在无 CA 的默认发现中显式 skip，真正 driver 另起受信进程并强制
`pass 1/fail 0/skipped 0`；本项 targeted 13 项无跳过。不能把这些条件跳过表述为跨平台实测。

以上全部为源码工作树内的自包含实施验证，不宣称 npm、Release 或独立用户部署成功。
