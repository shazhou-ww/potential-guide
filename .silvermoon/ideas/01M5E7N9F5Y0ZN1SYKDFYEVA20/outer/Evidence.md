# 隔离 tarball 消费证据

本阶段只新增部署支撑和证据，没有更改 accepted inner/ideal 或 packages/scripts 交付。这里的 runner/resolver 为**确定性 in-process fixture，不是真实 Agent/process 集成**；旧 CLI capability-feedback 超时仍保留为已接受 baseline 限制。

## 准确执行身份

- 已接受 implementationRevision：`271a21e6881e739c6cb9100dac298a0a4deb8bdf`。
- 接受提交：`f441ae05bedffb80ec6b1b888672d5947d367f8f`；新包源树与该提交完全一致。
- 成功执行前同步的合同 deploymentRevision：`978eae99f062e7e46442e3c7ab6093f34b44c1b9`。
- 合同及源码提交：`d98e68f4a7380e408835e7121f22a3548ed4f89a`，已在执行前确认 reachable from primary。
- 执行时间：`2026-10-21T05:47:26.664Z` 至 `2026-10-21T05:48:39.932Z`。
- Node `v24.11.1`，pnpm `11.22.0`。
- [完整机器结果](./verification/Result.json) SHA-256：`a8f5ba127bd263d07aa241512d61fd42319d2d12ee8621a7d110a14ebad6988b`。

成功后只增加本证据、Result 和 ledger 勾选，没有再改变 Deployment.md 或运行输入。最终 outer revision 因新增证据变化是正常证据装配，不冒称该最终 tree 在执行前已经存在；执行合同 revision、输入身份及输出摘要可逐项审计。

变更边界按本任务自有提交判断，不把整个 primary 的并发增量归为本任务。同步时普通快进保留 `7596356` 的其他 IDEA 验收及 `a8a9a15` 的新 IDEA 历史，没有删除其事件或重写历史；这些并发文档不是本任务交付。accepted inner/ideal、packages/scripts 的独立 diff 已核对为空。

## 本地产物

六个内部包均由本 worktree 的已构建输出经 `pnpm pack` 生成，检查 ESM 入口、声明、README/LICENSE 和无 src/test/tsbuildinfo。完整 Git tree、入口/声明 SHA、文件数量及命令记录在 Result。

| 包 | 版本 | Tarball SHA-256 |
| --- | --- | --- |
| `@potential-guide/effects` | `0.1.0-rc.0` | `0fe03517fa0d74ee2e6f6d45fa1b9716fd3de939c80654ed3283478b5b6c7c00` |
| `@potential-guide/regulation-coordinator` | `0.1.0-rc.0` | `8329b9fef059ba859da890b11b5c4eb89933b001e1f1e6d2ffcd5ab167f02ba3` |
| `@potential-guide/objective-pilot` | `0.2.0-rc.0` | `1533bb3dbe1b1bcdda6677aa56aae0e670ba4ac9bd075c754a50deab7224b55f` |
| `@potential-guide/pilot-protocol` | `0.1.0-rc.0` | `9e82cac5b1129ec717385541145b3290c0aecdbf08a888574359660721ba4247` |
| `@potential-guide/objective-regulator` | `0.4.0-rc.0` | `154bb22d8974f4f57ef8adb5bdc7c444c75c99a95722f076d217b5851bc40b32` |
| `@potential-guide/objective-portfolio-supervisor` | `0.4.0-rc.0` | `ad580dde6e798d4cd68601e9274060c3f11c7e7de2d3e853f1dc94a3ed4c1c36` |

新包 Git tree 为 `39976b20244bb46677b9b6bd80e6a8e52b86c475`；入口 JS SHA 为 `3ffc6f38e1711e32e55f8741d06f08953103e4a87117ac399d465b10785c7c0d`，声明 SHA 为 `63f98b7b4eb2bf66a12a01eec584881048edc1caa11abd03b66da86bc966e5a6`。

完整第三方 production 闭包九包也由本 worktree 已安装的分发物物化普通文件后本地打包：`effect@4.0.2`、`ajv@8.20.0`、`fast-deep-equal@3.1.3`、`fast-uri@3.1.8`、`json-schema-traverse@1.0.0`、`require-from-string@2.0.2`、`jsonata@2.1.0`、`json-schema-typed@9.0.0`、`yaml@2.9.1`。各 manifest/tarball SHA 和来源均记录在 Result；生命周期 scripts 禁用，逐项核对非 manifest archive 条目大小。不把这些本地分发物 hash 冒充 registry 发布身份或真实外部部署证据。

