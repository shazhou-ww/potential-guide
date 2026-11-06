# 范围、兼容性与准备期证据

本文支撑 [Idea](./Idea.md) 的方向与验收，不是已实现接口或交付回执。[R-01 原文](./Recommendation.md)保持不变；以下把建议收敛为本子 IDEA 的最小范围。下游契约只是可调整的可行性种子，当前没有任何实施或接受授权。

## 现有入口与缺口

核对基线为 `61cefb02b2f81dd7d85e98b469c600b4f7016970`，独立 worktree 已从旧基线快进且跟踪 `origin/main`，未修改父 worktree。

| 已有事实 | 对本构想的约束 |
| --- | --- |
| [artifact.ts](../../../../../../packages/pguide-task-bundle/src/artifact.ts) 的 CAR 分支检查文件身份、读取前后状态和容量，保留 `archive`，校验块/DAG、提取文件并比较规范树 CID。`checkTaskArtifact` 最后只返回 `declaration/resolved/cid/files`。 | 从该次 `archive` 算容器哈希与长度；不能再打开路径计算哈希，也不必写另一套解析器。目录分支没有 CAR，现有文档也不承诺并发修改下的原子目录快照。 |
| [CLI](../../../../../../packages/pguide-task-bundle/src/bin.ts) 的 JSON 外壳是 `schemaVersion: 1`、`command`、`status`、`result`；[包文档](../../../../../../packages/pguide-task-bundle/README.md)明确离线且无上传。 | 扩展是附加能力，不改变既有命令语义、成功字段、错误退出规则或发现协议；不让通用作者工具依赖 Git/npm/Pinboard。 |
| [environment 构建](../../../../../../packages/check-environment/build.mjs) 已用 `verifyCheckResources` 对准备快照与 CAR/目录做精确比较，随后却按原路径 `cp/copyFile`；[SDK](../../../../../../packages/check-sdk/src/authoring.ts) 已有资源集合/字节比较器。 | 复用比较器；复制实际验证过的字节而不是重开可变路径。暂存、验证、整体替换的既有失败保留行为不可退化。 |
| [Turbo](../../../../../../turbo.json) 的默认 build 缓存 `dist/**`；命中时不会执行上述构建内比较。现有[制品测试](../../../../../../packages/check-environment/test/authoring.test.ts)直接比较输出与源 Reference，可识别漂移。 | 交付正确性检查必须在缓存命中时也运行，且比较可信源码而不是随旧输出恢复的 staging。仅在可缓存 build 内多写一次检查不足以覆盖。 |
| [发布 workflow](../../../../../../.github/workflows/publish-npm.yaml) 顺序为 Turbo build、pack、npm publish、metadata 校验。[发布验证脚本](../../../../../../scripts/verify-published-package.mjs)检查版本、标签、integrity/attestation URL 的存在，没有下载并核对 tarball/CAR 字节。 | 增补制品到来源的绑定，不把元数据存在说成已经验证文件来源，也不重写 R-02 的整个发布就绪体系。 |
| 仓库目前没有生产用 Pinboard 上传入口；[作者消费测试](../../../../../../scripts/check-bundle-authoring-consumer.mjs)的 publish 示例是 `MemoryIpfsClient`。 | 本地交付前核验是本子 IDEA 必须交付的入口，外部 CLI/MCP 必须消费它的已验证结果；不声称能拦截绕过此入口的任意手工上传。 |

## 最小接口与来源边界

### 离线身份与兼容性

