# Implementation 验证证据

## 候选与环境

- 生产实现提交：`c55313834203bc3670831e40197a3e15ac3adadb`。
- 基础源码修订：`10df39610dc28225ff865eef16fbf84104bb2c46`；移除 Effect lock entry 的公司镜像固定 tarball URL，保留原完整 integrity，让各获准环境按自身 registry 元数据验证。
- 最终发布验证工具候选：`e38fd57e63e6661a6f1ec13e88220321483c2c86`；加入有界 registry 传播等待与不发包的纯验证恢复，未改变已发布 effects 的产品实现。
- 本地环境：Windows x64、Node 24.11.1、pnpm 11.22.0。
- [最终候选 CI](https://github.com/shazhou-ww/potential-guide/actions/runs/38877774181) **5 / 5 jobs 成功**：Node 22.13.0 / 24.11.1 完整检查，以及 Ubuntu / macOS / Windows 的独立打包消费者验证。
- [逐包 RC 清单](./Release-candidates.md)与[迁移指导](../../../../../docs/functional-migration.md)均已交付。打包证明不等于 npm 发布证明，实际发布状态由 Deployment 记录。

## 完整验证结果

`pnpm check` 本地通过，覆盖 formatter、lint、生产类型检查、测试严格类型检查、测试与逐包 pack 检查。发布验证工具修订后，测试共 **116 项，115 通过，1 项平台跳过**；跳过不计为通过，其他平台结果由上述 CI 单独证明。Biome 仍有显式报告的 warning，未通过禁用规则掩盖错误。

| 范围 | 本地测试数 | 结果 |
| --- | --- | --- |
| effects | 12 | 全部通过。 |
| git-source | 15 | 全部通过，包括实际 pin 路径超过 260 字符的 Windows 回归。 |
| objective-pilot | 23 | 全部通过。 |
| objective-regulator | 16 | 全部通过。 |
| objective-portfolio-supervisor | 6 | 全部通过。 |
| cli-core | 9 | 全部通过。 |
| config | 4 | 全部通过。 |
| pguide | 21 | 20 通过，1 平台跳过。 |
| 根发布 / 部署工具 | 10 | 全部通过，包含 4 项 registry 传播 / 恢复回归。 |

本地完整原始输出在 `.cache/functional-implementation-check.log`；独立 tarball 消费者输出在 `.cache/functional-consumer-check.log`。这些是本地复跑日志，不冒充远程永久证据；永久的跨平台验证绑定上述 CI run 与候选 commit。

## I-AC01：公开契约与来源边界

- 生产 workspace 已从 Guide 转为 effects、git-source、objective-pilot、objective-regulator、Supervisor、CLI Core、config 与 pguide；旧 Guide 的源码、manifest、TypeScript 引用及发布映射退出，不保留兼容入口。
- Spec / Subject 分离，目标和 Agent 单次限制只属于 Strategy；层级使用 ID，前置与问题引用保留 Objective 归属。观察无顶层业务 ok，统一信封使用 status / payload / message；业务缺陷仍为 200。
- git-source 不导入 Objective 领域类型；固定 commit、ref 移动、脏 checkout、不合作或已经删除的本地来源都不会改变已有快照的内容 / 版本配对。
- 资源适配支持 origin 身份与本地未推送 commit 分离、显式旧 commit，以及两个不同仓库的前置链。各 Objective 通过 versionFor 取得自己的 commit，检查路由和 Scope 清理独立验证，不将 root commit 复制给其他仓库。
- Wiki 的多语言、精确 Unicode 描述长度、缺失 / 悬空元数据与 JSONata 动态能力及输出限额保留回归覆盖；同层聚合 / 顺序、并发上限和前置 subject 投影均验证。

## I-AC02：闭环与生命周期

- effects 使用原生 Effect / Fiber / Scope / Stream / SubscriptionRef，只补充运行句柄、依赖 key、generation 和提升。预取消不执行用户计算；旧任务先收到 Abort，新任务不等旧 finalizer；迟到 callback 和不可中断旧任务不能覆盖当前状态。
- Regulator 将完整问题集合交 Agent，修复后重探测；单次限额每次调用重新生效，不转成跨轮预算。调用失败不启动 Agent。轻量策略 / 绑定变更保留未变化的 Pilot。
- Strategy 的 adhoc / periodic、probe timeout、有限重试与 effect TTL 有真实消费与测试；4xx 不重试，5xx 按规则重试，周期 / 生命周期复用底层时间能力。TTL 与 Agent 单次 timeout、Probe 清理宽限期分别表达。
- 进程、HTTP、内存 Probe 使用统一业务 / 调用语义；进程 stdout 只返回信封、stderr 旁路采集。取消及本地资源释放测试通过；HTTP 取消不被当成远端业务停止。
- 需要一致性的配置以完整根快照提交。独立 ref 的 latest 混合版本对照测试仍保留，不宣称已经实现通用 FRP 跨源事务。

## I-AC03：可迁移、可发布候选

- 八个包实际 pack、公开导出、必要类型产物、LICENSE、README、bins 与依赖边界通过检查。pguide tarball 明确拒绝遗留的 dist/commands/guide 产物。
- 独立消费者安装全部八个本地 tarball，不引用仓库源码。实际 Git URI 探测、直接 / 分发 CLI、stdin subject、扩展发现和参数边界、ACP 修复闭环、continue / session-resume、持久化、保留期、脱敏、单次超时及旧选项明确拒绝全部通过。
- continue 保留来源 commit 与本地 sourcePath，必要时恢复真实 ACP session；会话不存在或恢复失败不会静默当成成功。异步观测持久化通过串行队列落盘，不引入业务锁或跨轮预算。
- Supervisor 仅作必要领域适配；不重设计 Supervisor，也未修改 Silvermoon 仓库。消费迁移文档说明新 import、输入、协议、配置 schema 2、旧记录不兼容、行为与取消边界。
- workflow、共享包清单、package-specific tag、bootstrap 工具与 RC 元数据同步迁移。所有候选为 0.x RC；新包与已有包独立判断版本，不创建 1.0 或稳定产品发布。

## 实际发现并修复的问题

1. **已取消 Signal 的同步启动**：不能只依赖 runFork 挂接 signal，启动前明确阻断用户计算；生产回归通过。
2. **旧完成写回**：运行句柄取消不代表外部业务停止，以 generation 隔离旧结果，包含不可中断 Effect。
3. **Windows 深目录 Git pin**：真实 tarball 消费者的 ref lock 路径超过 MAX_PATH，Git 返回 128；控制实验中 272 字符 pin 失败，单次启用 core.longpaths 后成功。生产 runner 仅在 Windows 命令中设置该选项，不改变用户 / 全局 Git 配置；真实消费者随后通过。
4. **注册表 URL 固定导致 CI 安装拒绝**：首次 CI 的 pnpm supply-chain 检查拒绝公司镜像 tarball URL 与公开元数据不一致。保留 integrity、移除环境固定 URL 后，本地公司镜像核验和云端五个 jobs 全部通过，未放宽策略或关闭 TLS。
5. **适配与恢复错误**：统一 payload / message、保留真实会话 ID、异步落盘排队、明确源码 / 清理错误及原始 cause；这些修复进入集成测试，不靠成功形状 fallback。

## 验收边界

### HTTP 202 处理窗口

实际发布日志明确报告 PUT 202 与 “may take a few minutes”。原一分钟等待窗口对这种正常处理偏短，虽然纯验证恢复已安全取得真实回执，仍应修正未来发布的默认路径：延长为 60 次、每次间隔 5 秒，并增加模拟 90 秒传播的回归，避免正常异步处理总是触发恢复。此修订不改变任何产品包，不重发任何版本；I-S03 / I-AC03 在新检查完成前重置，实际 RC 的不可变发布回执仍有效。

最终打包 CI 的一次 macOS 运行还暴露测试脚本的两秒 Agent-ready 假设：超时后未等待被测 CLI 退出就删除 workspace，ENOTEMPTY 又遮蔽原失败。验证脚本改为最多 30 秒的明确就绪等待、退出前失败诊断及 finally 终止 / 等待唯一持有的 child；fixture 故意在原两秒界限后才报告就绪。顶层同时保留主错误与清理错误，不让清理错误掩盖真实原因。已发布产品不受这个测试 harness 修订影响；真实 npm 消费者 CI 38882670463 的五个 jobs 已成功。

### 发布验证工具修订

首次 effects RC 的 [OIDC publish step](https://github.com/shazhou-ww/potential-guide/actions/runs/38876853830) 成功，但紧接着的 registry 查询因短暂 E404 导致整个 run 失败。暂停下游发布，返回实现修订发布验证工具：加入有界传播等待与纯验证恢复模式，不覆盖版本、不移动已推送 tag，也不重新执行已成功的发布。4 项新回归、完整 pnpm check 和最终候选的五个 CI jobs 均通过。[真实纯验证恢复](https://github.com/shazhou-ww/potential-guide/actions/runs/38877790288) 成功，Publish / Pack / dry-run 均跳过；回执确认 effects@0.1.0-rc.0、rc 指向该版本、latest 仍为 0.0.0、integrity 与 provenance 存在，原 producer commit 为 4526dd019d806c4d83f45fa60b66dde687e8c669。原失败 run 保留，不重复发布。I-S03 / I-AC03 修订证据已补齐，可对新 implementationRevision 重新提交并审批。

上述证据支持 Implementation 门线；由已获用户授权的主会话审批，并通过 Silvermoon 的精确 revision Submit / Accept 记录状态。npm OIDC 权限、实际产品 RC、provenance、rc / latest 和 npm 安装消费者仍由 Deployment 验证，不能提前勾选部署验收。