工作区 lock SHA 为 `fed77545e909aa22b1f56f12357b2e175764c407e2a26a19c81b96ab932e05eb`，consumer lock SHA 为 `08db065768c157bd9d31fa8e98f52ceacff8e79051f0f0ffbf7fb6ada3587853`。

## 安装与最小验证

历史成功命令（在上述已同步合同提交运行）：

```powershell
node .silvermoon\ideas\01M5E7N9F5Y0ZN1SYKDFYEVA20\outer\verification\run.mjs --contract-revision 978eae99f062e7e46442e3c7ab6093f34b44c1b9
```

driver 内实际执行：

1. 六包闭包的 Turbo build，退出 0。
2. 六次内部 pnpm pack、九次第三方 npm pack（ignore-scripts），均退出 0。
3. 独立 consumer 的 `pnpm install --offline --ignore-scripts --no-frozen-lockfile --reporter=append-only --store-dir <本次隔离目录>\pnpm-store`，退出 0。
4. 复用 `scripts/deployment-consumer.mjs` 的 verifyConsumerGraph，六包物理解析路径都在 consumer 内，无 workspace range，无源码/全局链接回退。
5. consumer 独立 tsc（NodeNext、strict、noEmit、types=[]，无 paths/source 映射），退出 0；包含资源第一参数、budget 必填及 command 不得授权的负类型断言。
6. `node --test --test-concurrency=1 <consumer>\consumer.test.mjs`，退出 0；7/7，fail/skip/cancel 全为 0，约 1721ms。
7. `run.mjs --check-evidence`，退出 0，确认输入 hashes、命令退出及清理数据；补充 Git diff 和 LF 规范化比对证明材料对应执行前已同步源码。

成功执行共 35 条子命令，全部 exit 0、closed=true、timedOut=false。安装日志记录 `Packages: +15`、`resolved 15`、`reused 0`、`downloaded 15`，约 8.8 秒；这里 downloaded 表示读取 **file tarballs**，命令为 offline，不是 registry 下载。三个直接入口是 effects、Coordinator、旧 Portfolio Supervisor；15 包全部来自本地 overrides。

实际导入的三个公共入口均解析到 consumer 自身 `.pnpm/.../dist/index.js`，JS bytes 与打包前 hash 相等。没有导入 `packages/.../src`，没有全局 link 代替安装，工具链 TypeScript 仅作为编译器，声明解析来自隔离 node_modules。

## 七项运行断言

| Case | 可观察结果 |
| --- | --- |
| `residency-multicast` | 有限 command 已结束、资源仍为空；随后资源变更启动执行，结果反馈仍有效；两个输出订阅共享同一 run，实际 starts=1 |
| `failure-recovery-idle` | 注入权限命令 rejected，执行 result 拒绝转 failure，非法资源暂停分配；合法资源恢复后正常执行，完成后 idle 仍接受新工作 |
| `minimum-sharing-reclamation` | 两 roots 的同一 provider 只启动一次；错来源 progress 不唤醒；L1 仅启动 low，high 等 L3；取消 low 后 provider 不 abort；L3 后 high 重新 Regulation；最后引用消失时 stopping 仍保留 lease，kill 确认才回收，acquisitions/releases=2/2 |
| `cancel-confirmation` | cancel 后已请求 kill 但未确认时 starts=1、无 terminated；确认后第二任务才开始，starts=2 |
| `budget` | 可信 maxStarts=1 时第二工作、retry 和 replace 都不能续预算，实际 starts=1 |
| `same-scope-cleanup` | 同 Effect.scoped 的慢消费者自动得到 subscriber-released → abort → kill-confirmed；watchdog 未介入，无自身订阅自锁 |
| `legacy-supervisor` | 同次 tarball 安装的旧 Planner+Coordinator 公开 API 组合只执行一次，达标后队列清空、runs=0，两个服务都显式 close |

所有 runner 是确定性模拟：新 Coordinator 总 starts/terminated 为 **13/13**，abort/kill 为 **4/4**，lease acquisition/release 为 **2/2**，scope open/close 为 **7/7**，输出 subscription open/close 为 **8/8**，最终 activeExecutions=0。旧服务另有独立 starts=1、runs=0 和两个 close 断言，未假装运行 ACP Agent 或操作系统进程树。

## 失败获取尝试与受控清理

每次获取策略变化都先修改、验证、同步合同，再按新的 deploymentRevision 运行，未在旧合同下静默改变输入。

