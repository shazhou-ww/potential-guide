# 实施证据（未提交候选）

IDEA：`01M6QAN03H0JN6MHT86AF6GRJG` / `task-artifact-delivery-identity`。
依据 accepted idealRevision `33e71eeaed22bdb8d35d3d6e6cbfc736027c77ca`；实施基线
`49d56b4b1058b09dab0e2c1c5e057a8e6597ca3c`。
仅修改本实施 worktree；未改 ideal、events.jsonl 或 D-*，未提交、推送、发布或执行门禁批准。

## 修改文件索引

- 内容协议：`packages/task-protocol/src/{bundle-content,bundle,bundle-files,index}.ts`，
  `schemas/artifacts/{task,task-build}/v1.json`。
- 作者/读取器：`packages/pguide-task-bundle/src/{authoring,build,artifact}.ts`；
  Engine：`packages/task-engine/src/bundle.ts`；SDK：`packages/check-sdk/src/authoring.ts` 及生产依赖接线。
- 接受与缓存：`packages/check-environment/{build,verify}.mjs`，`scripts/{build,environment-cache-inputs}.mjs`，
  root/package scripts、`turbo.json`、`package-layers.yaml`。
- 发布/公开消费：`publish-npm.yaml`、`scripts/check-package-consumers.mjs`、
  `check-bundle-authoring-consumer.mjs`、`bundle-identity-consumer.mjs` 与 Docker prepare-image；
  相关 consumer、build、release、缓存/替换测试和旧生产夹具均同步。
- 直接相关 README 与 Task Bundle/Engine/cache 契约；本 IDEA 只修改 Inner 实施证据、Implementation 和 I-* ledger。
  完整当前路径可用 `git diff --name-only` 及 `git ls-files --others --exclude-standard` 查看。

## I-S01 / I-AC01：内容与声明

- `task-protocol` 统一严格 UTF-8 校验、仅 CRLF/CR→LF 的字节规范化、portable glob 与 binary 展开。
  BOM、Unicode 表示、空白、尾换行及 binary 原字节不变，不探测扩展名/NUL。
- 作者 YAML 和低层 build API 的 binary patterns 匹配 include 映射后的最终路径。
  最终 `task.yaml.binary` 必需、排序、无重复、实际 resources 文件子集；空值显式 `[]`。
  Manifest、Worker、Schema 及 Check 生成索引不能借 binary 绕过文本约束。
- 目录/CAR 从同一规范化内存集合产生。协议/Engine/公开 artifact 读取只校验，不改写。
  已同步公共机器 Schema、低层例子、SDK/Engine/适配器/宿主夹具与 packed consumer。
  缺字段的旧 Bundle 明确要求重建，无兼容分支。
- Engine 默认按需模式的资源占位符不作为文本验证证据：默认文本在准入前有界读取并验证，
  只有显式 binary 资源保留按需后继块读取。已补 prefetch 开/关均拒绝非法 UTF-8/CR、
  接受原始 binary 的回归，并同步 Engine 公开契约。

## I-S02 / I-AC02：根 CID 与已验快照

- `readTaskArtifact(path, expectedCid?)` 对目录及 CAR 均完整校验；期望 CID 可省略。
  根 CID 是唯一内容身份；没有新增整 CAR 哈希、大小比较或来源批准。
- environment `stageCheck` 只写 reader 返回的已验 files/archive，不再次 cp/copyFile 原制品。
  保留候选整体接受、失败不覆盖 accepted bundles/index。
- 新回归用标准 `CarReader/CarWriter` 重排块，证明同根不同容器可通过；
  错根、缺块、坏块、多根、额外块拒绝，既有容量/路径/读取中替换保护保留。
  实际 environment staging 的确定性替换回归证明读取后源被替换不会改变交付字节。

## I-S03 / I-AC03：缓存与验证

- Check SDK 按同一 UTF-8/LF 规则比较预期资源；binary 仍精确比较原字节和清单。
- root build launcher 为启用 binary 的 Check 原始资源输入生成仅用于 Turbo 的缓存键，
  防止 Git text/eol 规范化掩盖原始 binary 字节变化；它不是制品身份。
  binary YAML、规范代码和缓存键实现均纳入任务输入。
- 根 `pnpm build` 的 uncached verify 及 environment prepack 核验命中后的实际输出。
  正常 build 仍缓存，不永久 force，不清理共享缓存。
