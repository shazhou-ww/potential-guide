# 主体执行证据

## 契约与实现定位

- [不可变新 schema](../../../../../schemas/objective-artifact/v1.json) 与[公开消费/兼容说明](../../../../../docs/objective-artifacts.md)；原 Objective v1/v2/v3 和 declaration v1 schema 未修改。
- [工具侧制品组装](../../../../../packages/cli-runtime/src/objective-artifact.ts)、[来源路由](../../../../../packages/cli-runtime/src/pilot-source.ts)、[协议身份/证据校验](../../../../../packages/pilot-protocol/src/resources.ts)。
- [公开组合示例](../../../../../packages/cli-runtime/examples/objective-artifact/build.mjs)：两种独立 Check、同一 Check 的两个局部引用、固定 Objective 前置依赖、累计等级及中文 References 覆盖。
- [API 组合/恢复测试](../../../../../packages/cli-runtime/test/objective-artifact.test.mjs)、[公开 CLI 与真实 Coordinator 调度/存储恢复](../../../../../scripts/objective-artifact.test.mjs)、[协议证据测试](../../../../../packages/pilot-protocol/test/artifact-evidence.test.ts)。

## 已实际执行

环境为 Windows、本仓库 pnpm workspaces；未向 npm、GitHub Release 或其他第三方上传制品。所有自包含测试拥有的 Host 在 finally 中关闭，测试目录在项目 `.cache` 内并清理。

1. `pnpm install --ignore-scripts`：在为 cli-runtime 增加现有 workspace Check 制品依赖及 catalog Ajv 后更新 lock，成功，无新第三方下载。随后 `pnpm schemas:build` 和相关 `tsc -b` 成功。
2. `pnpm exec tsx --test packages\check-artifacts\test\artifacts.test.ts packages\pilot-protocol\test\artifact-evidence.test.ts packages\pilot-protocol\test\protocol.test.ts packages\objective-pilot\test\dependency.test.ts packages\regulation-coordinator\test\requests.test.ts`：最终 **36/36 通过**。含现有 Check 真实 HTTPS 获取、双摘要、拒绝 redirect/tamper、离线缓存执行、Host 取消及依赖预算等回归。
3. `node --test packages\cli-runtime\test\objective-artifact.test.mjs scripts\objective-artifact.test.mjs`：主 Agent 对最终候选独立重跑，**8/8 通过**（七项 API、一项公开 CLI/Coordinator）。验证映射、等级、依赖、References、回退/循环/悬空/未知 problem、恢复及错误内容；同时读取真实 `source.prepared` 和 `check.started` JSONL，逐项核对 Check 逻辑摘要、Host revision 和完整依赖闭包。新增回归覆盖恢复调用者的冲突摘要、不同 Check/重复引用的自包含 schema `$id` 隔离，以及原 v3 允许的空 Check 组合语义。
4. `node --test scripts\objective-artifact.test.mjs`：最终 **1/1 通过**。公开 `validate artifact`、`probe --objective`、目录+准确摘要、中文指导、`regulate --target terminal`、`continue` 均实际执行；regulation 持久化 v6，检查真实 Check/Host 证据和两个 Objective 来源。来源删除后恢复仍为同一准确闭包。Coordinator 实际调度同一制品、运行真实 Pilot、写入 store、关闭后重新打开并重放；timed eligibility 和 Request v2 identity/digest 分离也验证。SQLite 仅报告 Node 的 experimental warning。
5. `pnpm exec tsx --test --test-name-pattern "real repository" packages\objective-monorepo-standard\test\pilot.test.mjs`：最终 **2/2 通过**（含嵌套 Regulator 依赖测试）。最初误用裸 Node 缺少现有 TS loader，改用已有 tsx，未安装新工具。
6. 项目要求的 `pnpm check`：主 Agent 接续执行，最终退出 **0**。layers、format、lint、typecheck、test、pack:check 全部通过；包括全部包的构建和测试、根脚本测试、23 个本地工具/业务包打包验证，以及 10 组真实隔离消费者。已有 CommonJS bundle 的 import.meta 警告仍明确输出，未修改无关生成链路或将警告隐瞒成没有限制。

原实施 subagent 在完成上述候选代码和大部分定向验证后被运行时取消，没有产生阶段提交。主 Agent 保留其成果，接续审阅全部新制品组装逻辑、协议/CLI/持久化接线及相关测试，并执行上述最终定向和完整检查；没有把取消视为完成或重启另一个同目标 subagent。

## 调试中发现并解决

