# Deployment

本契约的最终结果是：受影响的产品包通过既有 GitHub Actions / npm Trusted Publishing 流程真实发布为 RC，独立消费者能从 npm 安装并按迁移指导运行。不是仅生成 tarball、通过 dry-run 或发布 placeholder；实际发包仅在实现候选完成验收且发布前置条件核实后执行。

用户已报告 placeholder 与 Trusted Publisher 配置完成，并授权主会话自主审批实现与部署门线、以子会话推进执行。该报告作为外部准备输入，不替代 D-S01 的实际核实或产品发布证据。

## 版本与发布边界

- **仅发布 `0.x.y-rc.N`，dist-tag 固定为 `rc`。** 本 idea 不发 1.0 或更高主版本，不发无预发布后缀的稳定版，不修改现有 latest 指向。
- **逐包按实际变更判断，不统一抬版本。** 先核实 npm 已发布版本、稳定版基线与正在进行的 RC 系列，结合公开 API、行为、规格、CLI 和依赖变化确定目标；仓库 manifest 和 latest 各自都不能单独代表完整发布现状。
- 在 major=0 的项目策略下：破坏性变更升 minor 并将 patch 归零；兼容新增能力也升 minor；仅兼容修复升 patch。这是本项目对 SemVer 0.x 阶段的约定，不将 breaking 自动提升到 1.0。
- 新包若只有 0.0.0 placeholder 或尚无产品版本，首个有功能的候选采用 `0.1.0-rc.0`。已有包不照搬新包版本；例如相对 `0.2.4` 的破坏性变更对应 `0.3.0-rc.0`，仅修复对应 `0.2.5-rc.0`，示例不是本轮已选定的版本。
- 同一目标版本已处于 RC 阶段、后续调整仍属于该候选范围时，递增 `rc.N`，不因每次候选修订重复升 minor / patch。若实际变更需要另一个目标版本，则重新做版本判断。不得覆盖已有 npm 版本、复用或移动已推送 tag。
- 发布清单仅包含有实际实现或发布相关变更的包及必须随之更新的消费者；不发布退役的 objective-guide，不把 placeholder 当作交付，也不为未变更的包制造一轮发布。依赖变更须判断其对各消费者公共契约的影响。
- 产品发布沿用[发包流程](../../../../docs/npm-publishing.md)：tag 与该包 manifest 版本完全一致，tagged commit 已进入 primary，逐包按依赖顺序发布。新包映射、RC 元数据与工作流改动在 Implementation 阶段完成，部署阶段验证并使用，不临时改写实现。
- 新包 placeholder 由另一个 Agent 处理，Trusted Publisher 由用户配置；部署前核实实际完成状态，不由叙述推断成功。不将 npm token 写入仓库或 GitHub Secrets；外部配置或权限未就绪则明确阻塞，不降级为手动产品发布。

## Steps

### D-S01: 确认 RC 清单与发布前置条件

对照 Implementation 候选和 npm 当前状态，确认每个包的版本理由、目标 RC、内部依赖与发布顺序；确认候选 commit 已同步 primary、检查通过，placeholder、Trusted Publisher、npm environment 与新包 tag 映射就绪。记录现有 latest 指向供发布后对照，核实目标版本尚未占用。若并行发布、代码变更或版本冲突使候选失效，返回实现准备新候选，不移动 tag 或直接修改产物。记录确切部署契约修订与候选 commit 后再执行发布。

### D-S02: 按依赖顺序真实发布 RC

按核实后的依赖顺序创建包专属 RC tag，逐个等待 OIDC 发布工作流成功，确认上游 RC 在 registry 可解析后再发布下游。不以 dry-run 替代真实发布，不发布稳定版或改变 latest。遇到部分成功，记录每包状态并停止依赖它的后续发布；先查询 registry 与工作流再处理失败，避免重复发布，已发布版本不覆盖。

### D-S03: 从 npm 验证迁移与实际效应边界

在独立临时项目从 npm 安装明确的 RC 版本，而非仓库源码、workspace 链接或本地 tarball，按迁移指导运行公开导出与 CLI 示例。使用可控 Agent 适配器、真实子进程、本地 HTTP 服务和可控 Git 仓库验证规格获取、观测、修复重探测、按依赖替换与取消。记录版本、安装依赖、环境、命令及结果；不直接修改 Silvermoon 项目，不把该验证称为 Silvermoon 已迁移。

## Acceptance criteria

逐包发布与纯验证回执、产物 integrity / provenance、实际 npm 安装消费者和平台覆盖见[部署证据](./Release-evidence.md)。记录保留原始失败 run 与后续验证恢复，不将 metadata 传播延迟导致的失败 run 改称成功。

### D-AC01: RC 版本决策与发布范围可审计

发布清单逐包包含已发布基线、变更分类、SemVer / 0.x 判断理由、选定 RC、依赖顺序与候选 commit；能区分新包首个产品版本、已有包的新目标版本和同一候选的 RC 序号递增。所有目标均为 `0.x.y-rc.N`，无 1.0、稳定产品版本或退役包的新发布；新包配置与并行 Agent 交付均有可核实的外部结果。

### D-AC02: 所有目标 RC 已真实发布且可获取

逐包有成功的产品发布 workflow 链接、包专属 tag / commit、npm 版本及 integrity / provenance 证据；registry 的 rc 指向本轮目标版本，latest 与发布前记录一致。独立环境能获取每个目标 RC 及其传递依赖；产物版本、导出和依赖对应候选。任一包只有 placeholder、dry-run、部分成功或安装失败，均不满足本条。
若 OIDC Publish step 已成功、仅后置 metadata 验证因传播延迟失败，保留原失败 run，使用不发包的 verify-published 模式补全成功回执；不能重新发布、覆盖版本或将原 run 伪称成功。正常发布仍要求完整 workflow 成功。registry 的 rc 指向本轮目标版本，latest 与发布前记录一致。独立环境能获取每个目标 RC 及其传递依赖；产物版本、导出和依赖对应候选。任一包只有 placeholder、dry-run、部分成功或安装失败，均不满足本条。

### D-AC03: npm 消费者可复现迁移与运行边界

独立消费者的安装与执行记录证明迁移指导足以使用已发布 RC 的库和 CLI，无隐式仓库依赖。真实进程 / HTTP 场景证明业务缺陷与调用故障分离、Agent 接收完整观测并在修复后重探测、取消能在声明的平台和宽限期内清理本地探针资源；HTTP 本端取消不被报告为远端任务终止。Git 场景证明 ref 变化能进入规格状态、旧快照内容与 commit 不变、来源失败显式可见；替换场景证明轻量更新保留 Pilot 且旧结果不污染新状态。记录实际验证的平台与未覆盖边界，不夸称跨平台全部成立或 Silvermoon 已完成迁移。