- 保留 `readTaskArtifact` 的现有导出及 `files`、CAR 的 `archive/cid`，保留 `checkTaskArtifact` 与 CLI 的既有四个结果字段。通过附加、有版本的身份数据表达输入种类、根 CID、验证成功状态、容器 SHA-256 与整数原始字节数；具体类型与字段位置在实施时定稿并做契约测试，不能以“扩展”为由删改旧字段。
- CAR 身份只描述本次读取到、完整验证后的实际容器；不重编码 CAR 再计算其哈希。目录可以给出已读文件树的 CID，但容器信息必须显式为空或不存在，不能用目录总字节数冒充 CAR 大小，也不增强其并发快照承诺。无效输入走既有错误路径，不输出成功身份。
- CID 与容器哈希不是可互换字段。合法容器可能同根而容器字节不同，按具体容器交付时仍须比较 SHA-256 和长度。若兼容需要同时保留多个 CID 表达，它们必须一致，不能静默选一个覆盖另一个。
- `references.json` 继续保持各 kind 的 `directory/car/cid` 路径和 CID 语义；来源/交付记录独立于该公开索引，不能替换索引或塞入 Task manifest、Reference 字节来循环改变根 CID。
- 身份相等只比较内容/容器与确定性验证信息；绝对路径、机器名、时间和临时目录只是定位/观察上下文，不属于跨环境身份比较。工具版本与配置另作来源证据。

### 上层来源与交付

首批对象是 environment 的 tools、directories、network 三个 CAR。来源由仓库交付层验证并绑定至相同身份，通用离线检查不接收任意 `source` 字符串就显示“已验证”。

| 来源 | 最小证据 | 不能据此推导的结论 |
| --- | --- | --- |
| 仓库构建 | 准确提交、所选构建输入/配置/锁文件的原始字节快照、实际工具版本；核对工作树输入与选定提交的 blob 字节，并对 CAR 的资源集合与字节做既有比较。提交号或 `git status` 干净本身不足。 | 不能只凭资源匹配证明 Worker 是从任意声称的提交生成；构建产物还须绑定本次受控构建/缓存记录，不能事后给无来源旧 CAR 补贴提交号。 |
| 已发布 npm 包 | 准确包名与版本、来自选定可信元数据的 tarball integrity、实际 tarball 字节校验、包内相对 CAR 路径；检查包内索引根及提取后 CAR 身份与交付文件完全一致。 | 已安装目录、移动标签、包名字符串或 integrity 的存在均不足；tarball integrity 不是 CAR SHA-256。这里不是新增签名/attestation 信任系统，也不把 URL 存在称为密码学 provenance 验证。 |
| 缺失或无法验证 | 明确标为未验证并说明缺什么；仍可独立执行离线 CAR 校验。 | 不得变成可交付、用户已批准或服务端已 pin；严格交付入口必须失败，不能自动降级继续。 |

复制/委派/上传前的最小链路是：取得已核实来源的期望身份，接收机器记录及文件定位，执行端稳定重读并逐项比较，再只交付这次验证的字节。记录是可复核证据，不是签名凭据或审批令牌；不能把同一可写目录中的“文件和自述记录同时被替换”当成可信来源。

交付适配不能采用“先 check，再把原路径交给稍后独立 readFile”的方式。读取前已换成其他内容应与期望身份不符；读取过程中（即使同字节换文件）保留现有文件身份拒绝；稳定读取完成后的交付使用该快照而非可变路径。不同机器之间以内容验证，不把 inode/mtime 当作可移植制品身份。若外部工具只接受可变路径且无法绑定实际发送字节，则该路径尚不满足本构想，不可宣称已安全交付。

本仓库增加可执行、可测试的交付前核验接线，在 pack/publish 前和交付给外部执行者前调用；不实现新的认证、base64 桥接或 Pinboard 客户端。以替身统计复制、委派及网络写入调用，错误时必须为零；这里指待交付制品跨越交付边界的消费者可见动作，核验所需私有暂存不算成功交付，但不得覆盖已接受输出。错误明确指出字段/资源路径、期望与观察值，不输出成功式 fallback。npm 发布仍遵守既有包标签/OIDC 授权，与本次 Silvermoon 文档同步不同。

## 准备期复现：原始字节与缓存身份并不等价

2026-11-06 在当前 Windows worktree 使用 Node `v24.11.1`、pnpm `11.22.0`、锁定的 Turbo `2.11.8` 和上述基线编译出的现有 CAR 库进行隔离实验。临时 Git/缓存目录不在父 worktree，也没有改动本仓库源 Reference、构建配置或产品代码。以下是准备期事实，不是未来改动的实施验收。