- Turbo 的 build 只生成/缓存 `dist/candidate` 和编译输出，最终 `dist/bundles` 不进入缓存恢复。
  uncached verify 从候选已验快照写独立 accepting 目录，全部通过才原子替换 accepted 输出；
  prepack 只校验 accepted。回归同时改变 binary 源字节再注入旧候选，证明 miss/hit 的失败
  均不覆盖此前 accepted 的任何文件，且当前期望资源不同的旧 accepted 不能通过 prepack。
- `scripts/environment-cache.test.mjs` 使用仓库内独立 Git/Turbo fixture，运行真实
  environment build/verify：默认 CRLF→LF 源具有相同 Git hash，冷构建/普通命中同根；
  binary 配置、binary 原始 CRLF/LF 和规则代码变化导致 miss；再运行可 hit。
  注入旧契约输出后，真实 cache hit 恢复的旧输出在 verify 被拒绝。

### 验证记录（Windows / Node v24.11.1 / pnpm 11.22.0）

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @potential-guide/task-protocol --filter @potential-guide/pguide-task-bundle --filter @potential-guide/check-sdk --filter @potential-guide/check-environment test` | 266/266：130 + 118 + 8 + 10 |
| `pnpm --filter @potential-guide/task-engine exec tsx --test test/bundle.test.ts test/gateway-resources.test.ts` | 10/10；包括默认非 prefetch 文本验证 |
| `node --test scripts/environment-cache.test.mjs` | 1/1；含真实冷构建、命中、binary 原字节、规则变化、旧缓存拒绝 |
| `node --test scripts/environment-candidate.test.mjs` | 1/1；实际 staging 读取后替换及失败保持输出 |
| `pnpm exec tsc -p tsconfig.test.json --pretty false` | 通过 |
| `pnpm exec biome format .` / `git diff --check` | 通过 |
| `node scripts/check-packages.mjs --bundle-authoring` | 早期候选 17 内部包通过，但宿主当时在仓库内兄弟目录；此隔离结果已作废，不能代表最新严格仓库外验证 |
| `pnpm pack:check` | 最终候选通过，含 environment prepack 的 accepted 核验 |
| `pnpm --filter @potential-guide/check-sdk --filter @potential-guide/check-environment test` | 最终接受边界改动后再次 18/18 |
| `pnpm exec turbo run test --filter=@potential-guide/task-engine --filter=@potential-guide/probe-task --concurrency=1 --output-logs=errors-only` | 完整分包 219/219（Engine 200、Probe 19），16 tasks 成功，只有依赖 build 为命中 |
| `pnpm check`（既有 shell 2456） | 通过，exit 0；76/76 Turbo tasks、root scripts 66/66、pack structure 通过；8 CPU 本进程限制，全部断言/时限不变。此运行早于下述最后的发布接线和严格宿主恢复，不能冒充后续 patch 的全量结果 |
| 发布接线 / Docker 接线定向 tests | 20/20；过滤发布闭包、选中 environment 才接受、失败不接受、发布授权顺序及 Docker 打包前准备/接受 |
| 实际 filtered build + environment pack | protocol 仅 1 个 build task；environment 构建后有 uncached verify；99 文件 package 的 prepack 通过，无发布 |
| 严格宿主根目录拒绝测试 | 1/1；仓库内 override 在接触作者输入前失败，未把本地路径当作严格外部宿主 |

初次完整检查暴露两处 Gateway 二进制夹具遗漏，已补精确声明及作者 binary option，定向
3/3 通过。同期高并发测试出现已有 type-supervisor 启动超时；初次作者 suite 也遇到
Windows EBUSY 清理失败，随后完整定向 266/266 通过，没有放宽产品超时、跳过测试或伪造结果。

默认 20 路 Node 文件并发的下一次完整检查到达 75/76 Turbo tasks，Probe 两个既有时限
用例失败（`probe.test.ts:393` 的 30 秒业务 wall 超时、`:480` 的 60 秒等待在 initial）。
它们没有经过本次 Task Bundle 资源路径；用既有 runner 单独重跑两例为 2/2。
随后完整重跑仅给本工具进程及其子进程设置 4 CPU affinity（Node 实测 availableParallelism=4），
结束恢复原 affinity；不改变共享机器配置，不修改产品/测试超时或跳过用例。
4 CPU 全套仍有六个既有 TypeSupervisor 启动时限失败（projection-races、schema-sharing、
supervisor-review、type-supervisor）；原时限、原断言单独重跑六例为 6/6。
最后以工具进程 8 CPU affinity、Turbo 单包并发完整运行 Engine 和 Probe，两包 219/219；
不是筛选用例、人工写缓存或禁用缓存。再运行不带 affinity 改动的原始 `pnpm check`，
正常复用这些同一候选的真实成功缓存。所有失败记录保留，不把 isolated 通过冒充原并行通过。
本机原始记录：`.cache/identity-check-final.log`、`.cache/identity-probe-retry.log`、
`.cache/identity-check-bounded.log`、`.cache/identity-engine-timeout-retry.log`、
`.cache/identity-isolated-suites.log`、`.cache/identity-check-complete.log`。

## 公开消费与监督者复验入口

1. `pnpm build`
2. `node scripts/check-packages.mjs --bundle-authoring`
3. `node --test scripts/environment-cache.test.mjs scripts/environment-candidate.test.mjs`
4. `pnpm check`

窄 environment 构建（含原始 binary 缓存键及接受核验）：
`node scripts/build.mjs --filter=@potential-guide/check-environment...`。

新场景已接入既有 `pnpm consumers:check` 和 packed `pnpm deployment:verify` 的
`bundle-authoring` scenario，不新增 workflow。公开 API/CLI 从打包安装结果消费；
父审阅指出先前的兄弟目录替代削弱了物理隔离，现已恢复 `tmpdir()` 默认仓库外宿主及原
“必须逃离仓库依赖祖先”的断言；运行函数本身也在接触作者输入前验证宿主根目录在仓库外。
四种作者依赖保持正向对照，运行宿主必须实际无法 resolve/import。
新增 `PGUIDE_PACK_CONSUMER_ROOT` 可把整个作者消费和 runtime 宿主放在明确的独立外部根，
拒绝仓库内路径及回指仓库的符号链接；自有子目录清理，不删除指定根。
先前仓库内兄弟目录的成功记录已被此修正取代，不能作为严格仓库外验收证据；
最新严格 packed 场景已由监督者在下述独立复验中完成。
固定 Worker/manifest 输入消除了编译器版本对跨平台 CID probe 的影响：

`bafybeibtkmjrucx7wqozzwuewnwtdoyhyucpr3wp2jbmmjr3zjjeugog2m`

脚本断言该值并打印平台，同时输出真实 buildTask 生成的完整 Bundle CID，供两端比较；
不能只用固定 Worker probe 代替实际作者构建的跨平台一致性。
LF/CRLF/CR、binary、不同 CAR 块序、错根拒绝都在同一入口。
仅记录 Windows 实施测试，未声称 Linux/macOS 已验证。exact-commit CI Linux 与
Deployment 门禁仍由父监督者审阅执行；本文不构成 D-* 通过或来源批准。

## 父审阅后的发布面修正

- `.github/workflows/publish-npm.yaml` 的 scoped Build 改走 `scripts/build.mjs`；
  通过 Turbo dry plan 判断过滤闭包中是否含 environment，才计算 binary 缓存输入并接受候选。
  发布/恢复模式条件、精确 main CI 门禁、权限、版本/tag 和 publish 步骤均未扩张。
- 同类 Docker 直接 tsc 后 pack 入口补 Check authoring bootstrap、generated definitions preparation、
  environment 成品接受；使用已有工具链和工作区包，不增加工具版本或发布权限。
  本机无 Docker daemon，只有定向接线测试，未声称运行过 Docker。

## 当前交回边界

实施者交回时 I-S01、I-S02、I-AC01、I-AC02 有完成证据，I-S03、I-AC03 未勾。
以下监督者复验补充最终候选证据，不沿用早期兄弟目录结果。

## 监督者独立审阅与复验

依据用户明确授权，由监督者而非实施 subagent 审批门禁。直接审阅了公共文本/binary
协议、作者构建、Engine 默认非 prefetch 文本验证、同根容器校验、SDK 资源比较、
environment 快照 staging/原子接受、Turbo 输入与命中后核验、发布和消费接线。

审阅发现并退回修复两个问题：发布 workflow 的直接 Turbo build 绕过接受入口；
运行宿主从系统临时目录改到仓库内兄弟目录削弱隔离。最终候选已分别接统一 filtered
build launcher、恢复仓库外运行宿主与严格断言，并提供整个消费者的仓库外根选项。
Linux CI 的现有 isolated consumers 使用 runner.temp 执行，未新增发布步骤或授权。

监督者实际复跑：

- 在各 workspace 标准 cwd 执行 content-identity/car-files/official-car 13/13、
  protocol bundle-files 9/9；首次从仓库根执行新作者夹具因 TypeBox 解析 cwd 不适用
  失败，改用包的既有执行约定后通过，未修改断言。
- 真实 environment 缓存及替换测试 2/2，涵盖冷构建/普通命中、binary 原字节与规则变化、
  旧缓存拒绝、已验快照复制和失败不覆盖。
- 发布过滤、CI 接线和严格宿主隔离 15/15。
- `PGUIDE_PACK_CONSUMER_ROOT=$env:TEMP node scripts/check-packages.mjs --bundle-authoring`
  退出 0：整个作者消费者与运行宿主均在仓库外，4 个直接入口、17 个内部 tarball 包；
  实际 Engine/Worker 执行通过，不依赖作者模块。
  Windows 实际回执根为
  `bafybeibtkmjrucx7wqozzwuewnwtdoyhyucpr3wp2jbmmjr3zjjeugog2m`，
  LF/CRLF/CR、binary 保真、不同合法 CAR 排列及错误期望 CID 已在公共入口验证。
- 最终首次 `pnpm check` 的 workspace tasks 通过，root scripts 70/71：
  未修改的 pilot-packages 六个 Objective tarball 用例在原 30 秒单项准备预算下超时。
  监督者以原代码、原时限隔离复跑该文件 2/2 通过，不认定为已修复产品问题。
  随后只对验证工具进程及其子进程限制 8 CPU 并发重跑完整 `pnpm check`，
  不改变共享环境或测试断言，完成后恢复 affinity；仍为相同打包用例超时（70/71）。
  不继续重复相同全量尝试，转为验证 Node 文件调度：全部 root scripts 用原断言及
  原时限、`--test-concurrency=2` 执行得到 71/71，耗时约 99 秒。
  本次新增真实缓存构建测试与既有 tarball 测试均启动重型子进程；根脚本原先按 CPU
  数并行所有测试文件，与已有 Turbo `--concurrency=2` 的限制不一致。
  据此仅将根 Node 测试文件并发固定为 2，所有用例仍执行、没有 skip、没有改产品或
  用例时限。最终完整 `pnpm check` 用该直接相关的调度修正复验，不依赖 CPU affinity，
  已退出 0：源码一致性、层级、格式、lint、类型、workspace 测试、根脚本 71/71、
  全部结构打包验证通过。完整本机日志为 `.cache/identity-supervisor-check-final.log`。

实施契约的全部 I-* 已完成，监督者未发现剩余阻塞性实施问题；允许在准确实施修订同步、
submitInner 后记录授权接受。该判断不代表 D-* 已完成，跨平台独立消费仍需现实证据。

父可指定专用、非任何源码 checkout 的根后运行：

```powershell
$env:PGUIDE_PACK_CONSUMER_ROOT = 'D:\Verification\task-artifact-identity'
node scripts\check-packages.mjs --bundle-authoring
```

完整跨平台入口仍为既有 `pnpm consumers:check` / `pnpm deployment:verify`；
两者也识别该独立根选项。固定 CID 同上；未运行外部/跨平台场景前不勾 D-*。

## 首次准确 CI 失败后的 Inner 修订

首次准确 CI `42197402285` 已结束，不能用此前本机成功覆盖其失败事实：

- 全量 isolated consumers 及三平台 packed 路径首先在 `resources/checker.tgz` 失败。
  `check-task-bundle-consumer.mjs` 使用低层 builder 时漏传作者 `binary` 选项；
  生成声明中的占位 `binary: []` 不能替代 builder 选项。
- Node 22、24 的真实 environment 缓存测试都在 `/build: cache miss/` 断言失败。
  GitHub Actions 将 task 名与日志正文拆入 `::group::`，不是实际 build 缓存状态错误。
  该失败暴露的是此前测试把人类日志格式当作机器证据。

本轮基于 `95cefa2cdedeb7edb6e1a8eed3ab223e3a5da848` 修订 Inner，不改 ideal、Deployment、
events 或授权；此前 `da888f74` 候选及后续接受不能自动覆盖本次修订。
I-S03/I-AC03 已重新置为未完成，监督者在 Implementation.md 补充的要求保留。

修订限于这两个阻塞及紧耦合遗漏：

1. Check/Probe packed 作者显式选择 checker/objective tarball 路径为 binary，并在真实
   packed 流程校验最终精确清单、目录/CAR 一致及每个归档的逐字节保真。
2. 同类审计发现 MVP consumer 和 probe-integration 通过 `buildExampleBundle` 嵌入 tarball，
   helper 没有转发 binary；增加默认空列表的显式选项，并迁移这两个已知归档调用者。
   packed task-bundles 另实际调用该 helper，证明归档原样保留、未标 binary 的文本仍规范化。
   已核对 service/Gateway 任意字节夹具，它们已有显式 binary，不按扩展名增加自动判断。
3. 每次真实 Turbo 调用开启 `--summarize`，只读取该次新生成的 summary，
   精确要求唯一 `@potential-guide/check-environment#build` 的 `cache.status` 为预期
   `MISS`/`HIT` 且 build exitCode=0；同时核对整个 run 成败。失败后的旧候选恢复也照此核对。
   不再从 stdout 推断缓存；测试子进程始终设置 `GITHUB_ACTIONS=true`。

