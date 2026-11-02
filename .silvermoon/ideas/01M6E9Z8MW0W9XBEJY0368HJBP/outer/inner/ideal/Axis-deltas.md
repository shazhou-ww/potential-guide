# Axis 变更影响与后续改造边界

本文件服务于 [Idea](Idea.md)，列明本轮需要调整的契约、责任范围和可观察结果。
它不是旧代码审计、完整实施设计或完成证据，也不新增 Axis 未确认的业务规则。

## 前置关系与比较基线

- 前置 Idea：`01M6DMXBMQF8RTVM6Z00M1GPD1`，别名 `task-engine-contract-refactor`，
  [方向卡][previous-idea]、[差异索引][previous-audit]及 [Q08 决策][previous-decisions]保留原历史含义。
- 本 Idea 可以先准备和评审，但实施必须等待前置 Idea 完成。开始实施时核对其完成状态、
  实际交付提交和验证证据；不把已接受 Ideal、独立 Worker 阶段或某项测试通过当成整轮完成。
- 前置轮比较快照为 `616cc7cf9e12918cc60f06b0bccf786b8dd8c8a9`；
  Task Bundle 初版为 `b6c1c655`，审阅收敛及与上游资格见证整合后的 Axis 基线为 `5433cc62`。
  以上是定位快照，不是前置轮已完成的声明；后续开工须对实际交付重新确认差异，已实现项不重复改造。
- 本轮准备合并了上游的持久资格见证规则，但按用户最新确认加入终结回拨失配例外。
  不回写前置 Idea 的 Q08 或其生命周期决定；该语义差异必须由下一轮显式验收。
- 当前规范以 [Task Bundle][bundle]、[受理][admission]及其引用的现行 Axis 为准。
  `task-engine.draft.md` 是历史参考，不作为恢复旧注册、权限或复验机制的依据。

## 保持不变的基础

上一轮负责的数据域独占、源 revision、冻结分页、订阅补读、完整集合变化封装、
Task 三维状态和每 Run 独立 Worker 是下一轮的起点，不另建第二套事实系统。
运行结果必须结合宿主观察到 Worker 退出裁决；资源回收是另一事实。
Request、Task、Run 不合并，原 Request 意图不可变，停止观察不取消处理。
未取消且当前 eligible 才可新增匹配或调度，Task 超时不等于取消；
已开始且失去跟踪的旧 Run 恢复为 stopped，不自动重演。

## 需要调整的地方

“原边界”来自前置轮契约或本轮已替换的设计，不声称每项都已经在代码中实现。
责任列用于开工核对，不规定类名、存储表、线程池或 HTTP 路由。

