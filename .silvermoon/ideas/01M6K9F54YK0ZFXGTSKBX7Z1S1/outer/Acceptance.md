# 2026-11-06 独立交付验收证据

Idea：`01M6K9F54YK0ZFXGTSKBX7Z1S1` / `pnpm-check-performance`。本轮验证源码为刷新后的 primary `3be07d321a57637e9189eda452cfb2f5703eb295`。契约验收标准、已接受 Inner/Ideal、仓库源码和依赖清单均未修改；只更新当前 Outer 证据及镜像 ledger。验收授权不包含接受或完成该 idea。

## 三类结论与提交绑定

1. **CI 覆盖证明**：`42209946131` 绑定 `3be07d321a57637e9189eda452cfb2f5703eb295`；7 jobs 及下表必需 steps 全部实际 success，依原 D-S01 / D-AC01 判定覆盖。它不是性能测量。
2. **本地环境与检查结果**：独立 store 安装 exit 0，实际路径与配置核验成功，绕开原 SQLite 故障；完整 `pnpm check` 仍因 `pguide-task-bundle` symlink `EPERM` exit 1，检查未通过。
3. **性能证明不足**：旧 artifact 的 SHA-256、测量字段和门槛复核只确认旧证据真实性及旧候选结果。`3be07d32` 相对 `c50c6fac` 的可执行路径实质漂移，D-S02 / D-AC02 仍不通过，不证明当前性能。

首轮证据经普通 merge 同步于 `2d1445e142bf685d72481ec37f357e9e9ee3638a`。补充索引前又正常整合已观察 primary `fc043fc651d5fbefcb70553427827e1883bf39af`，保留其他 idea 的并发证据。以上 CI、本地检查和漂移证据始终绑定实际验证源码 `3be07d32`；同步提交只是证据载体，不是新提交的成功检查或性能样本。历史八轮始终绑定 `b330d934` / `c50c6fac`。本次补充不再运行失败检查来制造新的性能样本。

## D-* 结论

| ID | 结论 | 证据及限制 |
| --- | --- | --- |
| D-S01 | 完成 | 绑定上述提交的真实 main CI，必需五项 job 及关键验证 step 均成功；另两个新增 job 也成功。 |
| D-S02 | 未完成 | 历史八轮数据已重校验，但当前检查执行代码与被测候选实质漂移，无法证明当前收益。 |
| D-AC01 | 满足 | 两个 Node 完整检查、三个平台打包部署及实际消费者日志均通过；不是仅聚合 success 推断。 |
| D-AC02 | 不满足当前验收 | 历史候选达到门槛；当前 primary 的候选一致性不成立，本地完整检查也未成功。 |

## 真实 CI：当前成功与旧失败分开