- 通用文件读取最初沿用要求 worker.cjs 的执行 reader，不能读取纯数据 Objective：抽出共用有界树读取，执行 reader 仍保留原 worker 要求；Host 未增加 Objective 逻辑。
- Windows 私有存储对 JSON 文件要求受保护 ACL：Objective manifest 改用现有 protected private-file 原语，不以普通写文件或权限修复回退。
- Pilot 依赖版本检查原来仅识别 Git/npm 摘要：增加独立 Objective 制品摘要；regulation 页面验证加入有类型的 origin/resourceBase，未绕过原校验。
- Check 原有 missing/undeclared 回归发现读取重构改变了校验顺序：恢复原顺序后全部 36 项相关回归通过。
- 新增调度测试曾被局部变量同名遮蔽并在失败清理时留下锁目录：修正变量名，进程退出后仅删除该测试自有目录；最终真实调度/存储重放通过。没有因此修改无关业务。
- 完整检查的早期轮次分别暴露隐式 any、缺省历史 commit 读取类型兼容，以及旧测试构造伪造 Git commit 时缺少来源 discriminant：去掉隐式 any/non-null assertion，使用禁止伪造 commit 的 `commit?: never` 保留旧缺省读取，并在该 Git 专属测试显式收窄 kind。恢复入口也显式拒绝与已固定来源冲突的调用者 revision。
- cli-runtime 新增 Check 制品运行依赖后，monorepo 检查要求根 delivery 闭包及 package-owned joins/allows 同步声明：仅更新这三个直接相关声明；未更改首项历史 Ideal/Implementation/Deployment/证据。
- 在最终审查中给真实重复 Check 示例加入相同自包含 schema `$id`，执行确实暴露共享 Ajv 的跨制品 namespace 冲突。改为每份 subject/result schema 独立编译，未要求 Check 作者改名或改变结果契约；随后重新运行完整检查，而非把较早缓存结果当成新行为证明。
- 补充语言组合回归：只有中文的 occurrence 覆盖不得挡住英文从 Check-reference 覆盖继续继承。有效覆盖集合按当前语言计算，而不是按其他语言是否有配置判断。Host invocation failure 也保持其真实原因，不用业务 resultSchema 错误掩盖执行失败；这两项均增加定向测试。
- Coordinator 不把私有缓存的物理 Reference URL 作为不可变内容：持久化保留准确 `origin`，略去运行期 `resourceBase`。公开集成测试实际在第二个私有缓存准备同一制品并再次准入，仍为同一 ObjectiveRevision/Target；恢复时用重新准备的 PilotSpec 获取有效资源基准。
- 一次完整检查在原有 Host startup/crash 并发测试中报告 `ECONNREFUSED`；没有修改无关发现/恢复逻辑。原命令最小重试 `pnpm exec tsx --test --test-name-pattern "real startup" packages\check-host\test\discovery.test.ts` **1/1 通过**（early/claimed/published 三类 crash 均实际恢复），随后原样重跑 `pnpm check`。该间歇失败保留为限制，而不掩盖或跳过测试。
- pack 检查首次尝试从 registry 安装尚未发布的 `@potential-guide/check-artifacts`，明确 404。验证清单补入该运行支持库的本地 tarball/现有 overrides，使真实消费者验证完整依赖闭包；没有将它加入正式 releasePackages、创建 tag、发布 npm 或授权下一项 Release 工作。

## 当前限制与部署准备

本次交付本地 Objective 目录制品；其中 Check 支持本地或现有安全直接 HTTPS gzip tar。Objective 归档分发、正式 Release、全量内置迁移、离线全集导出不在此主体范围。未修改 accepted Ideal 或 Deployment seed。

候选版本通过 workspace/本地打包验证消费；正式发布 CLI 时需在后续交付工作中规划 Check 支持库的发布先后关系。本次本地 pack 回归不等于已发布或已完成独立消费者部署。

恢复依赖完整可验证的私有缓存或原准确来源；缓存损坏不修复、不隐式获取替代版本。原始绝对来源路径属于能力证据，跨机器源地址迁移需显式新运行；Host revision 可跨平台不同，不能假装为原执行。私有缓存仍受现有 Windows child bound 等限制，无自动淘汰承诺。

下一阶段须由主 Agent 接受准确 implementation revision 后，按 Deployment 在独立消费者环境验证 API/CLI/指导/regulation/恢复并记录外部证据。以上均为主体内真实执行与回归，不当作已完成 D 阶段或独立消费者部署证明。