| ID | 原边界或需要接续的基础 | 本轮明确调整 | 主要责任 |
| --- | --- | --- | --- |
| B01 | 由宿主装配类型、选择类型名称/版本，提供类型发现 | 每个 Request 必带 `{url, digest}`；Engine 无显式 Bundle 注册、无 `discoverTypes`。Digest 是内容身份，重名 `name` 只展示；不同 Digest 可并存 | task-protocol、task-engine、task-engine-server、task-engine-http；所有提交方及 UI |
| B02 | 业务制品各自解释和获取 | Engine 统一装载 `task.yaml`、`worker.cjs`、可选 `schemas/` 与 `resources/`。`$schema` URL 同时确定声明格式和 Worker 协议，无独立 format/protocol 数字版本 | 通用装载机制、协议、标准 Schema、文档及样例 |
| B03 | Bundle 内容、传输和资源限额需要统一 | tar.gz 逻辑根直接对应 Bundle 根；完整文件树按 Git SHA-256 原始字节计算。验证路径、链接、重复条目和 Digest；容量由宿主配置，不隐式修复或替换内容 | 装载/缓存、server 配置及验证测试 |
| B04 | 本地模块/factory 装配与运行协议封装需要转为可交付入口 | 作者手写 YAML，单独提供业务回调；新增 `@potential-guide/task-sdk`，根入口 `runTask`，`/build` 的 `buildTaskBundle` 生成自包含 CommonJS Worker。宿主直接启动入口，仍每 Run 一个 Worker | 新 task-sdk workspace、Engine Worker 启动、构建/打包及直接适配器 |
| B05 | 输入契约只使用局部声明或局部引用不足以表达共享 Schema | 三份业务 Schema 支持标准 `$ref`；构建锁定并收齐传递依赖，按 `$id` 在 Bundle 内解析。Engine/Worker 不联网补 Schema，内容纳入 Digest | SDK、Schema 编译与输入验证、协议发现替代后的消费者 |
| B06 | 同步受理直接返回 Task 或错误 | 新增可持久跟踪的 preparing；accepted 才创建 Task，rejected 不创建 Task。tracking token 就是 requestId；多个 Request 可共享 preparation，但逐请求校验、逐请求结果 | protocol、engine、storage、HTTP、SDK/client、UI |
| B07 | ID 窗口在短同步提交中检查，尚无持久受理前等待 | 到达时检查并保留原窗口资格，preparing 可跨重启继续；后续重试独立检查新到达窗口。无 preparation 整体等待预算，下载不占 Task timeout；receivedAt 仍为最终创建时刻 | 受理协调、持久记录、恢复和时间测试 |
| B08 | getRequest 读取原始请求，观察对象主要为 Task/Run | 新增按 requestId 的处理结果查询，与 getRequest 分离；一个操作用可选 waitMs 表达立即读取或 long poll。未知/已清理不伪造 preparing；终态保留从形成终态起算，由宿主配置 | protocol、engine、HTTP/client、UI、storage 清理 |
| B09 | Bundle 缓存和历史内容保留需要区分 | 缓存按 Digest 复用；历史只要求保留 URL/Digest，内容可淘汰、需要时重新获取并验证。preparing 及幂等所需记录必须保留，终态跟踪清理不删 Task/Run | 缓存与存储、恢复、查询及清理边界 |
| M01 | 曾有仅投影显式 Schema 属性的输入判等语义 | 合法额外字段也参与结构判等，字段存在或值不同均不能忽略；不扩展尚未约定的完整判等算法，Request 幂等仍比较完整原始意图 | task-protocol 的判等、engine 匹配、Schema 引用解析与测试 |
| M02 | “已生效”容易被误读为只越过 eligible 下界 | 明确 pending/eligible/timeout 互斥，新匹配和调度必须未取消且处于 eligible；超时本身不撤销仍成立的匹配。这是资格定义澄清，不是新增超时取消 | 匹配、调度、时间推导及消费者标签 |
| M03 | 前置轮 Q08 明确：资格见证成立后，后续较小终结墙钟也不撤销匹配 | 本轮明确例外：实际终结时间早于 effectiveEligibleAt 时，提前推导的 terminates-after-eligible 匹配失效。保留资格见证及源前缀重放，不能再无条件保留该匹配 | 匹配投影、持久事实重放、Task stage、巡检与恢复 |
| M04 | 观察/恢复依赖唯一匹配及源 revision | 同一事实边界仅一个有效匹配；失配后无匹配为 initial，历史不抹除。失效沿用 Run 终结源 revision；后续匹配沿用其依据，更新 TaskEvent/摘要/updatedAt/集合变化，恢复时同样推导 | protocol、engine、storage、HTTP、Web UI 的完整观察链路 |

## 重点一：受理前 preparation 是新增持久流程

依据 [受理契约][admission]与[恢复契约][recovery]，不能只在原 submit 外包一个下载 Promise：

- 返回 preparing 前可靠保存原 Request、处理状态、窗口资格和共享 preparation 关联。
  Request ID 是查询标识，不额外生成 token；查询不需要先拿到 preparing 响应。
- preparation 共享的是获取和验证 Bundle，不是某个 Request 的最终受理结论；
  同一 Bundle 的两个输入可能分别 accepted/rejected，不合并 Task。
- Task 创建与 accepted 结果一致持久化，崩溃、并发重试不重复创建；
  rejected 也需保留幂等依据，不能因没有 Task 而丢掉原意图。
- 接口贯通三种结果：客户端不能收到 preparing 就当成 Task；
  UI 不伪造 Task 卡片或在 preparation 期间开始显示 Task eligible/timeout。