本轮 Windows 实际复验（均退出 0）：

| 入口 | Node 22.13.0 | Node 24.11.1 |
| --- | --- | --- |
| `node --test scripts/environment-cache.test.mjs` | 1/1 | 1/1 |
| `node scripts/check-packages.mjs --task-bundles` | 完整通过 | 完整通过 |

- 缓存回归的子进程设置 `GITHUB_ACTIONS=true`；两版本都以真实 summary 证明
  8 次精确 build 状态：MISS、HIT、MISS、MISS、HIT、MISS、MISS、HIT。
  前六次 run exit=0，旧候选生成/恢复的末两次 run exit=1；build 本身均 exit=0。
  fixture 的生产子进程另断言 Node 版本与测试驱动一致，未通过全局 `nvm use` 改共享版本。
- 两版本 packed 均经过实际 tarball 安装、example helper 默认文本/显式归档校验、
  Check/Probe 最终 binary 清单与原始归档字节校验，再移走作者 node_modules/source，
  在独立 production host 完成实际负面业务结果、evidence 及 HTTP history/realtime 回放。
  不是只运行 `--bundle-authoring`，也不是用源码模块替代安装包。
- 最终 `pnpm check` 通过：76/76 Turbo tasks、root scripts 71/71、
  全部结构打包验证通过；使用监督者原有 `--test-concurrency=2`，未修改时限、断言或包清单授权。
