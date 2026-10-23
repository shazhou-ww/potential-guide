# 实施中证据与阻断

本文件不构成完成声明。当前 I-* 均保持未完成；没有 submitInner、accept*、
部署或发布。accepted Ideal 未修改。

## 已运行

- `pnpm install --reporter=silent`：依赖 manifest 增加 check-host 后成功。
- `pnpm exec tsc -b --pretty false`：通过。
- `pnpm exec tsc -p tsconfig.test.json --pretty false`：通过。
- `pnpm exec tsx --test packages\check-host\test\host.test.ts`：3/3 通过，
  覆盖无 HTTP 的单次执行/SubscriptionRef、线程复用、四路由、断线不取消、
  集合不泄露 Subject、队列、取消、资源 revision、终态过期与清理失败隔离。
- `pnpm workers:build`：生成全部 16 个 worker artifact；
  仍有既有 CJS import.meta warning，不能以此掩盖失败。
- schema/dependency/source 联合测试（shell46）：业务 dependency 测试 9/9 通过；
  source 测试存在尚未修复的资源边界、旧入口错误断言、旧 cwd/cleanup 假设失败。
  该命令已主动停止，不能记作通过；尚未执行 pnpm check。

## 安全阻断：旧测试的清理路径假设失效

shell46 命令：

```powershell
$env:PGUIDE_CHECK_HOST_DIRECTORY = Join-Path (Get-Location) '.cache\validation-check-host'
pnpm exec tsc -b --pretty false
pnpm exec tsx --test packages\pilot-protocol\test\protocol.test.ts packages\objective-pilot\test\dependency.test.ts packages\pguide\test\pilot-source.test.ts
```

旧 `cleanup failure retains the primary CLI error and reports both causes`
测试从检查器的 `process.cwd()` 上溯四层得到 cache，并在 finally 递归删除。
迁移到共享 Host 后 cwd 不再是旧的单检查 checkout；此算法可算出 `D:\`。
发现后立即调用 `stop_powershell` 停止 shell46，未继续运行该测试。
后续 `git status --short`、`.git` 和 `package.json` 检查显示当前工作树源码仍在，
但这些结果不足以排除工作树外路径受影响；不得声称环境完整性已验证。

已将测试修为显式创建 `.cache\pilot-source-tests\cleanup-<uuid>`，
通过 `cacheDirectory` 注入并仅在该 operation-owned 根目录内定位 cleanup 目标，
finally 只删除该明确拥有的目录。修复后尚未重跑，须先由协调者处理环境安全评估。

## 协调者只读核查

协调者在执行会话原始 events.jsonl 中核查了以下记录，没有重跑测试或执行清理：

- 2026-10-23T04:52:38.106Z，测试工具调用
  `call_jinpG19pCESFPb5hBNTpSk1X` 的输出显示 shell46 运行超过 120 秒。
  最后一项完成输出为 `source lifetime cancellation waits for active process teardown before removing its source`；
  没有后续 cleanup 用例的完成记录，也没有删除目标或删除清单。
- 2026-10-23T04:52:50.133Z 的代码读取
  `call_D9pzrcRhEdIQ6wLcRD4HI3Tr` 显示迁移中的 cleanup fixture 已改为 worker.cjs，
  仍返回 process.cwd()，测试仍保留从该路径上溯四层的旧逻辑。
- 2026-10-23T04:52:59.951Z，
  `call_UTbbt577dmQtODbr3JIQxrFz` 返回 shell46 已停止。
- 对照已提交旧测试可确认：先执行 `cache = dirname(dirname(dirname(dirname(directory))))`，
  然后才断言 cache 的父目录；finally 中只判断 cache 非空便调用 originalRm。
  因而断言失败本身不会阻止 finally 对已经赋值的错误目录执行清理。

这是实际存在的危险控制流，不只是名称误解。原始日志没有证明该次 worker 返回的真实 cwd、
finally 是否开始调用删除、删除成功/失败的具体路径；测试最后输出停在前一个用例，
也不足以证明下一个用例未开始。当前工作树存在不证明盘符其他位置完整。
因此不能断言已经发生越界删除，也不能断言没有发生；不使用重现危险命令来消除不确定性。

后续 subagent 核查请求已失败并被安全系统阻断，协调者未通过新 agent 或其他执行方式重试。
当前修补后的 cleanupRoot 仅指向操作创建的目录，但这不能恢复或证明先前外部状态。
在取得机器所有者的文件系统/备份或其他可靠完整性检查结论前，暂停测试和实施推进；
不记录 submitInner/acceptInner。此次安全核查与产品校验结果分开记录。

## 会话交接

2026-10-23，用户明确要求先将当前修改保存为本地提交，再由新会话继续。
本次提交仅为未完成实施的检查点，不是实施验收或恢复执行的授权；不推送、
不发布、不重跑测试，不将先前局部测试通过解释为完整验证。
新会话应先读本文件、Implementation.md 和已接受的 ideal/Design.md，
保留当前实现，先处理上述安全阻断，再继续迁移与验证。
后续 subagent 的通用安全拒绝未指出具体文件夹，不能解释为已经确认
“访问未授权文件夹”，也不能据此证明此前危险清理被成功阻止。

## 剩余实施工作

本检查点包含未完成的 check-host、v3 schema、worker generator、16 个入口、
CLI adapter、业务依赖 requirements/实际观察/重查及部分 fixture 迁移。
直接消费脚本和部分旧测试仍需迁移；长期混合负载/内存/真实冷热点性能、
完整 pnpm check、完整发布包一致性与文档更新尚未完成。
不能勾选 I-* 或进入实施提交门禁。
