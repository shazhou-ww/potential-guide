# Task Run Logs 独立消费者部署证据

> 以下保留当时 v2 候选的原始部署证明，不改写为 v1 证明。用户后续明确纠正：
> 未发布项目统一在唯一 v1 内演进日志，v2 已移除；本历史证明不适用于当前候选。

## 固定候选与授权范围

实现候选：`38c872cfd53a9e0343f05c12f73043f1caf6920b`。
实施验收起点：primary `e21d34f426a217438c680291d5af50759ab7e2d9`。
部署契约在执行前同步于 primary `8d23a6f9bca178109a118b9ce6fbeb6ab567eca5`，
当时 `deploymentRevision=630a1d08c32ff63ac013cdba9eface41e2da0a8a`。
以下验证没有修改该候选的源码、Inner World 或契约要求；新增本证据只补充验证结果。

环境：Windows、Node v24.11.1、pnpm 11.22.0。
本次部署是用户授权的独立本机消费者验证，不是 npm 发布、生产替换或共享服务变更。
凭据由测试进程随机生成，仅用于 loopback 隔离环境，未写入本证据或仓库。

## D-S01 / D-AC01：独立安装与运行

从固定候选执行：

```powershell
pnpm exec turbo run build --filter=@potential-guide/task-engine-server --filter=@potential-guide/task-sdk --filter=@potential-guide/task-engine-web-ui --filter=@potential-guide/check-task --filter=@potential-guide/probe-task --output-logs=errors-only
$env:PGUIDE_KEEP_PACK_CONSUMERS = "1"
node scripts\check-packages.mjs --task-bundles
Remove-Item Env:\PGUIDE_KEEP_PACK_CONSUMERS
```

结果：build **12/12**、独立 package consumer **exit 0**。10 个本地 tarball 安装为
两个独立生产依赖图；生产 host 不安装 SDK、Check、Probe 或业务 Host。
作者源码和 node_modules 访问移除后，真正 v2 Check/Probe bundle 仍执行，
Check 详细诊断通过 HTTP history/SSE 读取，业务 Result/evidence 不变。

消费输出：

```text
Packed v2 Check diagnostics: HTTP history and realtime replay verified; Result/evidence unchanged.
Independent production host: self-contained Check/Probe Bundles, actual negative business results and evidence verified; author node_modules unavailable.
```

固定安装内容如下，SHA-256 是 tarball 字节摘要，不是 Bundle 文件树 digest：

| 包 | 版本 | tarball SHA-256 |
| --- | --- | --- |
| task-protocol | 0.1.0-rc.0 | f8fa2c6a5e91f80718330d6cc8b95162a95e2ab8f531551d427404985dbaab52 |
| task-sdk | 0.1.0-rc.0 | afa2194eff95a20d3dcbb21120d5df9fe8cf68d455f34b559ed13e8d325d8aec |
| task-engine | 0.1.0-rc.0 | f4fcb4e91b051e1504a36b202bbfd4d5dddd25f655442e5d9a35360e8eb6e996 |
| task-engine-http | 0.1.0-rc.0 | 05396e93a0583ea95467f4ff249a58114d5c1defab2a518bb4a9420708b90119 |
| task-engine-storage | 0.1.0-rc.0 | f3c25ecfcde12819d621f6d2e4330a81957e4febc16c869281c1d403ba9a46a4 |
| task-engine-server | 0.1.0-rc.0 | cc43f1efd910993bd8ee8ff915af36f3e5166013b24a56b5b6f052ec0625fda9 |
| check-task | 0.1.0-rc.0 | d17f7b3752f4db23e858645194de2fae39bba6d2ec0198ae69d3ce290e067689 |
| probe-task | 0.1.0-rc.0 | a457253c306895ddd94014d2254c87e72905fd09b62ddcb0dab4fd2aaf30fa94 |
| check-runtime-files | 0.1.0 | 63f1c6e6d2140bffd09810cadb18e5427aac79a44d21472c95c492afc3464484 |
| check-artifacts | 0.1.0 | 9b0bebf63ce19581f364e3bcd1a3e6ab03d46ac390648417484967b41fbd57ce |

Web UI 版本 0.1.0，取相同候选构建的完整 dist，复制到独立目录，
仅含 dist、`type: module` manifest 和私有测试配置；没有 UI node_modules。
独立 UI 以 Node filesystem permission 限制只能读取自己的目录，
因此不能从源码工作区借用依赖。后端从已安装 runtime 包启动新的 SQLite 数据域，
并非源码工作区的 tsx 运行进程。
重现安装与独立 UI 启动步骤见 [运行文档](../../../../docs/task-run-logs.md)。

## D-S02 / D-AC02：真实浏览器与查询结果

独立作者 SDK 构建一个只显式记录 label/index 的测试回调；输入 count=20、waitMs=1000，
每秒 await 一条日志，业务 Result 只包含测试计数 `{ok, stored, dropped}`，没有详细文本。
作者文件与依赖访问在部署前再次移除。两轮独立环境均使用同一个固定 Bundle：

```text
sha256:2f4a38260b280ae54464874d4778c71d27f2dc399c24359c3bffba9d624e04b4
```

第二轮实际并发 Run：

