# 独立制品外部验证

本文件服务于 `Deployment.md`，记录外部检查证据，不代表 submitOuter 或 acceptOuter。
未修改产品源码、Inner、Ideal、其他 Idea、生命周期事件或 Git index，未发布 npm。

## 精确验证对象

- 已同步且获准执行的 deploymentRevision：
  `85a1b0636b37b22ef77dcee349067d10d4bab54b`。
- 制品代码基线：`bdb498318a7840ced083ccc23d0d7e71b88c459e`。
- 已接受实现提交：`a9180578f7276a16edf3c94b5470e68e4f88da84`。
- 实际打包提交：`0d54f74a0efc7a0432b6efb49d487dc2c467db6e`。
  执行的 Git 比较确认三个目标包相对基线无差异且没有未提交产品变更。
- 运行环境：Windows，Node `v24.12.0`，pnpm `11.22.0`。
- 最终运行：`terminated-outer-9792e48c-868b-4a14-b297-b6441b0389b0`，
  UTC `2026-10-30T17:06:07.422Z` 至 `2026-10-30T17:06:12.399Z`。

## 制品清单

三个包版本均为 `0.1.0-rc.0`；以下为本次实际 tarball 字节的 SHA-256，不是源码或包名摘要。

| 包 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `@potential-guide/task-protocol` | 14648 | `0ede728419c3362f390dba0c02e5e2a0744fb9ee992988349d025e52061afda3` |
| `@potential-guide/task-engine` | 31165 | `2b7527bf1e4db8c58e33ceefc5248a7138849e02e1781c021151b5eb1f792065` |
| `@potential-guide/task-engine-storage` | 8557 | `fcd0278f1208ed43a02988c39510508c702871e9dbe9e6d151e971140efb717a` |

包分别通过 pnpm pack 产生，独立 consumer 的 dependencies/overrides 仅引用这三个 tarball。
consumer 有自己的 `pnpm-workspace.yaml`（`packages: []`）和 node_modules；
安装使用 `--offline --ignore-scripts --no-frozen-lockfile`，没有源码链接或 workspace 依赖。
消费进程的 `NODE_PATH`、`NODE_OPTIONS` 均已删除并断言不存在。
各进程记录并断言 public exports 的实际 realpath 位于 consumer/node_modules，
包括公开 `task-engine/testing`；没有导入 producer dist、源码或私有模块。

## D 项证据

最终 **26 个场景、233 条命名断言全部通过**。
这些数字来自执行中的 Node assert，而不是仅由 summary 字段宣称通过。
模块隔离、源树比较、脚本一致性及控制器进程退出断言另行执行，不重复计入233条。

| 项目 | 实际证据与结果 |
| --- | --- |
| D-S01 / D-AC01 | 独立 consumer 执行16场景、133条断言：两策略分别成功/失败；事件时间等号与接收 sequence；未完成 prepare 的事件匹配及迟到回调；四组迟到成功/失败与严格 deadline 边界；过去/未来锚点、幂等冲突；超时需求不独自启动但可接受他人驱动的事件；多 owner 取消/超时与未绑定需求保护；最后需求回收；自定义 equals；旧枚举拒绝；完整 prepare 后仍不得加入已启动执行或取得历史结果。 |
| D-S02 / D-AC02：重启 | 3个场景、64条断言。每场景独立进程A写 SQLite，正常完成断言后以预定退出码17模拟进程中断；另一个独立进程B恢复，退出0。覆盖可靠成功、可靠失败及只有 start 的不确定执行。B保持Task/Execution身份、原请求和首次时间锚点；可靠结果时间不变，不确定执行只产生恢复时的 `execution_interrupted`，execute调用数为0。 |
| D-S02 / D-AC02：旧格式 | 7个场景、36条断言。独立进程分别构造并拒绝非空version 0、SQLite v1、unknown、旧checkpoint、旧Facts、旧Binding和live WAL旧checkpoint。公开错误均为 `unsupported_version` 且提示新存储；目录清单与所有原文件 Buffer逐字节相等，SHA-256另行保存。live WAL writer 在比较完成前保持打开，没有 `.inspect-*` 遗留。 |
| D-S02 / D-AC02：清理 | 每个自有子进程均收到预期退出码；消费场景逐一关闭引擎/存储并确认Clock注册清除。控制器最终 `remainingOwnedPids: []`，唯一运行目录删除后stat确认不存在，随后另一次文件系统检查也确认不存在。 |

首轮25场景、222条断言已通过；复核后加强完整准备后的反补绑定断言，并直接比较
后接收事件与原start/final的sequence，再完整执行上述26场景。
随后将保留脚本格式化为仓库要求的LF，避免Git换行规范化破坏已记录脚本hash，
再完整执行26场景、233断言，全部通过。三次制品hash一致，没有发现产品缺陷或
消费断言失败，没有改变部署标准。为避免重复材料，只保留最后一次运行的逐场景记录
与实际执行的LF脚本，其hash可直接与后续Git保存的脚本字节核对。

