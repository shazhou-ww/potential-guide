# 独立消费与跨平台交付证据

## 验证对象与范围

- IDEA：`01M6QAN03H0JN6MHT86AF6GRJG`，仅接受本子 IDEA 的交付结果。
- 实际验证提交：`ed66ad618333271cdb45d68d9cdd5f40773ec0bc`。
- 执行时同步的 Outer World：`d331166a70f925dceeb0d60dfe81ed73e64328ec`。
- 已接受实施：`b5c6437ad95af91adaaf9aeab82d6862d3fb6974`。
- 本文记录 [Deployment](./Deployment.md) 的 D-S01/D-S02 与 D-AC01/D-AC02；
  补充回执不改变既定交付要求，不修改任何产品代码。

没有发布 npm、创建外部 issue、上传 Pinboard 或声称服务端持有任何根。
主分支并发退休产品的决定保持不变；当前证据基于仍支持的 generic Task/Bundle 与
Echo helper，不以被退休的 Check/Probe 场景代替当前验证。

## D-S01 / D-AC01：仓库外打包消费

监督者在 Windows / Node 24.11.1 / pnpm 11.22.0 上，于上述提交同步后执行：

```powershell
$env:PGUIDE_PACK_CONSUMER_ROOT = $env:TEMP
node scripts\check-packages.mjs --bundle-authoring
```

退出 0。整个作者消费者与运行宿主均在仓库外临时目录，通过 tarball 安装 5 个直接入口、
11 个内部包；运行宿主实际不能导入作者依赖，并经真实 Engine/Worker 执行通过。
全部消费者临时目录由既有清理机制移除，本机回执保留于
`.cache/identity-deployment-final-windows.log`，不是交付资源。

公共入口实际验证：

- LF/CRLF/孤立 CR 文本得到相同规范内容，BOM/其他字节保持；非法 UTF-8 报路径错误。
- raw binary 与固定 USTAR/gzip 归档的字节完全保留；manifest 精确列出 binary 路径。
- 目录与 CAR 内容一致，Echo helper 转发 binary；漏声明归档拒绝且不覆盖先前接受输出。
- 合法同根不同 CAR 块排列通过，明确错误期望 CID 拒绝，不计算容器哈希作批准。
- 不支持的旧 Check/Probe example kind 明确拒绝，不恢复退休业务。

旧契约额外补验：监督者曾在同轮修正前的实际仓库外 tarball 消费者中，使用公共
encodeContentCar 构造缺少 binary 声明和保留 CRLF 的两个合法 CAR 容器，
公共 readTaskArtifact 分别以 `binary ... Rebuild` 与 `Non-LF` 拒绝。
该证据明确来自此前消费执行，不冒称在新图重复执行；监督者核对
`95cefa2c..ed66ad61` 的 task-protocol/src 与 pguide-task-bundle/src 无差异，
故这两项拒绝规则证据仍适用。当前精确提交 CI 的协议回归也通过。

## D-S02 / D-AC02：真实跨平台一致性

[准确提交 CI 42208139003](https://github.com/shazhou-ww/potential-guide/actions/runs/42208139003)
的 `headSha` 为上述提交，7 个 job 全部成功：

| 实际 job | 环境/入口 | 结果 |
| --- | --- | --- |
| [Node.js 22.13.0](https://github.com/shazhou-ww/potential-guide/actions/runs/42208139003/job/127860382533) | Ubuntu，pnpm check | success |
| [Node.js 24.11.1](https://github.com/shazhou-ww/potential-guide/actions/runs/42208139003/job/127860382197) | Ubuntu，pnpm check | success |
| [Isolated package consumers](https://github.com/shazhou-ww/potential-guide/actions/runs/42208139003/job/127860382512) | Ubuntu / Node 24.11.1，pnpm consumers:check，独立根为 runner.temp | success |
| [Packed CLI Ubuntu](https://github.com/shazhou-ww/potential-guide/actions/runs/42208139003/job/127860382795) | Ubuntu / Node 22.13.0，pnpm deployment:verify | success |
| [Packed CLI Windows](https://github.com/shazhou-ww/potential-guide/actions/runs/42208139003/job/127860382445) | Windows / Node 22.13.0，pnpm deployment:verify | success |
| [Packed CLI macOS](https://github.com/shazhou-ww/potential-guide/actions/runs/42208139003/job/127860382660) | macOS / Node 22.13.0，pnpm deployment:verify | success |
| [Release verification](https://github.com/shazhou-ww/potential-guide/actions/runs/42208139003/job/127863181889) | 汇总已有检查，不执行发布 | success |

监督者读取了 Linux isolated consumers、Linux packed、Windows packed 三份实际 job 日志，
不只看绿灯。三者及本机 Windows 的根完全一致：

| 场景 | Windows 与 Linux 的实际根 CID |
| --- | --- |
| 固定 Worker 的规范内容 probe | `bafybeibtkmjrucx7wqozzwuewnwtdoyhyucpr3wp2jbmmjr3zjjeugog2m` |
| 实际 buildTask、含普通归档与 binary 资源的完整 Bundle | `bafybeialzhhsluscctdsq3vlxflhblrl75coace6wbb6alrgu7qmd623ia` |

这两个 CID 对应不同文件树，不是同一 Bundle 的双重身份。完整 build 根也一致，
因此没有只用固定 Worker 掩盖作者编译过程的跨平台差异。
Linux isolated job 在 2026-11-06T11:13:24Z 输出两个根，并在 11:13:35Z
报告 5 入口/11 内部包消费通过；Windows packed 在 11:15:42Z 输出相同两根。
这些是实际 Linux/Windows 执行，不是仅在一台机器改变换行输入。

## 历史失败与授权审查结论

首轮 [CI 42197402285](https://github.com/shazhou-ww/potential-guide/actions/runs/42197402285)
失败保留：遗漏 tarball binary 声明，缓存测试误依赖终端日志格式。修正、回归以及
并发退休历史的整合已进入新的准确 Inner 并重新 submit/accept；不沿用旧接受来批准修补。
现在的 CI 结果才是本次完成依据。

监督者依照用户明确授予的自主门禁权限，确认全部 D-* 有现实证据且无已知阻塞。
可在本文与 ledger 同步、准确 submitOuter 生效后接受该 Outer 修订。
接受仅表示规范化/CID/独立消费交付契约满足，不代表 npm 发布或 Pinboard 服务端验收。
