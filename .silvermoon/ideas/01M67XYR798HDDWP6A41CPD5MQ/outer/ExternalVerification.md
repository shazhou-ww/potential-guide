# 独立制品消费者外部验证

## 已同步标准与消费身份

本轮在 primary `22b575f49c885108ff34f76c04e89fcc292913a0` 的外部标准
`1912321f02627afc798cbfa439d8cf9a674b7c71` 同步后执行最终观察。
accepted inner 始终为 `951ad824149d9337da031a280196e4986b71395d`，未修改实现或 ideal。

实际消费目录：
`D:\Code\potential-guide.worktrees\whole-run-consumer-01M67XYR798HDDWP6A41CPD5MQ`，
为自有仓库外非 Git 隔离目录；运行资料保留用于审查，不使用系统临时目录或已有用户数据库。
平台 Windows x64、Node v24.12.0、pnpm 11.22.0。

真实 `pnpm pack` 后以 file tarball 安装九个生产包：task-protocol/task-engine/
task-engine-storage/task-engine-http/task-engine-server/check-artifacts/check-runtime-files/
check-task/probe-task。未发布 npm，内部闭包均 override 到本次 tarball。
包版本、归档完整 SHA-256/字节数/路径见 [artifacts.json](./evidence/artifacts.json)；
实际 installed 入口路径、入口 SHA-256 在最终观察的第一个场景；
驱动/锁文件/新数据库及 WAL/SHM 身份见 [consumer-state.json](./evidence/consumer-state.json)。
tarball 打包时的初版合同与最终观察合同分别记录，不把旧合同标成最终标准。

## 执行命令

从已接受代码执行 `pnpm build`，在每个生产包目录执行
`pnpm pack --out <自有消费目录>\packs\<包名>.tgz`；
消费目录的 manifest/overrides 全部引用这些归档，packageManager 明确固定 pnpm@11.22.0。

在自有目录执行：

```powershell
$env:CI = 'true'
pnpm install --prefer-offline --ignore-scripts --no-frozen-lockfile --reporter=append-only
$env:VALIDATION_ROOT = Join-Path (Get-Location) 'runs\attempt-05'
$env:NODE_EXTRA_CA_CERTS = Join-Path (Get-Location) 'certificates\cert.pem'
node consumer.mjs
```

证书由当前 PowerShell 的 .NET RSA/CertificateRequest 生成，SAN 为 127.0.0.1/localhost、
有效期一天；只用于自有 HTTPS 归档服务。没有修改系统信任库、关闭 TLS 校验或连接未知 AHP。
私钥只存在于自有消费目录，观察完成后删除；没有纳入仓库或输出。
重放须在新的自有目录生成新证书/安装同批制品，指定未存在的 runs 子目录；
不覆盖本轮数据库/失败证据。Checker/Objective 的实际 HTTPS 端口由当前自有 listener 返回，
该 origin 显式加入 source allowlist。

## 实际结果

最终进程 PID 56996，2026-10-31T10:19:02.816Z–10:19:17.816Z，退出码 0。
[attempt-05.log](./evidence/attempt-05.log) 中九个独立场景全部通过，
[attempt-05.json](./evidence/attempt-05.json) 保存输入、结果、资源门闩、installed 位置、
自有 TLS 请求、180 条主服务事件及独立进程故障/恢复事件。
这是本轮实际运行，不以仓库单元测试或旧 pack:check 代替。