- long poll 的等待到期只结束该次观察；断开、停止查询、重启或耗时长不构成 preparation 超时。
  明确获取/格式/Input 错误仍 rejected，不以无整体时限掩盖失败或无限重试。
- preparing 恢复与已开始 Run 的 stopped 恢复严格分开。恢复准备不授权重演业务执行。
- 原始请求读取、跟踪结果、Task/Run 历史和 Bundle 缓存各自有保留边界；
  终态保留期缩短不能删除在途资格与幂等仍需的依据。

## 重点二：身份、Schema 与运行入口同时切换

依据 [Bundle 契约][bundle]，不能仅将旧类型名改为 Digest：

- URL 只是获取位置；每个 Request 仍必须带 URL 与 Digest，缓存命中也不省略。
  来源不同而内容相同可以复用内容，不新增来源/执行权限模型。
- 注册配置、发现列表、版本选择控件和服务器启动参数需移除预注册假设。
  Bundle 查找由调用方或外部目录负责，不将缓存列表包装成类型目录。
- YAML 是作者契约来源，不能反向从回调代码覆盖声明；业务模块通过构建参数选取，
  成品不需要宿主 factory 导出名、源码路径或 npm 安装。
- SDK 运行与构建入口分离；生成入口及业务依赖打进 worker.cjs，消费者无需安装 SDK。
  input/context、结果返回与错误上报走 SDK 封装，不把原始 Engine 或通信端口作为公共回调参数。
- `$schema` 选择同一声明/通信协议契约；业务 `$ref` 则只选择业务 Schema，
  两者不能混为版本选择。宿主与 Worker 使用同一次构建固定的契约及共享定义。
- Check/Probe 等直接调用方只做必要的 Bundle 引用、受理结果和运行边界适配。
  本 Idea 不定义 runCheck/runProbe 或 Objective 的新业务描述格式；若迁移需该决策，应另立业务契约，
  不以双层 Worker、旧动态 Checker 加载或暗中注册绕过标准。

## 重点三：审阅确认的匹配增量不能漏掉

U01–U03 已由用户讨论收敛，不再是本 Idea 要重新询问的开放问题。
其现行依据是 [输入判等][bundle]、[匹配与巡检][matching]、[生命周期][lifecycle]、
[观察][observation]、[停止][termination]和[恢复][recovery]。

### M01：额外字段参与判等

当 Schema 允许额外字段时，`{"target":"repo-a","mode":"fast"}` 与
`{"target":"repo-a","mode":"full"}` 都合法但不等，不能共享 Run。
校验、判等和 Request 幂等是三个不同判断，不以“通过 Schema”代替相等，
也不把业务输入判等替代整个 Request 的原意图比较。

### M02–M04：终结回拨例外与巡检

前置轮 Q08 的持久资格观测解决“时间资格变化如何由源事实重放和补读”；
本轮不删除该基础，但须调整其“较小终结墙钟永不撤销既定匹配”的保证。
**仅 now 回拨不自动抹去已成立关系；新增实际终结事实不满足政策，才触发本轮的失效例外。**

示例：Task 在 eligibleAt=100 后已提前匹配仍运行的 R；
宿主后来观察 R 实际退出的墙钟为 95，则该 terminates-after-eligible 匹配失效。
Run 的真实终结结果保留，Task 不使用它形成终态；无有效匹配时为 initial。
Engine 巡检只对未取消、当前 eligible 的失配 Task 重判并按需启动新 Run：

- 不修改原终结时间、生效时间、deadline、Request 身份或历史匹配事实。
- 不绕过最早开始顺序、唯一有效匹配或已进入停止流程的候选排除规则。
- pending 不提前启动，timeout/已取消不启动；“僵尸 Task”不是新 stage。
- starts-after-eligible 不因终结时间回拨而失效。
- 新 Run 不是复活/重演旧 Run。重启失联的 stopped 裁决不伪造退出时间，不借此制造失配。
- 匹配失效、后续成立和 Task stage/updatedAt 必须经现有源 revision 体系贯通历史、
  冻结分页、单体订阅和集合补读；无事实变化的巡检不能制造事件。