| label | Run ID | 历史条数 | sequence=5 后 SSE 回放 | 业务 Result |
| --- | --- | --- | --- | --- |
| RUN-A | 01M6G2TH212DX2P3YKRJP1BVVX | 12 | 7 | `{ok:true, stored:12, dropped:8}` |
| RUN-B | 01M6G2THJGXYHP45Q0VZBZZ9A3 | 12 | 7 | `{ok:true, stored:12, dropped:8}` |

每页最多 5 条，按 nextSequence 分页取得全部 12 条，条目仅属于其对应 Run，
message 与 fields.label 始终一致，没有跨 Run 输出；二者均观察到正常物理退出和回收。
从 sequence=5 订阅得到 6 至 12 共 7 条，历史与实时续接没有遗漏。

VS Code 集成浏览器实际打开独立 UI 并操作 Run 详情：

- 执行中显示“日志可用；实时跟随”“尾部尚未结束”，连续看到
  `RUN-B diagnostic 0/1/2`、宿主时间、级别和可展开的结构化字段。
- 暂停跟随后保持 12 条保留前缀，明确显示“跟随已暂停”；重新连接使用最后确认游标，
  没有重复条目，容量拒绝后的状态与丢弃计数仍可更新。
- 结束后从头读取历史仍可消费日志；关闭 RUN-B 详情并切换 RUN-A，
  日志内容变为 RUN-A，未保留 RUN-B 的输出。业务结果与日志位于不同区域。
- 详细界面显示“日志已截断 / 输出超限”“已丢弃 8 条；尾部已确认”及实际宿主限额。
- 保留清理后重新读取显示“日志已过期或被容量清理”“完整性未知”“日志游标存在缺口”，
  条目数为 0，不会伪装为从未输出。Logs 区域实测没有水平溢出。

集成浏览器自动动作在连续渲染时出现稳定性等待超时；通过同一页面的键盘事件与 DOM click
完成观察，并取得实际页面快照和截屏，不把超时操作计作通过。
既有生命周期集合流在长时间观察中断连时显示陈旧快照提示，Logs 可独立重新读取；
没有为这项已有集合观察行为修改本次实现。

## D-S03 / D-AC03：实际限额、权限与保留

两个独立环境使用相同有限参数：

```json
{
  "enabled": true,
  "entryBytes": 16384,
  "runBytes": 8192,
  "runEntries": 12,
  "totalBytes": 32768,
  "maxRuns": 4,
  "retentionMs": 60000,
  "pageSize": 5,
  "maxSubscriptions": 2
}
```

实际结果：

- 每个 Run 发出 20 条，恰好持久化 12 条、拒绝 8 条，state 为 truncated、dropped=8；
  正常业务完成与资源回收不受超限影响。
- 同一独立 SQLite 查询 `SELECT count(*), sum(bytes) FROM run_logs` 得到
  **2 个记录 / 5104 body bytes**，小于 maxRuns=4、totalBytes=32768；
  两个 Run 各 12 条，小于独立 runBytes=8192。
- 未认证 GET logs 返回 **401**，随机凭据的另一 scope 返回 **403**。
- 从真实浏览器通过受控 UI proxy 为另一个活动 Run 打开三个 SSE，
  实际状态依次为 **200、200、429**，随后中止连接；
  中止立即释放容量的边界另由父任务核心回归验证，本轮不声称额外重新准入已测试。
- 第一轮两 Run 正常结束后超过 60 秒读取，均为
  `{availability:"expired", gap:true, entries:0}`；第二轮真实 UI 亦观察到对应提示。
  不用空数组冒充完整日志。
- Web UI 使用既定 300 条 / 1 MiB 窗口；本轮保留输出未超过窗口。
  极限窗口裁剪与慢消费者的实施边界测试已在 Inner World 验证，不把小样本当作无穷负载证明。

订阅限额试验的回调故意不处理取消信号。取消后发生强制退出，已有策略保留
cleanupUnknown；关闭第二轮 Engine 返回明确 `reclamation_failed`，没有伪造正常回收。
这符合构想的“原生命周期语义不变”：日志未绕过独立物理清理门限。
第二轮测试进程以该明确错误退出；第一轮正常退出 exit 0。
随后确认两轮 Server/UI 的准确 loopback 端口全部 ECONNREFUSED，没有留下测试服务。
本次拥有的临时 tarball、独立安装、数据库及 UI 配置在记录证据后清理。

## 限制与检查状态

逻辑日志 body/metadata/队列有界，不承诺 SQLite 物理文件即时缩小或安全擦除；
同步 I/O 不提供硬实时磁盘延迟；ACK timeout 表示写入结果未知，不能自动重试；
Worker 不是安全 sandbox，作者仍负责选择非敏感字段。未发布 npm、未变更生产认证策略。

实施相关最终验证通过：父任务核心 13/13、SDK 9/9、UI 5/5、构建 12/12、
类型与格式检查 exit 0、独立消费 exit 0。
`pnpm check` 已执行，最终 68/70 successful，但仍因原有
objective-monorepo-standard 对已存在 SKILL.md 的职责分类检查失败；
该文件和分类实现未被本次修改。本次不声称全量 check 全绿，也不修复无关基线问题。