### 可复现设置

1. 在独立临时 pnpm workspace 建一个 probe 包，沿用 `* text=auto eol=lf`，`core.autocrlf=false`；固定 package、锁文件与脚本，Git 索引保存 LF 输入。Turbo build 使用默认 inputs 与 `outputs: ["dist/**"]`，只启用本地缓存。
2. 取基线 [tools/en/check.md](../../../../../../packages/check-environment/references/tools/en/check.md) 的完整原始字节，生成 LF 与仅将 LF 改为 CRLF 的两种输入。probe 的 build 把页面原样写入 `resources/reference.md`，调用现有 `encodeContentCar`；Task 名称为 `R-01 byte identity probe`，Node 最低版本 `22.13.0`，entry 为 `worker.cjs`，其字节为 `module.exports = {};\n`，include 精确列出 task.yaml、worker.cjs 与该页面，inputSchema 为 object，resultSchema/messageSchema 均为 false，使用当前 `taskSchemaUri`。
3. 先用 CRLF build 保存缓存；换 LF 并只删除 probe 自有 dist，再用同一缓存普通 build。另用空的独立缓存目录执行 LF 冷构建，删除该 dist 后普通 build 检查正常命中。每次用 `turbo run build --filter=identity-probe --dry=json` 观察输入/任务哈希，并用标准 `readTaskArtifact` 读取实际 CAR，比较页面 Buffer、CAR CID、SHA-256 与长度；没有 `--force`。
4. 四次 Git worktree diff 均为空，输入 Git blob / Turbo input hash 都为 `c8f3a457fd5755232e79fa1762b6bb079c41d8db`，该固定夹具四次任务 hash 均为 `6cdbb8dbdb0db850`。任务 hash 是本次环境观察值，不是其他路径/平台必须复现的常量。

| 用例 | 输入页面字节 | 缓存 | 输出页面字节 | CAR 字节数 | 与当前源页面精确匹配 |
| --- | --- | --- | --- | --- | --- |
| CRLF 初次构建 | 1000 | miss | 1000（CRLF） | 1825 | 是 |
| LF 使用上述缓存 | 979 | hit | 1000（旧 CRLF） | 1825 | **否** |
| LF 空缓存对照 | 979 | miss | 979（LF） | 1804 | 是 |
| LF 正常命中对照 | 979 | hit | 979（LF） | 1804 | 是 |

| 对象 | 完整身份 |
| --- | --- |
| CRLF 页面 SHA-256 | `21595a8f6765415235d242f872855411009e9ee8d2a317c94fc44c4c6308011c` |
| LF 页面 SHA-256 | `f3757f1b567993b9a350ec45b41feb7ade9939bd84e1d90796d2774ae3aa4ef0` |
| CRLF probe CAR 根 | `bafybeig3x6b6ehidjuc5d3ch6pmxcz5g6zewbuhg5elck5yr4thdpj5teq` |
| LF probe CAR 根 | `bafybeicec2jdrocgnsdvhwp3pcauoaummfmszt3rftjzypchnrckyfrl6m` |
| CRLF probe CAR SHA-256 | `5b1e6f60350023f57448c6739f7b56f8fcf46fde0c6f7cd139294f38c8ad307c` |
| LF probe CAR SHA-256 | `d262ff47764600fa500ad9fcab3dffb68d0eace60b0934cc84164c444bafcde4` |

两个 CAR 都通过当前 `checkTaskArtifact`，返回键均仅为 `declaration/resolved/cid/files`；这说明结构完整性不回答“是不是当前源码的制品”。以上根是 **probe** 的根，不是已发布 environment 的根。

