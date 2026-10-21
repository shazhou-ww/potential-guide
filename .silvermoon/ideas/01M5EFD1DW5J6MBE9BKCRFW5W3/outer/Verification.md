# 固定版本隔离消费证据

## 契约先行与来源

部署契约先在 `e47ae59367e5f61ecf6efb8732e0ed6f07f17b93` 同步到 primary，
并由新 Silvermoon 报告观测到
`deploymentRevision=9e3add3661eeeda65ff5c3b2485982dcbbd33a3e`，然后才执行本轮检查。
其后仅增加本阶段的验证材料和结果，Deployment.md 的要求未再改变。

实际消费源码固定为 `682311db15c41344232a5d3f5cd806d5750779d5`：这是实现提交
`b85b32c18ad82733769ee24f111dc66c20fcfd0f` 经正常并发整合、同步并记录 submitInner 后的
提交；其 Inner World 与父代理已验收的 `71ced19b3de4885c86cd736a9b22c25c941d8d28`
一致。没有使用推进期间移动的 main 作为源码输入。

`git archive --format=zip` 的实际 SHA-256：
`3daaeeaf2d5275dc57f68bc17168da80951002043b0132b0d75a2f2c87473069`。
从该归档重新恢复依赖、构建 21 个 workspace（21 成功、0 缓存命中），再打包并安装
17 个本地 tarball。每个包的版本、tarball 文件名和 SHA-256 均保存在
[packages.json](./verification/packages.json)，不是借用工作区已有 dist 的产物。

## 实际环境与隔离

- Windows x64，Node `v24.11.1`，Git `2.55.0.windows.5`。
- 归档源码按其 packageManager 使用 pnpm `11.22.0`；消费者安装实际使用设备原生 pnpm
  `12.14.0`。两者均记录于 packages.json；没有把上级项目里的版本查询结果误记为消费者版本。
- 专属执行根为 `.cache\level-deploy-20261021`，归档源码在 `source`，独立消费者在相邻的
  `consumer`。目录物理上位于忽略缓存内，但安装图和模块解析均拒绝消费者以外的代码；
  不依赖“路径看起来隔离”这一假设。
- 源码依赖从固定 lockfile 离线恢复。消费者的全部内部包通过本次 tarball 的 file URI
  显式覆盖，禁用安装脚本；没有 workspace 范围或指向实时源码工作区的链接。
- 审核到 33 个实际生产依赖包、501 个不同物理模块路径、26,399 次模块解析，
  消费者外部文件模块加载为 0。完整依赖图在
  [installed-graph.json](./verification/installed-graph.json)，所有不同解析路径、说明符、
  次数和原始 trace 哈希在 [module-paths.json](./verification/module-paths.json)。
- CLI 使用独立 HOME、USERPROFILE、APPDATA、配置和 state；未配置真实 Agent，
  未借用个人认证、工作区 Agent 或外部修复服务。

原始解析 trace 约 5.9 MB，其 SHA-256 为
`cb785dcfd16c8c2e643b0f34191dc15f636213cf0ec58c2867dfaab397215a43`。
仓库保留全部不同路径和计数索引，不重复归档数 MB 的同一路径；
实际 CLI 的 stdout、stderr、退出码则完整保留，不翻译或改写。

## D-AC01：真实消费者结果

消费者自己建立并提交了 Git Objective fixture，提交
`6d74db73a54386a5253fa848c12416ffbc342186`，matrix 目录 tree
`f4630216d2a52016d1b7d3e3c2897b11544e9c39`。
三个业务层级为 prepared、ready、verified，各检查只读取 subject 的 passed 值并记录
真实执行次数。通过已安装的 `pguide-probe` bin 调用 Git Objective，而不是导入源码测试。

| passed | 实际 current | 实际检查次数 | 问题归属的未达层 |
| --- | --- | --- | --- |
| 0 | initial | 1 | prepared |
| 1 | prepared | 2 | ready |
| 2 | ready | 3 | verified |
| 3 | verified | 3 | 无问题 |

四次 CLI 退出码均为 0；观察成功和业务未达成保持区分。

另外，通过已安装公开 `checkObjectiveLevel` API，在同一 Objective、同一 subject 上
执行 verified 与 terminal 的 4×2 比较，八次结果完全符合相同阈值；
只有 passed=3 达成目标，所有观察均使用真实 current ID，而非 terminal。

