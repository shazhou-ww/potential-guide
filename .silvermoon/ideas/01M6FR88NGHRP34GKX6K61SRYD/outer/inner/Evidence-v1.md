# Task Run Logs 当前 v1 实施证据

## 基准与范围

验证日期：2026-11-07（UTC+08:00）。初始源码基准为 primary
`7d776c14006b1ea16d93fa9ee26c6e73c371d5eb`；
整合并发的 RC 版本准备提交后，最终源码基准为
`82ecc1041999f4807d763602d57df31113b6019a`。
该提交仅改变发布版本及发布文档，相关 axis、日志源码和本 idea 均未变；
本候选另补显式 `runTask` 日志回归，整合后重新执行下列定向和独立消费验证。
环境为 Windows、Node `v24.12.0`、pnpm `11.22.0`。
这不是部署证明或验收决定；[旧 Evidence](Evidence.md) 只记录被取代的 v2 历史。
本轮未修改 accepted ideal、生产实现或 Deployment 合约。

隔离工作区缺依赖，首次工具检查触发自动安装，遇到共享 pnpm store 的
`database disk image is malformed`。未修复、清理共享 store 或修改宿主配置；
通过本工作区 `.cache/pnpm-store` 和 `pnpm install --frozen-lockfile --store-dir <专用路径>`
恢复锁定依赖。独立消费者初次重跑也遇到该共享 store 错误；
确认 pnpm 11 使用 `PNPM_CONFIG_STORE_DIR` 而不是 `npm_config_store_dir` 后，
仅在验证进程中设置专用绝对路径，独立验证成功。锁文件未变。

## 与当前 axis 的逐项对齐