| 执行合同 | 结果与边界 |
| --- | --- |
| `a03ac8eac05f0a4786af92b656f88ad22bcda7ad` | 六包打包成功；strict-offline 缺 effect metadata，安装退出 1，尚未运行 consumer |
| `440a6e1bd8f9abc690fafee50c3f784782385136` | cached-first 的 registry 请求 TLS handshake failure，安装退出 1；没有禁用 TLS 或改设备配置 |
| `576d0978e1225545f2cac9fbc190137effd214fd` | 15 包离线安装和 types 编译通过，但直接重打包 pnpm 硬链接造成 AJV schema archive link 条目为零，运行模块加载失败，未执行七项业务 case |
| `978eae99f062e7e46442e3c7ab6093f34b44c1b9` | 先物化普通文件、核对 archive 大小，再真实 tarball install，全部通过 |

已核对本 worktree 原 AJV schema 为 420 bytes，npm archive 的同内容 link 条目显示 0；这定位的是分发物重打包问题，不是 Coordinator bug。只改部署支撑，未编辑第三方源内容、accepted implementation 或既有服务。网络失败没有归因到 package-settings 或其他参与方设备状态。

以下 operation-owned 隔离目录及 tarballs、安装、store/cache 均已删除并逐个复查不存在（均位于当前 worktree 的 `.cache`）：

```text
regulation-coordinator-deployment-1792560759883-13344
regulation-coordinator-deployment-1792560891280-23940
regulation-coordinator-deployment-1792561301951-15392
regulation-coordinator-deployment-1792561646664-25988
regulation-coordinator-ajv-probe-14696
```

诊断 probe 的首次 PowerShell 删除遇 Windows 长路径，随后用 Node fs.rm 清理并复查 false。每个 driver 都在 finally 删除自己的唯一目录；所有记录的子进程均收到 close。成功测试 Node 父 PID 为 28760，正常退出 0；没有留下 dev server/watcher/真实 Agent 进程。保留的是版本化结果与摘要，不是运行目录。

## 输入身份与复跑约束

下列执行输入在成功后未改变，Git blob 指向执行提交 d98e68f；另已比较 LF 规范化文本与该提交完全相等。Result.inputs 是本次实际工作区字节的 SHA，可能含 Windows CRLF 差异，不把 raw SHA 冒充 Git blob。

| 输入 | Git blob |
| --- | --- |
| Deployment.md | `f29bc38679777cb90bcc4b7c4c6403890c22be02` |
| verification/run.mjs | `13f2cf597f139e14005bb0d2d523d71dae6d9d80` |
| verification/consumer.test.mjs | `7e764e4a157444a0f586776c00a9bebe0390432d` |
| verification/consumer.ts | `43e9bb71abfd07d7b190cd0e37af784112f21774` |

当前 checkout 的只读重验命令：

```powershell
node .silvermoon\ideas\01M5E7N9F5Y0ZN1SYKDFYEVA20\outer\verification\run.mjs --check-evidence
```

若要重新生成执行证据，应先同步当前合同、从最新报告取 deploymentRevision，再把它传给 `--contract-revision`；不能在新 outer tree 上直接复用历史 revision。重新生成 Result 会使既有阶段提交过期，须重新同步/submit；新 checkout 的换行差异可先按上表 canonical blob 比对或重新执行，不能直接伪造旧 raw 输入 SHA。

## 保留的限制

- 没有真实 Agent/process runner 集成、registry 发布身份或全局设备部署证明。第三方来自本 worktree 已安装分发物，已如实记录来源/hash；不证明其与 registry 原始 tarball byte-identical。
- 所有权限、budget/quota/concurrency 来自可信构造配置；progress 不授权、不续预算；base fixture maxStarts=20，专门 budget case maxStarts=1，没有“默认只准一次”的产品策略。
- bounded/lossless 输出需要持续 drain 或取消；cancel/close 不旁路。推荐同 scope 先 acquire service 再 forkScoped interruptible consumer；需 cleanup facts 的外部消费者必须继续 drain，不能在自身阻塞回调里等待 close。
- 未运行全量 pnpm check；上一阶段已披露并由主 Agent 接受的唯一旧 CLI capability-feedback 超时不因本次旧服务 smoke 而宣称修复。
- 所有显式工作目录和产物位于当前 worktree；没有 publish、全局 install/link、设备入口切换或用户配置写入。package-settings 的并发设备状态未检查、未归因给本任务。