公开 Regulator API 和实际 `pguide-regulate --target initial` 都证明：
业务检查调用 0、Agent 调用/iterations 0，current 为 initial；CLI 仍持久化正常的
Regulation 和一个 attempt。非法 subject 的 API 调用被拒绝，CLI 退出 2，
没有生成初始成功观察，也没有执行检查或 Agent。

另一个已提交 Objective 的真实进程检查通过 Pilot IPC 请求 matrix 的 terminal 目标：
passed=2 时依赖问题的 currentLevelId 为真实 ready、expectedLevelId 为目标别名 terminal，
所属 Objective 报 initial；passed=3 时所属 Objective 达到自身真实最高层 ready。
依赖版本与来源证据随输出保留，没有独立 terminal 观察层。

## D-AC02：旧契约、目标和固定证据

同一 fixture 提交包含真实的 legacy-v1 Objective，目录 tree
`5b780b0927e3c56d38486841fae87616a789e09f`；其 manifest 使用已发布 v1 URI，
声明旧 initial 的离开条件。旧 Portfolio 和恢复记录均明确固定此 Git commit/tree，
目标仍拼作 terminal。

| 实际公开入口 | 退出码 | 已观察结果 |
| --- | --- | --- |
| `pguide-validate pilot <legacy-v1>` | 2 | 明确要求 objective/v2.json；不解释成新契约 |
| `objective-contract-migrate`，无映射 | 1 | 明确要求 attainment-levels，未创建输出 |
| 同入口，显式 `--attainment-levels prepared` | 0 | 生成新的 v2 manifest，保留原始输入 |
| 对同一输出再迁移 | 1 | EEXIST，拒绝覆盖，输出字节不变 |
| `pguide-supervise`，旧 schemaVersion 3 Portfolio | 2 | 明确要求经审核目标的 v4 输入 |
| `pguide-continue`，旧 schemaVersion 3 恢复记录 | 2 | 明确拒绝旧达成语义/来源证据，不自动重新绑定 |

原始 v1 输入、迁移输出、旧 Portfolio 和旧恢复记录在操作前后逐个以 SHA-256 校验
相等；旧记录保留其旧 URI、commit、tree、repositoryTree 和 terminal 目标。
迁移数据、哈希及旧恢复记录完整内容均在
[results.json](./verification/results.json)，没有改写或捏造新的旧版本证据。

## 可复现材料与结果

- [复现命令与边界](./verification/README.md)
- [归档打包与安装脚本](./verification/pack-install.mjs)
- [公开消费检查脚本](./verification/consume.mjs)
- [模块隔离 guard](./verification/isolation.mjs)
- [原始机器结果](./verification/results.json)：14 次 CLI 调用均符合各自预期退出码，
  以及八次 alias 比较、initial API 结果和零执行断言。
- [消费者 lockfile](./verification/consumer-lock.yaml)、
  [真实安装输出](./verification/install-consumer.log)、
  [证据文件 SHA-256 索引](./verification/artifact-hashes.json)。
- [实际 fixture Git bundle](./verification/fixture.bundle)：完整保留上述示例提交及目录对象，
  6,055 字节，`git bundle verify` 通过；清理运行缓存后仍可独立审计对象。

最终消费脚本退出 0、status=passed。归档及 17 个 tarball 的实际文件哈希再次核对通过，
501 个实际模块路径的 containment 再次核对通过，三个验证脚本经格式化和 Node 语法检查。
没有再次运行与本阶段无关的完整 pnpm check；实现验收已有的完整检查不被本证据替代。

## 非阻断偏差与未执行边界

初次消费者离线安装因设备原生 pnpm 的 registry 元数据缓存布局不同而失败；
改用 `--prefer-offline` 刷新公共元数据后安装成功，不链接源工作区依赖，也不发布任何包。
Windows 初次 harness 使用反斜杠相对模块说明符，被 Node 的 `--import` 拒绝；
改用 file URI，并从全新 fixture 状态完整复测后全部通过。这些是消费准备偏差，不是产品缺陷。
归档构建仍显示既有 CJS import.meta 警告，实际构建与消费均通过，未修改已验收实现。

本轮未发现实现阻断缺陷。没有 npm 发布、远程 schema Pages 部署、生产变更或真实模型
Agent 调用；也不将本机 Windows/Node 24 的结果扩展为其他 OS、Node 版本或线上服务承诺。
操作专属执行目录在证据归档完成后清理，父代理的 decision request 不在清理范围内。
