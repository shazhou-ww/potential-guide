# 实施验证

2026-11-03 在独立工作树接续 `8c817d434f81ed2aef3dd624d6ac8aeb226b8e56`；
2026-11-04 按父代理独立复核修复测试隔离问题。
Node `v24.11.1`、pnpm `11.22.0`；本记录是 Inner 实施证据，不是 Outer
部署结果或审批。accepted Ideal 与 `events.jsonl` 未改，不 commit/push、
submit、accept 或 waive，不运行外部 Kubo，不发布 npm。

## 实现与边界

- 交接中的 TypeBox 作者输入、生成运行声明/精确清单、SDK 纯构建/成品检查/发布
  分离、严格 Engine 装载和直接调用方迁移继续使用同一新契约。
- 补齐 readonly、数组、Record、本地片段、可选属性、额外属性和 Never 的运行正反例，
  以及 message/readonly/tuple 的编译期正反例。Tuple 的非 `false`
  `additionalItems` 覆盖现在明确拒绝，不在 Draft 2020-12 转换时静默丢弃。
- 修复嵌套 contract 的 `__dirname`：以 contract 文件目录而非构建描述目录为根，
  并以可信模块读取同目录数据文件的用例证明 author check 不写出成品。
- 新增/删除资源后 clean 重建、不同作者根的 Worker 字节/CID 一致、失败保持旧成品、
  未知归属/现存锁拒绝及恢复文件保留都有测试。锁诊断提示人工检查，
  不自动删除其他进程或崩溃留下的锁。
- 发布仅用成品；测试删除回调与构建描述、令 contract 求值必抛错后仍成功发布。
  CLI 通过真实 loopback HTTP 请求与 Kubo RPC client 验证
  命令行 > 最近项目 > 用户配置、无默认节点、错误 URL/额外文件在 RPC 前失败。
  此 HTTP fixture 不是实际 Kubo daemon。
- 发布 SDK 测试验证单字节快照、块和根 pin 回执、成品不改写。
- `--bundle-authoring` 只打包所需 workspace 运行依赖闭包，提供独立安装入口。
  它检查独立 binary 和 pguide dispatch；然后删除作者源码并隐藏作者 node_modules，
  在另一份仅安装 Engine 的 consumer 中仅凭 CID 运行生成的真实 Worker。
  生产消费安装不含 TypeBox、作者 CLI 或 task-sdk。
- 完整 pack 检查发现 SDK consumer 的旧直接声明验证仍缺 `include`；
  已同步 fixture 到严格清单契约，没有引入旧成品兼容回退。

## 已执行结果

