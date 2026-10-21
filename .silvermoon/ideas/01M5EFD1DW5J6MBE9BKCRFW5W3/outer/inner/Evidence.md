# 实现证据

## 契约与消费面

- 协议：`packages/pilot-protocol/src/definition.ts` 的 `resolveLevelId`、`levelRank`、`attainedLevelRank` 统一目标别名与真实达成证据；`describeLevels` 仅列出内置 initial 与业务 ID。
- 结构：新增 `schemas/objective/v2.json` 与离线副本，保留已发布 objective/v1.json 和 objectives/v1.json；解析拒绝 initial/terminal 声明、空业务层级和旧 Manifest。
- 观察：`packages/objective-pilot/src/pilot.ts` 累计维护已达 ID，失败问题仍指向未达层；异常没有可信 current。`checkObjectiveLevel` 的 initial 路径校验契约和 subject，不解析业务 check，也支持同一 subject 的内置 initial 依赖。
- 依赖与调节：`dependency.ts`、Regulator、Coordinator、Portfolio/Planner 使用同一 rank；可信 current 不接受 terminal 别名，内部问题校验下一未达层。Regulator 的 initial 目标零 Agent 调用；CLI 无需配置 Agent，仍创建正常持久 Regulation/attempt。
- 工具：scaffold 默认声明业务 ready，拒绝保留 ID；CLI 以实际最高业务 ID 判定完成，Planner 提示列出真实层级并单独解释 terminalAlias。未删除、合并命令或简化 continue、权限、quota、停止和 Coordinator 生命周期。

## 显式迁移

`objective-contract-migrate --format manifest` 对旧数字契约和 schema-identified v1 均要求 `--attainment-levels`，逐组指定已审核的达成 ID；保留检查顺序和 subject schema，非覆盖地写入新文件。引用页面及目标仍需独立审核。

Portfolio 输入与 Regulation 恢复记录使用 schemaVersion 4；旧输入（包括未固定版本、仍拼作 terminal 的目标）明确拒绝。旧 commit/tree/repositoryTree 和观察不被替换或重新绑定，须在已迁移并提交的 Objective 上重新观察。新的直接目标请求明确选择新 Objective；terminal 仅解析其实际最高层级。

| 自有 Objective | 业务层级（不含协议 initial） | terminal 的实际目标 |
| --- | --- | --- |
| setup / self-check | installed → configured → verified | verified |
| devbox-health | managed → system-ready → development-ready → orderly → sustainable | sustainable |
| monorepo 根 / package-standard | structured → standardized | standardized |
| sanity fixture | repaired | repaired |

相应 scoped references、生成脚本、独立 runtimes、消费验证脚本及直接相关 README 已迁移；说明入口为 `docs/objective-contracts.md`。既有 `levelRank`、来源固定验证、非覆盖迁移 CLI 和生成物检查是采用的代码先例，共享规则下沉到协议而非复制多套排序。

## 验证记录

- 核心命令：`pnpm exec tsx --test packages\pilot-protocol\test\*.test.ts packages\objective-pilot\test\*.test.ts packages\objective-regulator\test\*.test.ts packages\objective-portfolio-supervisor\test\*.test.ts packages\regulation-coordinator\test\*.test.ts`：178 项通过、0 失败。包含达成矩阵、initial 不执行、异常、旧契约、别名 rank、来源固定、依赖与可信进度回归。
- `pnpm typecheck`：21 workspace 成功，根测试类型检查成功。
- CLI 完整轮次：110 项，105 通过、4 失败、1 跳过。三项本次迁移引发的测试契约偏差已修正（scaffold 文案、直接 check ref、Windows 测试脚本 shebang），以单一 runner 复测这三项全部通过；另一个跨进程 Planner 反馈超时为已确认基线问题。
- 早期 monorepo 独立轮次的两个失败来自本操作根目录日志被文件分类检查发现，以及并行重生成时读取独立 runtime 的竞态；日志已归入忽略的 `.cache`，重生成与后续消费测试不再并行。它们不被当成基线豁免。
- 最终完整 `pnpm check`：退出 0。layers、Biome format/lint、21 workspace 类型检查及根测试类型检查、schema/runtime 新鲜度、所有 workspace 测试、脚本测试、build 与 pack:check 均通过。pguide 110 项中 109 通过、0 失败、1 跳过（约 844.65 秒）；monorepo-standard 49/49、setup 35/35 通过。
- 清理执行环境偏差后，真实仓库 monorepo 定向复测 2/2 通过，覆盖实际 Regulation 依赖交接、修复与消费者重新观察。脚本测试独立复测 36/36 通过。
- pack:check 的 protocol、main、pilot、regulation、supervision、coordinator、objectives、config、agents、combined 十组隔离 tarball 消费均通过；包括新 v2 schema 导出和显式迁移入口。这是仓库验证，不代替 Deployment 的固定版本真实环境验收。
- `git diff --exit-code` 确认已接受 Idea、Deployment seed、canonical 与离线的 objective/v1.json、objectives/v1.json 均无内容变更。

## 已知非阻断问题与外部边界

实施前完整校验已经确认两项无关基线：`packages/pguide/test/execution-output.test.ts` 的空 capabilities 行预期偏差，以及 `packages/pguide/test/supervisor-cli.test.ts` 的 “Planner did not acknowledge capability feedback.” 跨进程超时。后者在早期并行 CLI 轮次复现；两者在最终完整 pnpm check 均未复现。本阶段没有顺带修复这些间歇性问题，亦不将单轮成功当成其根因已解决。

独立 bundle 生成仍报告既有 CJS `import.meta` 警告；本次不改无关模块格式。没有 npm 发布、schema Pages 部署、外部设备或生产验收；Deployment seed 与已接受 Idea 保持不变。