- 本轮定向 lint 和 `git diff --check` 通过。当前 HEAD 仍为 `95cefa2c`，无提交/推送。

日志：`.cache/identity-ci-cache-node22.log`、`.cache/identity-ci-cache-node24-final.log`、
`.cache/identity-ci-task-bundles-node22.log`、`.cache/identity-ci-task-bundles-node24-final.log`、
`.cache/identity-ci-followup-check.log`。

### 本轮监督者复验

监督者直接审阅归档 binary 选项、example helper 转发及精确文件保真断言，
确认未按扩展名引入隐式分类；缓存测试读取每次唯一新 summary，并精确核对 build
taskId、缓存状态及 run/build 退出状态，没有用 verify 的 bypass 日志替代命中证据。
独立重跑 CI 分组环境缓存测试 1/1 通过，完整 `--task-bundles` 打包消费退出 0，
包括实际 Check/Probe、HTTP history/realtime、负面业务结果及作者依赖不可用的生产宿主。
结合实施者 Node 22/24 回归和本轮完整 pnpm check 结果，当前修订可重新 submitInner
并由监督者授权接受；首次 CI 的失败事实保留，新的跨平台结果仍待准确提交 CI。

上述本机回归完成后才重新勾 I-S03/I-AC03，表示实施验证完成，不是重新接受 Inner。
首次 CI 的失败事实保留；新准确 Inner 仍须监督者重新审批。未写 Deployment/Outer/events，
未把 Windows 两个 Node 版本的结果冒充 Linux/macOS 的后续 CI。
