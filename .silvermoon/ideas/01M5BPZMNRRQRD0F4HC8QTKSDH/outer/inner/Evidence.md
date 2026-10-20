# 实现证据

## 验证环境与命令

2026-10-20，Windows，Node.js v24.12.0，pnpm 11.22.0。本阶段在当前候选上执行 `pnpm check`，退出码为 0；完整命令包含格式、lint、类型检查、生成 runtime 新鲜度、工作区与根脚本测试，以及八个发布包的构建和打包检查。没有执行 npm 发布。

独立针对性命令：

```text
pnpm exec tsx --test packages\objective-pilot\test\evidence.test.ts packages\objective-pilot\test\probes.test.ts packages\pguide-cli-core\test\config.test.ts packages\pguide\test\evidence-cli.test.ts
node --test scripts\evidence-runtime.test.mjs
```

第一组 31 项测试通过；独立 runtime 组 6 项通过。随后完整检查中的 objective-pilot 34 项、cli-core 82 项、setup/self-check 35 项及根脚本 32 项全部通过；pguide 为 65 项通过、2 项平台相关跳过、0 项失败。各测试创建的指定证据目录由测试显式清理，不代表产品自动清理历史报告。

## 验收对应

| 稳定 ID | 实现与可重复证明 |
| --- | --- |
| I-AC01 | `packages/objective-pilot/test/evidence.test.ts` 验证 UUID 隔离、重复调用的 attempt、文件内 seq、时间、根流与业务流关联、原始业务失败 envelope 及相对 artifact 引用。`packages/pguide/test/evidence-cli.test.ts` 实际运行 scaffold 和 CLI，核对 observation 与 stdout。 |
| I-AC02 | 同一组测试覆盖异常、取消、无终止记录、写入失败、显式截断、敏感字段及敏感 subject 值脱敏、不留存其他 subject 字段、artifact 路径穿越、重复写入及 symlink 越界。CLI 测试核对旧 `--report` 导出与 stdout 相同，并覆盖禁用及不可写目的地。 |
| I-AC03 | `scripts/evidence-runtime.test.mjs` 覆盖 monorepo、health、setup、自查源入口和生成 transport runtime 的实际独立调用。既有 setup/self-check 35 项测试在保留 scratch、用户文件、认证边界与进程清理断言的同时验证独立证据终止。完整 `pnpm check` 包括全部生成与打包检查。 |

## 关键边界

- 默认目录为 `stateRoot/reports/<runId>`；probe 的目录优先级为 `--report-dir`、`reports.directory`、默认目录。配置逐字段合并，禁用不影响旧导出。独立检查仅使用显式参数及默认状态目录，不加载 CLI 配置。
- 根流由 runtime 单写，业务流由 check 单写。根流保留 observation、调用身份与 attempt，check 目录保留经脱敏和边界处理的 envelope、业务 JSONL 及显式创建的 artifact。
- 状态 200 且 `ok:false` 是业务不通过，不是执行失败；`payload:null` 表示调用失败。`run.finished` 只证明运行完成，必须继续查看 envelope；没有终止记录不可推断成功。
- 不自动复制 subject、环境、命令参数、stderr 或 Agent 对话。JSONL 与 result 约束约 1 MiB，长文本与深结构显式标记截断；artifact 拒绝超过 1 MiB 的内容。artifact 内容必须由作者明确选择安全事实，不是通用秘密扫描器。
- 生成自查代码调整 evidence import 的相对位置；setup 的独立 wrapper 区分内置 stage 与命令行 stage，确保报告参数不被丢弃。测试使用独立报告路径保留旧清理断言，并为 Windows 深层 Git fixture 使用较短的临时根路径。

## 复核入口

- [共享证据实现](../../../../../packages/objective-pilot/src/evidence.ts)
- [probe 适配器](../../../../../packages/objective-pilot/src/probes.ts)
- [CLI 组合与清理边界](../../../../../packages/pguide/src/pilot-source.ts)
- [CLI 文档](../../../../../packages/pguide/README.md#local-check-and-probe-evidence)
- [证据 API 文档](../../../../../packages/objective-pilot/README.md#local-evidence)