## 可复核材料

- [最终结构化记录](evidence/terminated-outer-9792e48c-868b-4a14-b297-b6441b0389b0.json)：
  `consumer.scenarios` 保存输入、公开快照、精选事件、预期/实际断言及fake work回收；
  `storage` 保存独立进程PID、公开恢复结果、错误和旧文件前后摘要。
  `commands` 保存全部23条实际命令的command/args/cwd、PID、预期/实际退出码及输出摘要；
  较长标准输出只保存hash，短输出用于核对命令结果，不复制冗长build/install日志。
- 实际执行脚本完整保留：
  [controller.mjs](evidence/controller.mjs)、
  [consumer.mjs](evidence/consumer.mjs)、
  [harness.mjs](evidence/harness.mjs)、
  [storage-child.mjs](evidence/storage-child.mjs)。
  都是外部验证支持材料，不是产品源码。
- 控制器执行前比较缓存目录脚本与保留脚本的实际字节；执行后再次独立计算摘要，
  与最终记录的 `scripts` 清单全部一致。
  另外复核了公开事件sequence、233条预期/实际值、旧文件前后hash和清理路径，
  未只依赖顶层 `status: passed`。

| 实际脚本 | SHA-256 |
| --- | --- |
| `controller.mjs` | `8dc710aed17d599afe9f3b1348a827778285f45fc149d8bc3d6dc382db692084` |
| `consumer.mjs` | `a61a8f668ec3b9e1b10bf80c3150e41d79fda866cc1142d68f40fac148366fbc` |
| `harness.mjs` | `dad6398563d941e2877d27fc049a958ec1754f9f5102f39cc23c602a7a58bc53` |
| `storage-child.mjs` | `d5bc661fc5b897500144487459a3b5fcc4529c34699958072e0f28334bdaa005` |

## 完整执行入口与命令结果

在本工作树根目录执行以下入口；控制器位于新建的自有缓存目录，最终会删除该目录：

```powershell
$evidence = '.silvermoon\ideas\01M66MH9YKNJ406ESX7J1HTY7J\outer\evidence'
$run = Join-Path '.cache' ('terminated-outer-' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $run | Out-Null
Copy-Item -LiteralPath (Join-Path $evidence 'controller.mjs'),(Join-Path $evidence 'consumer.mjs'),(Join-Path $evidence 'harness.mjs'),(Join-Path $evidence 'storage-child.mjs') -Destination $run
node (Join-Path $run 'controller.mjs')
```

实际入口退出0。控制器完整执行的命令类别如下，精确绝对路径与参数见JSON的23条command记录：

1. `git rev-parse HEAD`、两个目标包差异检查、`pnpm --version`：均退出0。
2. `pnpm exec turbo run build --force --filter=@potential-guide/task-protocol --filter=@potential-guide/task-engine --filter=@potential-guide/task-engine-storage --output-logs=errors-only`：退出0。
3. 每个目标包的 `pnpm --dir <包目录> pack --pack-destination <packs> --json`：三次均退出0。
4. consumer内 `pnpm install --offline --ignore-scripts --no-frozen-lockfile`：退出0。
5. consumer内 `node consumer.mjs <outputs\consumer.json>`：退出0，16场景通过。
6. 三组 `node storage-child.mjs write <outcome> <db> <writer.json>`：预期/实际均17；
   对应 `read <outcome> <db> <reader.json> <writer.json>`：三次均0。
7. 七组 `node storage-child.mjs format <kind> <owned-db> <output.json>`：均退出0。

制品、安装、fixture及临时脚本均只位于本工作树唯一运行目录内。
最终 `.cache\terminated-outer-9792e48c-868b-4a14-b297-b6441b0389b0` 已删除；
前两轮自有目录也已删除，未留下detach服务。
原始tarball与fixture按契约清理，准确hash、运行记录及可复跑脚本留在本世界。

## 边界与审查

fake work回收计数证明公开executor协作契约，不声称验证了真实业务worker强制终止。
SQLite恢复确实跨真实独立进程；旧格式文件均是本轮自建夹具，没有触碰真实旧库。
没有虚构通用regulator TaskType，也不把仓库内已有regulator测试冒充本次外部证据。
附加文档检查包装器曾把 no-index diff 的正常差异退出码1误判为检查失败；
没有产生空白错误诊断，已纠正退出码处理。这不是制品场景或消费断言失败。

没有遗留验证阻塞。D项依据上述证据勾选仅表示Agent工作完成；
父代理仍须审查、同步证据并对准确revision履行submitOuter/验收流程。