| 命令 | 结果与范围 |
| --- | --- |
| `pnpm --filter @potential-guide/pguide-task-bundle test` | 最后 14/14 通过，覆盖上述 Schema、文件、确定性、锁、快照、RPC/配置与 CLI 边界。最初缺 dist 的失败发生在新工作树尚未 build 时；构建后正常重跑，未把该次失败当作功能结果。 |
| `pnpm --filter @potential-guide/pguide-task-bundle... build` | workspace 构建依赖链通过。 |
| `pnpm --filter @potential-guide/task-sdk test` | 14/14 通过。 |
| `pnpm --filter @potential-guide/task-engine test` | 160/160 通过，包含 bundle admission 与真实 Worker 回归。 |
| `pnpm exec tsc -p tsconfig.test.json --pretty false` | 通过；包含 Schema 同源 input/result/message、tuple/readonly 的预期编译错误。 |
| `node scripts\check-packages.mjs --bundle-authoring` | 最后通过：真实独立 executable shim、pguide dispatch、成品发布与独立 Engine/CID-only Worker；18 个所需本地包完成打包，作者 consumer 4 个直接入口/17 个内部依赖，独立 host 无作者依赖。 |
| `node scripts\check-packages.mjs --task-bundles` | 通过：独立生产宿主上的 Check/Probe 成品、实际负业务结果、诊断 history/SSE 与证据；不访问已有 Kubo。 |
| `node scripts\check-packages.mjs` | 最后无并行 suite 干扰的完整运行退出 0；19 个 isolated consumer 场景全部通过，含修复后的 SDK 清单 fixture、mvp-check、真实 standalone 作者 binary、独立 TypeBox 成品/Engine 消费和 combined 安装。最终自有安装树正常清理，无 stale-output 阻断。 |
| `pnpm exec turbo run test --continue=always --concurrency=2` | 71/72 tasks 成功，唯一失败为下述既有 monorepo file-classification；check-task 20/20、probe-task 19/19、web-ui 91/91 通过，先前并发启动超时未在此轮重现。 |
| `node --test scripts\*.test.mjs` | 37/37 通过；registry/publish 相关单测使用其既有测试替身，没有执行真实 npm 发布。 |
| `pnpm check` | 上一轮本代理最后退出 1：build、layers、format、lint、typecheck 均通过；该轮 test 唯一失败列表项为既有技能分类 `unverified`，作者 14/14 通过。这不证明所有独立运行都只有该问题，父代理后续发现的本 Idea 测试竞态及修复见下节。root script tests 与完整 pack 在此命令内未到达，已分别用上列命令完成，不能称为整条 `pnpm check` 通过。 |
| `silvermoon check --worktree --audience agent` | 上一轮候选检查通过；本轮 primary 已前进而尚未整合，当前快照检查结果见下节。无事件追加或审批。 |

初次 `pnpm check` 的 build、layers、format、lint、typecheck 均通过，
test 受到既有分类失败及 Engine readiness 超时阻断；
第二次还出现 check-task 子进程 readiness 超时。低并发补全结果见上表，
没有把被中断、未执行的 suite 计作通过。
可丢弃原始日志保存在 `.cache\task-bundle-validation`，不作为换设备必需输入；
本记录、测试源码和命令才是可重跑的持久化证据。

I-S01～I-S03 与 I-AC01～I-AC03 的实施/证明工作已完成并镜像到 ledger，
包括按契约保存完整检查的基线问题；这不是对该失败的豁免，也不是 Inner 审批。
D 项仍未勾选，真实 Kubo、外部发布与消费由父代理在审核后进入 Outer 执行。

## 父代理复核与测试隔离修复

父代理独立运行 `--bundle-authoring` 通过，保留其自有
`.cache\potential-guide-packs-vASuDL`；本代理未修改或清理该目录。
父代理随后运行 `pnpm check`，在 `.cache\parent-bundle-check.log` 中发现
`scandir packages\pguide-task-bundle\.test-task-authoring\8518d13d-e17d-4f18-9b24-4fa3586e3619\assets\nested`
的 `ENOENT`，连带报告 `global-config`、`package-layer-inventory`、
`delivery-mapping` 失败。这是本 Idea 作者 fixture 的隔离缺陷，不是既有技能分类
失败或标准扫描器缺陷；上一轮“只有分类问题”的观测不能覆盖该独立失败。

已读取并遵循 `packages\task-sdk\test\streams.test.ts` 与
`packages\check-task\test\file-source.test.ts` 的 `.cache` 先例：
每个作者 fixture 改为包目录下 `.cache\task-authoring-<UUID>`，
只删除自己拥有的 UUID 子目录，不删除共享 `.cache` 父目录。
包目录仍在依赖解析祖先链上，TypeBox/SDK 解析正常。
现有 inventory 已排除 `.cache`，无需也没有修改扫描算法、忽略规则或分类策略。

修复后的实际验证：