[当前运行 42209946131](https://github.com/shazhou-ww/potential-guide/actions/runs/42209946131)，attempt 1，event `push`，branch `main`，source `3be07d321a57637e9189eda452cfb2f5703eb295`，整体 `success`。完整 job 及所有 step 的 status/conclusion 见 [CurrentCI.json](./CurrentCI.json)。

| Job ID | Job | Conclusion | 实际必需 step | Step conclusion |
| --- | --- | --- | --- | --- |
| 127866047560 | Node.js 22.13.0 | success | Run all checks | success |
| 127866047656 | Node.js 24.11.1 | success | Run all checks | success |
| 127866047521 | Packed CLI (ubuntu-latest) | success | Verify packed CLI deployment | success |
| 127866047787 | Packed CLI (macos-latest) | success | Verify packed CLI deployment | success |
| 127866048091 | Packed CLI (windows-latest) | success | Verify packed CLI deployment | success |
| 127866047235 | Isolated package consumers | success | Validate isolated package consumers | success |
| 127869816957 | Release verification (v1) | success | Confirm all release checks passed | success |

原始日志另显示三个平台的隔离消费者、打包 CLI 验证实际执行，不只是在 job 上返回 success；精确 job/step、时间戳及消费者通过记录见 [PlatformConsumers.txt](./PlatformConsumers.txt)。当前 CI 比原契约要求的五项多两个 job；不修改契约数量或删除任何保障。

[旧运行 41865501035](https://github.com/shazhou-ww/potential-guide/actions/runs/41865501035/attempts/3)，attempt 3，source `17cec879cf0f14c5df7dba8ddc551f2047396948`，整体 `failure`。macOS job `126722337365` 为 `cancelled`，`steps: []`；Node 22/24、Linux、Windows 四项为 `success`。详见 [PreviousCI.json](./PreviousCI.json)。没有补跑或将该旧结果改记成功；当前成功不是同一次运行的重试。

复核命令：

```powershell
gh run view 42209946131 --repo shazhou-ww/potential-guide --json headSha,status,conclusion,jobs,url
gh run view 41865501035 --repo shazhou-ww/potential-guide --json headSha,status,conclusion,jobs,url
gh run view 42209946131 --repo shazhou-ww/potential-guide --log
```

## 性能：重校验原始字节，不外推当前版本

2026-11-06 重新下载 [同机配对运行 41849316869](https://github.com/shazhou-ww/potential-guide/actions/runs/41849316869) 的两份 artifact，八个原始 JSON 保存在 [raw/](./raw/)。脚本逐份验证 SHA-256、全部测量字段（含阶段时长）、source revision 和退出码，与未改动的 [Inner 原始汇总](./inner/Measurements.json) 完全一致；八轮 code 均为 0。复核结果见 [MeasurementRecheck.json](./MeasurementRecheck.json)。

| Node | 缓存 | 控制秒 | 候选秒 | 改善 | 门槛 | 适用结论 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 22.13.0 | 冷 | 766.101064478 | 578.885321177 | 24.44% | >=10% | 历史配对通过 |
| 22.13.0 | 热 | 191.535073509 | 89.352847719 | 53.35% | >=25% | 历史配对通过 |
| 24.11.1 | 冷 | 384.789234034 | 314.545326798 | 18.26% | >=10% | 历史配对通过 |
| 24.11.1 | 热 | 111.693422797 | 48.072189282 | 56.96% | >=25% | 历史配对通过 |

控制为 `b330d934fe9fea5073f885340e1d26b55d1d7090`，候选为 `c50c6fac463b903f224056321ef96a780cef7a65`，harness 为 `474dad91a88cf5a32fecd5cfc18591d7a450fa47`。Node 22 的四轮在同一 runner/image `20261025.179.1`，Node 24 的四轮在其独立 runner/image `20261101.186.1`，均为 pnpm 11.22.0；不跨 Node 混比绝对时长。冷轮不含安装，指空 build/staging/Turbo；热轮复用同一 checkout 缓存，不是冷 OS/page-cache 对照或统计显著性试验。两 job 的 `Verify candidate worker cache restoration` step 实际 success，日志均为 38/38 cached 和逐字节恢复，见 [HistoricalCacheProof.txt](./HistoricalCacheProof.txt)。

本轮没有重新跑八轮 benchmark。当前契约要求复核已固定的配对 workflow，并证明当前代码与该候选一致；第二项已明确不成立。共享宿主存在并发子会话负载，本地单次快跑、热缓存或 CI success 均不能用来补足性能验收。

离线重校验与原始下载命令（在仓库根目录）：

```powershell
node .silvermoon\ideas\01M6K9F54YK0ZFXGTSKBX7Z1S1\outer\VerifyMeasurements.mjs
gh run download 41849316869 --repo shazhou-ww/potential-guide --dir .cache\deployment-acceptance\paired-artifacts
gh run view 41849316869 --repo shazhou-ww/potential-guide --log
```

实际测量命令为冻结 harness 的 `node harness\scripts\measure-check.mjs control cold`、`control warm`、`subject cold`、`subject warm`，每个 Node 的同一个 job 顺序执行，最后运行 `node subject\scripts\verify-worker-cache.mjs`；精确 checkout、安装和缓存条件见原 workflow 及 [Performance.md](./inner/Performance.md)。这不是在当前 Windows 工作区直接执行即可成立的公平对照。

## 当前代码一致性阻塞

[ExecutionDrift.diff](./ExecutionDrift.diff) 保存候选到本轮 primary 的关键实际差异，比较命令为：

```powershell
git diff --unified=0 c50c6fac463b903f224056321ef96a780cef7a65 3be07d321a57637e9189eda452cfb2f5703eb295 -- package.json turbo.json scripts/build.mjs scripts/check-generated-sources.mjs .github/workflows/ci.yaml
```

根 `check` 阶段顺序虽相同，其实际执行已经改变：`build` 从直接 Turbo 改为 build adapter，另执行环境 verify；`sources:check` 移除 task-workers 校验、生成源码快照列表缩小；根脚本测试增加 `--test-concurrency=2`；Turbo 环境输入和 verify 图变化。另有消费者和产品代码变化。由此不能声称最新主分支与 `c50c6fac` 相同或仍满足其测量收益。

开发文档仍给出默认 `pnpm check` 和完整 `pnpm check && pnpm deployment:verify`，但 README 仍提及已从当前快照保护列表移出的嵌入 task Workers。这里只报告直接相关文档/实现漂移，不在 deploying 修改源码或已接受 Inner。补齐当前收益证明及文档一致性需要另行授权的范围处理，不能降低门槛或把既有 CI 时长改当配对样本。

## 独立依赖恢复与本地完整检查

本地 Node `v24.12.0`、pnpm `11.22.0`、Windows x64，不是历史配对的 Node/image。首次 `pnpm check` 因工作区缺少依赖自动恢复，使用宿主 `D:\.pnpm-store\v11` 后报 `ERR_PNPM_ERR_SQLITE_ERROR: database disk image is malformed`，退出 1。环境变量 `npm_config_store_dir` 的尝试没有切换实际路径，仍报同错；不能把它称为隔离成功。未清空、修复共享 store，也未修改宿主全局配置。

明确 CLI 参数恢复成功（exit 0），实际路径日志为 `D:\Code\potential-guide.worktrees\pnpm-check-performance-validation\.cache\acceptance-store\v11`，见 [IsolatedInstall.txt](./IsolatedInstall.txt)。依赖清单和 lockfile 对验证提交无差异。网络曾有 ECONNRESET 自动重试，但安装最终成功；不绕过 registry 策略或发布 npm。

```powershell
pnpm install --frozen-lockfile --store-dir 'D:\Code\potential-guide.worktrees\pnpm-check-performance-validation\.cache\acceptance-store'
pnpm --config.store-dir='D:\Code\potential-guide.worktrees\pnpm-check-performance-validation\.cache\acceptance-store' config get store-dir
pnpm --config.store-dir='D:\Code\potential-guide.worktrees\pnpm-check-performance-validation\.cache\acceptance-store' check
git diff --quiet 3be07d321a57637e9189eda452cfb2f5703eb295 -- package.json pnpm-lock.yaml
```

运行时 `--store-dir` 直接传给 `check` 会因 `Unknown option: store-dir` 退出 1，需使用上述受支持的 `--config.store-dir`。后者确认 store 配置并真实运行完整检查：sources/layers、format、lint、typecheck 已通过，进入 test 后 `pguide-task-bundle` 的 CAR 和 init 文件 symlink 测试报 `EPERM`，Turbo 显示 42/47 successful，根退出 1；后续根脚本测试和 pack 阶段未完整执行。关键原始日志摘录见 [LocalCheck.txt](./LocalCheck.txt)。

五个实际 `EPERM` 失败用例的源码定位（均对应 `3be07d32`，不是事后修改过的测试）：

| 失败用例 | 定义 / 失败 symlink 行 | 原始错误 |
| --- | --- | --- |
| CAR input rejects symbolic links without reading their target | [car-files.test.ts:67](../../../../packages/pguide-task-bundle/test/car-files.test.ts#L67) / 70 | `bundle.car` -> `alias.car` |
| link | [init.test.ts:185](../../../../packages/pguide-task-bundle/test/init.test.ts#L185) / 194 | `custom-ignore` -> `.gitignore` |
| broken-link | [init.test.ts:185](../../../../packages/pguide-task-bundle/test/init.test.ts#L185) / 194 | `missing` -> `.gitignore` |
| manifest | [init.test.ts:397](../../../../packages/pguide-task-bundle/test/init.test.ts#L397) / 414 | `outside/package.json` -> `task/package.json` |
| broken-template | [init.test.ts:397](../../../../packages/pguide-task-bundle/test/init.test.ts#L397) / 418 | `outside/missing.ts` -> `task/src/main.ts` |

精确固定源码：[CAR 用例](https://github.com/shazhou-ww/potential-guide/blob/3be07d321a57637e9189eda452cfb2f5703eb295/packages/pguide-task-bundle/test/car-files.test.ts#L67)、[gitignore 用例](https://github.com/shazhou-ww/potential-guide/blob/3be07d321a57637e9189eda452cfb2f5703eb295/packages/pguide-task-bundle/test/init.test.ts#L185)、[manifest/template 用例](https://github.com/shazhou-ww/potential-guide/blob/3be07d321a57637e9189eda452cfb2f5703eb295/packages/pguide-task-bundle/test/init.test.ts#L397)。完整失败命令为上方受支持的 `pnpm --config.store-dir=... check`，日志摘录保留五次 `EPERM`、42/47 任务结果和根退出 1；不是只执行定向测试后的结论。

这是宿主符号链接权限阻塞，不是此次证据更新引入的实现失败；没有跳过测试、提权、修改系统设置或包装成功。该失败运行不作为任何冷/热成功样本，也不执行另一个性能轮次掩盖失败。

## 后续范围与授权

D-S01 / D-AC01 已完成并镜像 ledger；D-S02 / D-AC02 保持未完成。先处理当前候选一致性、收益证据及直接相关文档范围；如需实质改变部署契约，应先同步 primary 并观察准确 revision，再验证。此次不提交 `submitOuter`，不请求或记录 `acceptOuter`，不记录 completed。CI 通过仅解除原 macOS 排队阻塞；性能阻塞与本地权限限制分别保留。