这项差异也必须体现在前置轮反例的后续测试中：
保留纯 now 回拨时的已成立匹配，但将“R 以更小实际终结时间退出后仍保留”改为失效并按资格巡检。
不能把前置轮测试原样通过当成满足本轮契约。

## 可观察验收场景索引

以下是结果与证明要求，不预排详细实现任务：

| 场景 | 必须观察到的结果 |
| --- | --- |
| V01 成品与供应链闭合 | 手写 YAML 与回调经 SDK 构建，可在无作者 node_modules 的消费环境运行；三份 Schema 及传递引用齐全，错误 `$id`/缺失资源明确失败 |
| V02 内容与传输身份 | 压缩元数据变化不改 Bundle Digest，文件字节/名称变化会改变；摘要错误、越界路径、链接、重复条目和容量超限明确拒绝 |
| V03 按需受理与独立跟踪 | 无注册/目录也能提交；缓存命中可直接终态，缓存缺失可 preparing；同 Bundle 多 Request 各自以 requestId 跟踪，不合并输入或结果 |
| V04 持久恢复与幂等 | preparing 后重启继续；Task 创建与 accepted 原子一致；失败请求重试不另开处理；到达时资格保留，新到达重试仍独立检查窗口 |
| V05 三种时间边界 | 长 preparation 不产生 Task timeout；Task 创建后才锚定 receivedAt/eligible/deadline；long poll 到期仍 preparing，不撤回处理 |
| V06 保留与再获取 | preparing 依据不清理；终态从原形成时间计龄；token 清理不删 Task，必要幂等仍保留；历史 Bundle 淘汰后重取原 Digest，缺失不重跑或伪造 |
| V07 输入判等 | 额外字段差异例子合法但不等，不共享 Run；共享 Schema 引用不会绕过相同判等规则 |
| V08 回拨与资格 | 当前 now 回拨不抹匹配；真实终结回拨可使 terminates 匹配失效；eligible 未取消才可巡检推进，pending/timeout/取消均不得启动替代 Run |
| V09 完整观察与恢复 | 失效及后续成立的事件、摘要、updatedAt 与查询一致，补读不丢成员或重复制造事实；恢复重放同一关系，不将 stopped 恢复当退出时间 |
| V10 消费链路 | HTTP/client/UI 正确区分 Request 准备与 Task 状态；无注册选择器假设，显示 name 不作身份，direct adapters 使用固定引用 |

## 不在本轮准备中提前决定

正式方法名、路由/消息编码、构建参数与 context 成员类型留到实施细化，
不因需要做改造清单而编造新的用户决策。旧持久格式与消费端切换在实施前明确，
遵守 Axis 对不支持格式显式拒绝、保留原数据、不自动迁移或重演的边界。
SDK 可形成可发布包，但本 Idea 不执行 npm 发布；外部验证用受控本地产物与临时数据域。

实施责任预计涉及 task-protocol、task-engine、task-engine-storage、task-engine-http、
task-engine-server、新 task-sdk、直接 Check/Probe 提交方与 task-engine-web-ui，
以及必要的通用制品代码、标准 Schema、构建脚本、样例、测试和文档。
这不是整个仓库重写授权；开工时只调整实际受影响表面并保留已有业务能力。

[bundle]: ../../../../../../docs/axis/task-engine-contracts/task-bundle.md
[admission]: ../../../../../../docs/axis/task-engine-contracts/request-admission.md
[matching]: ../../../../../../docs/axis/task-engine-contracts/run-matching.md
[lifecycle]: ../../../../../../docs/axis/task-engine-contracts/task-lifecycle.md
[observation]: ../../../../../../docs/axis/task-engine-contracts/observation.md
[termination]: ../../../../../../docs/axis/task-engine-contracts/run-termination.md
[recovery]: ../../../../../../docs/axis/task-engine-contracts/persistence-recovery.md
[previous-idea]: ../../../../01M6DMXBMQF8RTVM6Z00M1GPD1/outer/inner/ideal/Idea.md
[previous-audit]: ../../../../01M6DMXBMQF8RTVM6Z00M1GPD1/outer/inner/ideal/Contract-audit.md
[previous-decisions]: ../../../../01M6DMXBMQF8RTVM6Z00M1GPD1/outer/inner/ideal/Open-questions.md