| 命令/操作 | 结果 |
| --- | --- |
| 并发执行 `pnpm --filter @potential-guide/pguide-task-bundle test` 和 `pnpm --filter @potential-guide/objective-monorepo-standard exec tsx --test --test-name-pattern 'real repository' test\pilot.test.mjs` | 作者 14/14 通过；同一时间的真实仓库扫描只报告既有技能 `file-classification unverified`，没有 fixture `ENOENT` 或相关 inventory/delivery 失败。 |
| `pnpm check`，默认并发，连续两次 | 均退出 1；build/layers/format/lint/typecheck 通过，作者 test 为 cache miss，与强制重跑的 monorepo test 并发；两次均无 `ENOENT`、`global-config`、`package-layer-inventory` 或 `delivery-mapping` 失败，仅余既有技能分类问题。该失败会中止尚未结束的作者 suite，所以不把这两次默认并发命令的作者 suite 虚记为完整 14/14；完整结果以上行独立并发执行为准。 |

此次日志为 `.cache\task-bundle-validation\authoring-isolation.log`、
`inventory-isolation.log`、`check-fixture-isolation.log`、
`check-fixture-isolation-repeat.log`。首次 targeted 误用普通 `node` runner，
因测试直接引用 TypeScript 源码的 `.js` 映射而装载失败；改用仓库已有
`tsx` runner 后才得到上表实际扫描结果，没有为此安装依赖。
本轮未重新 merge、commit、push，也未改父代理负责整合的并行 CLI 脚本。
primary 已前进到父代理报告的 `6f42920c`，该集成与同步仍由父代理处理。
本轮 `silvermoon check --worktree --audience agent` 退出 1，
报告同级服务 Idea `01M6GRRES5EBHYDP1G9DZEGE8E` 的
`idea.events.history-invalid: not-append-only (append)`。
本代理没有为此更改事件或同步历史；父代理需正常整合最新 primary 后重跑快照检查，
不能继续使用上一轮检查通过作为当前未同步候选的通过声明。

父代理还复核了最低版本消费：下载官方 Windows Node `v22.13.0` zip，
校验官方 SHA256
`B0FEB09EBF41328628E7383F7A092FB7342CE1E05C867A90CF8F1379205A8429`。
使用 `scripts\check-task-sdk-consumer.mjs` 的 `withoutAuthorDependencies`
包裹上述保留的 `bundle-authoring` 目录，再以外部 Node 22.13 启动
`runtime\consume.mjs`，退出 0，CID-only Engine/真实 Worker 通过，宿主无作者依赖。
第一次未隐藏上级作者 node_modules 的直接启动出现 `Missing expected rejection`，
是验证驱动未隔离的错误；正确隐藏后通过。此项为父代理提供的独立证据，
不是本代理自行执行，也不等同于最低版本作者 check/build 已验证。

## 父代理集成复核

父代理正常 fast-forward 整合同级 Task Engine 服务及其审批到
`9e436e53`，保留其全部事件与实现；以普通冲突合并同时保留
`--task-service` 和 `--bundle-authoring` 两个消费入口。依赖按新 lockfile
执行 `pnpm install --frozen-lockfile`，未修改依赖版本。

- 集成后的 `pnpm check`：build/layers/format/lint/typecheck 通过，
  test 中 esbuild 明确报告 `fatal error: runtime: cannot allocate memory`，
  导致 SDK stream tests 的 service stopped；这次不能算通过，也不是已证明的代码缺陷。
- 随后 `pnpm exec turbo run test --filter=@potential-guide/task-sdk
  --filter=@potential-guide/pguide-task-bundle --filter=@potential-guide/pguide-task-engine
  --concurrency=1` 退出 0，17/17 tasks 通过，覆盖本 Idea 与并行服务的直接耦合面。
- 集成后的 `node scripts\check-packages.mjs --bundle-authoring` 退出 0：
  实际打包、独立 binary/pguide dispatch、无作者依赖的 CID-only 真实 Worker 通过。
  本次 retained 安装树为 `.cache\potential-guide-packs-uObLIg`，只作可清理验证缓存。