| 判据 | 本轮观察 |
| --- | --- |
| D-S01 / D-AC01 Check | Run `01M68QGKHP5SSQ35XXCVTS8MEZ` 在读完制品但准备未结束时接收 terminated-policy Task；只有一次 source 准备，接收方未独立准备，最终同一 runId |
| 固定旧内容 | HTTPS URL 的归档换成 V2 后共享 Check 仍执行 V1；业务 Execution ID 与完整 Run ID 不同，公开历史使用 run.started/run.completed |
| Probe 完整复用 | 父 Run `01M68QGMB24J55RDGGQ0YZXTXP` 的两个需求共享旧 root/Checker，Objective 在准备门闩期间换成 V2 不改已选内容；root source 只准备一次 |
| pin | 独立 pin V2 的 Check/Probe 返回 V2 digest；错误 digest 的 Check 明确 run_failed，不混入浮动共享 |
| D-S02 / D-AC02 权限 | 跨 scope GET/历史/取消 403；b 可提交但实际 source 拒绝且无读取；自有 origin 的 localhost 变体也被 source allowlist 拒绝 |
| Never / 取消 | Check 任意业务 payload 400，但独立取消 200；另一同类型 Run 完成；故障消费者中指定取消也不终结另一同类型 Run |
| 业务消息 | 两 Task 共享完整 control Run；同 messageId 追加返回原 accepted，改变 payload 409；目标 rejected、不覆盖原 Input；acceptedAdds=1，短期需求投入撤回后 total=0 |
| deadline / 竞争 | Task `01M68QGR3VW9KCC17FGN10M8WB` 原始与最终 deadline 均为 2026-10-31T10:19:13.771Z；终结后追加 409，不复活 |
| 故障 | 自有 fault Worker crash/hang 后 HTTP 仍响应；已进入具体业务及挂起后查询分别约 2.392ms/0.522ms；旧 Run 只调用一次，新需求才启动新代际 |
| 回收未知 | 旧故障 Run `01M68QGT235A6Y004KV102YTCT`、`01M68QGTBBGWWYQPFG3FV5W5H9` 有 cleanup.unknown，无 reclaimed |
| 资源证明 | Run `01M68QGSG71QBBBHGAW09KX9BA` 的未 await 宿主动作未结束时无回收；动作返回存活句柄后仍等待独立 proof；两道门闩完成后 waitRelease 才成功 |
| SQLite | 真正独立 Node 进程 59912/52848，均退出码 0；同一自有数据库中原 Check/Probe Result 完全相同、历史可读，source reads=0、run.started 数量不增加 |

V1 Checker digest：
`sha256:2774e4472568a089e35c908d0b90c4442f735d8eb5cfe1c531d4c8e56ef7bd84`；
V2 Checker：
`sha256:aef199a266f52975cd55eac60a48fcae783b0b8f625730ef898df2b90cd044cd`。
V1 root：
`sha256:b446781bb92edbc545a875fc4724da39ed44ace1595d66a36368f6475fec42f9`；
V2 root：
`sha256:ac2b6f018e1d92d66d0ec0437c831ef792f39c733495dc10cd48ccd1e2b03a5c`。

## 失败与重试

保留所有不利输出，未改 accepted inner 取得通过：

- 初次外部安装未固定 packageManager，自动使用 pnpm 10.27；修正为 11.22 后
  非 TTY 清理旧 modules 被拒绝，以当前自有目录 CI=true 重新安装通过。
  三份安装输出均保留。
- [attempt-01](./evidence/attempt-01.log)：Objective 内嵌 Checker 的 file URL 被既有 portable HTTPS 契约拒绝。
- [attempt-02](./evidence/attempt-02.log)：Probe Objective file 输入被声明的 HTTPS inputSchema 拒绝。
  两项是消费驱动的约束错误，不是扩大实现协议；改用自有真实 TLS 端点并先同步新标准。
- [attempt-03](./evidence/attempt-03.log)：只等 Run.started 就发消息，早于 run.dispatched，实际 409。
  自有 SQLite 时间线显示 started=10:13:38.508Z、dispatched=10:13:38.612Z；
  驱动改为确认实际业务等待后投递，不伪造绑定、不续原 deadline。
- [attempt-04](./evidence/attempt-04.log)：九场景通过；
  最终 attempt-05 额外在具体 Run 的业务标记后测故障期间响应，并验证跨 scope 取消/源 origin 拒绝。

## 清理与残余未知

自有主进程、HTTP/HTTPS listener、正常类型/业务 Worker 均已关闭。
故障消费者 PID 60628 按其 child handle SIGTERM 清理，在 Windows 上是强制进程结束，
没有把该动作记录为旧 Run 已回收；原未知记录仍保留。
已按 PID 检查 56996/60628/59912/52848 均退出，没有按名称终止其他进程或留后台。

本轮只覆盖 Windows x64/Node 24；SQLite 为 Node 实验特性。
不承诺 OS 安全沙箱、撤销任意外部副作用或跨 Crash exactly-once。
control 类型是自有验证消费者，不是已注册生产 Regulator，不新增治理记账系统。
本轮未发现需修改已接受实现的真正 bug，仍由父代理审查精确 submitOuter。

## 提交卫生

外部观察完成后另行执行 `pnpm check`，退出码 0，
日志 `.cache\run-outer-final-repository-check.log`。它只作为仓库提交卫生，
不替代上面的独立安装、服务/故障/资源/SQLite 实际证据。
ideal/inner tree 校验保持原精确接受值；ledger 的 D 项仅记录 Agent 已执行工作。