规范入口为 [RunContext](../../../../../docs/axis/task-engine-contracts/run-context.md)、
[日志契约](../../../../../docs/axis/task-engine-contracts/run-logs.md)及
[C6/C7](../../../../../docs/axis/task-engine-responsibilities.md#c6-查询-run-诊断日志)；
这些契约的 `frozen: false` 不是冻结或发布授权。

| 项目 | 实际接线与证明 |
| --- | --- |
| I-S01、I-S02：作者能力 | [RunContext.log](../../../../../packages/task-protocol/src/run.ts) 返回 typed receipt；[TaskContext/runTask](../../../../../packages/task-sdk/src/index.ts) 继承类型并实际注入 `log`，不暴露 Engine 或原始端口。 |
| I-AC01：职责隔离 | [Worker 宿主](../../../../../packages/task-engine/src/type-supervisor.ts)及 [Engine](../../../../../packages/task-engine/src/engine.ts) 校验 generation、Run、scope；[日志策略](../../../../../packages/task-engine/src/logs.ts)只写独立存储，不提交 lifecycle facts。真实 SDK/SQLite 测试验证精简 Result 和事实分离。 |
| I-S02、I-AC02：查询与订阅 | [SQLite](../../../../../packages/task-engine-storage/src/index.ts)、[HTTP 路由](../../../../../packages/task-engine-http/src/index.ts)、[独立 SSE](../../../../../packages/task-engine-http/src/logs.ts)和 [client](../../../../../packages/task-engine-http/src/client.ts) 以日志 sequence 续读，不混用 lifecycle revision；验证权限、并发隔离及重启后历史读取。 |
| I-S03、I-AC02：UI | [Run 详情](../../../../../apps/task-engine-webui/src/browser.ts)和 [有界窗口](../../../../../apps/task-engine-webui/src/run-logs.ts)提供独立 Logs、跟随/暂停/分页/重连及迟到响应隔离；DOM 与 standalone 实际代理测试均覆盖。 |
| I-AC03：边界 | [SDK 测试](../../../../../packages/pguide-task-bundle/test/logs.test.ts)、[丢弃聚合](../../../../../packages/pguide-task-bundle/test/drop-reporting.test.ts)及 [Server 测试](../../../../../packages/task-engine-server/test/run-logs.test.ts)覆盖超时、取消、未 await、非法输入、失败、强停、超限、慢消费者、存储故障和尾部 unknown。 |

唯一 Task v1 支持 `log`、`log-ack`、累计 `log-drop` 和 `log-drop-ack`；
独立消费验证明确接受 v1，拒绝已移除的 v2 和未来 v3。
日志级别表达诊断意义，不自动抛错或决定业务结果；作者仍可根据 receipt 选择业务策略。
Engine 校验接收到的日志值，SDK 只维持独立有界通道和确认。

## 本轮命令与结果

以下命令使用本轮专用 store，未发布 npm；从仓库根执行，除非另有 `Set-Location`。

```powershell
$env:PNPM_CONFIG_STORE_DIR = Join-Path (Get-Location) ".cache\pnpm-store"
pnpm exec turbo run build --filter=@potential-guide/task-engine-server --filter=@potential-guide/task-sdk --filter=@potential-guide/task-engine-webui --filter=@potential-guide/pguide-task-bundle --output-logs=errors-only
```

结果：初轮 **10/10 成功，全部命中既有内容寻址缓存并恢复构建产物**；
整合 RC 版本提交后再次构建 **10/10 成功，其中 4 项缓存、6 项实际执行**。

```powershell
pnpm exec tsx --test --test-concurrency=1 packages\task-engine\test\run-logs.test.ts packages\task-engine-server\test\run-logs.test.ts packages\task-engine-http\test\run-logs.test.ts packages\task-engine-storage\test\run-logs.test.ts
Set-Location packages\pguide-task-bundle
pnpm exec tsx --test --test-concurrency=1 test\logs.test.ts test\drop-reporting.test.ts
Set-Location ..\..\apps\task-engine-webui
pnpm exec tsx --test --test-concurrency=1 test\run-logs.test.ts test\run-logs-standalone.test.ts test\run-diagnostics.test.ts
```

修改测试前结果为核心/SDK **19/19**、UI **5/5**。
最终基准上复测为核心 **13/13**、SDK **7/7**、UI **5/5**，共 **25/25**。
新增用例以 `entryMode: "explicit"` 打包作者显式调用的 `runTask(callback)`，
断言真实上下文能发送绑定 generation/Run 的日志、接收 `stored/sequence:7` 回执，
并继续 progress、complete 与 released。其余用例保留 callback 模式兼容回归。
`pnpm exec tsc -p tsconfig.test.json --pretty false` **exit 0**；
`pnpm exec biome check packages\pguide-task-bundle\test\logs.test.ts` **exit 0**，
无错误，7 条测试内非空断言警告，不宣称零警告。
SDK 测试须从作者工具包目录启动，使临时作者入口可解析该包的 SDK 依赖；
初次从根目录执行新增显式入口时出现依赖解析错误，需按上述命令复测，不修改根依赖来掩盖。
UI 必须在包目录运行以使用其 `react-jsx` 配置；不把从根目录误启动时的 JSX 错误当作产品故障。
standalone 测试复制完整 built UI，限制其文件读取范围，不借用工作区 node_modules；
真实通用 SDK 逐项断言样例经 HTTP history/SSE 和 UI proxy 消费，
业务结果仍为 `{ok:false, problemCount:1}`。这不代表已有正式 Check 作者适配器。

```powershell
Set-Location ..\..
node scripts\check-packages.mjs --task-sdk
```

结果：**exit 0**，整合后以当前 RC 版本重跑，5 个内部 tarball 校验及独立安装消费通过：

```text
Packed Task schema validation: v1 accepted; removed v2 and future v3 rejected.
Dependency control: visible
Dependency control: missing
Packed Task Worker completed without node_modules.
Task SDK author process exited; isolated dependency controls and standalone Worker verified.
isolated task-sdk: 4 selected, 5 internal packages; packed consumption passed
```

作者进程先退出，移走作者依赖后再执行 Worker；实际完成独立日志 ACK、progress、
精简 Result 和 released。该控制证明 Worker 不依赖消费端安装 SDK，
不以源码工作区的直接运行冒充独立 tarball 消费。
fixture 安装和测试进程按既有脚本清理，没有留下服务。

## 全量检查与未覆盖范围

已运行 `TURBO_CONCURRENCY=2` 下的 `pnpm check`，**exit 1**。
在任何本候选编辑之前即可复现：sources、build/layers、format、lint、typecheck
均先完成；workspace test 报 **49 successful / 55 total**。
新增回归后再次运行为 **48 successful / 51 total**；
最终 RC 基准复测为 **48 successful / 53 total**，失败包仍为
`@potential-guide/pguide-task-bundle#test`：
[CAR 文件测试](../../../../../packages/pguide-task-bundle/test/car-files.test.ts)及
[init.test.ts](../../../../../packages/pguide-task-bundle/test/init.test.ts)
创建文件符号链接时报 Windows `EPERM`
（CAR link、gitignore link/broken-link、manifest、broken-template）。
这不是日志链路断言失败；未跳过测试或改变宿主权限，也未改无关初始化逻辑。
后续 workspace 测试、根脚本测试及 pack:check 未全部完成，不能称为全量全绿。

本轮证明不代替 Outer 阶段的当前候选固定、人工浏览器操作及运行策略部署演练。
历史 D-* 勾选和旧 acceptOuter 不构成当前修订的部署验收。
SQLite 同步 I/O 不提供硬实时延迟或物理文件即时缩小保证；
ACK timeout 为未知写入结果，强停/恢复/清理未知仍维持 unknown 尾部；
日志不充当资源回收或永久历史证明。