父代理复核新增测试目录隔离及精确文件/Schema/发布边界后决定：
按当前 Implementation 明确允许记录基线失败的标准放行 Inner，
不把整条 `pnpm check` 宣称为通过，也不修改无关分类策略；
实际 Kubo/pin 与仓库外安装继续由 Outer 独立验证。此处是证据及授权审查说明，
准确生命周期接受仍以同步后匹配的 submit/accept 事件为准。

## 验证入口

从仓库根执行；先构建 workspace 依赖：

```powershell
pnpm build
pnpm --filter @potential-guide/pguide-task-bundle test
pnpm --filter @potential-guide/task-sdk test
pnpm --filter @potential-guide/task-engine test
pnpm exec tsc -p tsconfig.test.json --pretty false
node scripts\check-packages.mjs --bundle-authoring
node scripts\check-packages.mjs --task-bundles
node scripts\check-packages.mjs --task-sdk
pnpm check
```

packed consumer 自动清理自己的 `.cache` 目录。
若父代理需要检查独立安装树，可设置 `$env:PGUIDE_KEEP_PACK_CONSUMERS="1"`
后运行对应命令，按输出的准确自有目录检查；结束后删除该变量和该目录。
这些命令只 pack/install 本地 tarball，不执行 npm publish。

独立作者命令可直接用已构建 binary 复验：

```powershell
node packages\pguide-task-bundle\dist\bin.js --pguide-command-metadata
node packages\pguide-task-bundle\dist\bin.js --help --format json
node packages\pguide-task-bundle\dist\bin.js check author packages\pguide-task-bundle\examples\echo\task.build.yaml --format json
node packages\pguide-task-bundle\dist\bin.js build packages\pguide-task-bundle\examples\echo\task.build.yaml --format json
node packages\pguide-task-bundle\dist\bin.js check artifact packages\pguide-task-bundle\examples\echo\dist --format json
```

父代理在 Inner 验收后使用其独立管理、已就绪的非敏感 Kubo 数据域，
将最后一条的成品目录复制到自有发布目录，再用相同 binary
`publish <成品目录> --ipfs-rpc <该节点准确 RPC URL> --format json`。
无需复制作者源码、TypeBox 或 marker；核对返回 CID 与 build/check 一致。
独立 packed Engine 消费脚本为 `scripts\check-bundle-authoring-consumer.mjs`，
由 `--bundle-authoring` 调用；真实 Kubo/pin/外部传播证据由 Outer 单独记录，
不能用本阶段 MemoryIpfsClient 或 HTTP fixture 替代。

## 已知限制与失败判定

- 最低 Node 22.13 的 Engine/Worker 消费已由父代理实跑；作者 check/build
  尚未在 22.13 实跑。本代理实际验证版本为 Node 24.11.1。
- 输出是操作级替换/回滚，不承诺所有文件系统上无可见间隙，也不宣称断电
  crash-durable 事务。进程崩溃后应先停止原进程、检查 ownership marker，
  用 `check artifact` 验证 output 或 backup，再人工处理准确自有锁/备份。
- contract 是可信本地代码；author check/build 不是恶意源码沙箱。
- 完整检查当前重现历史的
  `.agent/skills/component-responsibility-docs/SKILL.md` file-classification
  `unverified`；未为本 Idea 修改无关技能/分类策略，也未把它记作通过。
- 重负载并发运行曾出现 Engine 类型守护启动超时及 check-task 子进程就绪超时；
  Engine 单独回归 160/160 通过。完整 pack 另一次在既有 mvp-check 场景
  轮询结束时仍为 `running` 而非 `completed`；后来无并行 suite 干扰的完整
  pack 复验已通过该场景。不能把先前失败的那次 inventory 宣称通过，
  也不能仅凭重跑恢复就断言已独立证明为源码基线缺陷。
- 当前本地是新工作树生成的 dist，pack 已通过原检查点的 stale-output 位置，
  本次没有删除其他工作树文件、扩大清理范围或接管现有服务。