现有读取保护基线也已运行：`pnpm exec tsc -b packages\pguide-task-bundle --pretty false` 退出 0；`pnpm exec tsx --test packages\pguide-task-bundle\test\car-files.test.ts packages\pguide-task-bundle\test\official-car.test.ts` 为 9/9 通过，覆盖读取中替换、同长度修改、链接、容量及标准 CAR 校验。没有运行完整 `pnpm check`，本轮不提交产品代码。

### 能下的结论与尚不能下的结论

- 已复现**此版本/配置下** Git 规范化输入身份可复用不同原始行尾输出的机制；不是“所有 Turbo 缓存都不可靠”。隔离实验没有访问历史缓存，因此不能断言历史 A-02 的完整环境/缓存键与本例相同，也未完成 Ubuntu 复验。
- 源码准备的明确 LF 约定已在 [.gitattributes](../../../../../../.gitattributes) 中，但它不证明进程实际读取的工作树字节就是提交 blob。发布前应核对并拒绝差异，而不是在 Bundle 读取器里偷偷归一化。
- 最小正确性接线应让受控来源检查、缓存恢复后的精确资源比较及实际交付字节绑定不被 build 缓存跳过。实施时先把该案例移到真实 environment 接线，并检查输入/输出覆盖；仅对证实的缺口调整缓存键/依赖或增补始终执行的核验步骤，不预设全局 `cache: false`、`--force` 或无条件清缓存。
- [历史 E4](../../../../01M6NZBYXR81BMP219KRK5DQQC/outer/Public-delivery-observations.json) 已记录旧暂存根被已发布包 CAR 纠正。tools 的 CAR 容器为 23500 字节，上传回执 size 为 22797；两者口径不能互换。新记录必须叫清楚容器字节数，不从外部回执推算哈希或大小。

## 可观察验收矩阵

下表是未来实施/交付的验收要求，**并非本次已通过**；对应下游种子的 I-AC01～03、D-AC01～02。

| 输入或场景 | 必须观察到的结果与证明 |
| --- | --- |
| 合法 CAR、同一目录、无作者源码 | CLI/API 原有字段与离线行为兼容；CAR 新身份逐项等于同次稳定读取的根/实际 archive 哈希/长度；目录无容器哈希/大小，无虚假原子快照承诺。 |
| 坏块、缺块、额外块、多根、容量超限、链接/读取中替换 | 沿用标准校验器的拒绝与现有回归，无新解析器、无成功身份，读取中同字节替换也拒绝。 |
| 正确 CID 配旧哈希、错误大小、不同根；同根但容器字节不同 | 按具体字段报不匹配并拒绝；不能只比较 CID，不能忽略记录内部冲突。 |
| 同名旧 CAR；记录生成后改文件；校验完成后换路径内容 | 前两者与可信期望比较失败、所有副作用为零；最后一种只能交付已验快照或明确失败，不允许读取替换内容发送。用确定性替换钩子而非随机时序测试。 |
| 包版本字符串正确但 tarball integrity 不符、包内 CAR/索引不符；未知来源 | 拒绝交付并给出缺失/矛盾证据；离线结构检查仍可单独成功。未验证与验证失败不得伪装成批准状态。 |
| CRLF/LF 输入、旧缓存恢复、正确冷构建/正常缓存命中 | 对比选定源码 blob 与实际资源字节，报告差异资源路径；旧输出在 copy/pack/publish 前拒绝，正确冷构建和普通 cache hit 都通过，不靠强制重建绕过。 |
| 已接受 bundles 与索引存在时遇到失败 | 不覆盖已接受输出，不留下半套索引/身份记录；沿用现有 staging/candidate 失败保留测试。 |
| Windows/Ubuntu 独立消费 | 相同 CAR 的根、SHA-256、长度一致；相同受控源码字节/工具/配置构建的内容与身份一致，路径/时间不参与比较；两端跑正确来源与错误组合的零网络写入演示。 |

不要求为验证这些性质实际向 Pinboard 创建 pin，也不以本地校验替代服务器 expected-root。外部 R-05、其他七个子 IDEA、原交付 IDEA 的修订和接受事件都不属于本次审阅对象。
