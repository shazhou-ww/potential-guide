# 本地部署验证结果

## 固定版本与范围

2026-10-20，在 Windows、Node.js v24.12.0、pnpm 11.22.0 环境中，对已同步 primary 的提交 `3b78e69943fcbe5b44e89fc31cdee9bf77e1c6ee` 执行 `pnpm build`，12 个构建任务全部通过。验证开始时的部署树为 `8f6aa83aa5ddfda64260cd971e72745df0270c1f`；[Deployment.md](./Deployment.md) 的步骤与标准在验证前已同步，此次只补充结果与清单，不改实现或理想契约。

本阶段验证本地构建产物，不发布 npm，不运行真实 Agent 修复，不变更用户项目。隔离 Git fixture 与 subject 位于本次创建的临时目录，结束后删除。设置独立 `PGUIDE_STATE_DIRECTORY`，验证默认目录时不会污染用户真实状态目录。

## 实际执行与结论

验证程序顺序启动真实 CLI 子进程，并解析 stdout、JSONL 和 result 文件进行断言；成功完成的执行退出码为 0，10 组检查全部通过。下列 `<fixture>`、`<reports>` 和 `<config>` 是验证程序创建的绝对路径，不是用户项目。

| 场景 | 实际入口或操作 | 观察与结论 |
| --- | --- | --- |
| 默认目录与旧导出 | `node packages\pguide\dist\bin\probe.js --pilot <fixture>\objective\pilot.yaml --config <config> --format json --report <legacy.json>`，stdin 为 `{}` | 退出 0；默认路径为隔离 `stateRoot\reports\<runId>`；stdout 仅有一个 observation，与旧导出 JSON 深度相等。 |
| 配置、覆盖与隔离 | 配置 `reports.directory` 后连续执行两次 probe，再加 `--report-dir <override>` | 配置目录留下两个不同运行；覆盖运行仅写覆盖目录，不覆盖前两次历史。 |
| 禁用 | 分别设置 `reports.enabled:false`、传入 `--no-reports --report-dir <disabled>` | 均退出 0，禁用目录不存在；禁用证据时 `--report` 仍输出相同 observation。 |
| 内置独立检查 | `node packages\objective-pguide-self-check\checks\installation\run.cjs --report-dir <reports>`，subject 指向本次构建的真实 pguide CLI | 状态 200、`ok:true`；业务流保留 `version.observed`（实际版本 `0.4.0-rc.0`）及 `assertion.passed`；独占 scratch 清理为空。 |
| 业务不通过与 artifact | 将已提交 fixture check 改为输出 `not-ready`，发出 actual=2、expected=3 的断言，并保存安全摘要 | CLI 退出 0；check result 为状态 200、`ok:false`；业务流与 artifact 相互关联；artifact 内容为 `actual=2 expected=3`。 |
| 协议错误 | fixture check 输出 `invalid` 而非 envelope | CLI 退出 6；check result 状态 502、`payload:null`，message 含 `process-protocol`。 |
| 超时与清理 | fixture 写入 `step.started` 后等待；配置 `probe.timeoutMs:1000` | CLI 退出 6、状态 504；保留 `step.started`，无 `business.finished`；父运行保留失败 envelope；所属 probe 与 source 临时目录均为空。 |
| 强制中断 | 独立启动同一等待型 check，确认 `step.started` 已落盘后只终止该进程 PID | 根流只有 `run.started`、`check.started`；业务流只有 `business.started`、`step.started`；没有 result 文件或成功终止事件，必须识别为未完成。 |
| 安全、写入失败与截断 | 用固定构建的 `RunEvidence` / `CheckEvidence` 验证路径穿越、symlink、重复写入、文件型报告父目录及大体积 facts | 越界、symlink 与重复写入均拒绝；外部目录未写入；不可写报告路径显式抛出错误；业务流以 `evidence.truncated` 结束且 stderr 提示截断。 |
| 重试身份 | 同一个 `RunEvidence` 中对相同 check identity 实际调用两次 memory adapter | attempt 为 1、2；runId 相同，checkRunId 不同；两份 result 各自保留。 |

另验证带敏感字段的 subject：敏感字段值与未显式作为事实发出的私有字段都没有进入业务 JSONL。所有解析后的流验证 `schemaVersion:1`、ISO 时间及文件内连续递增 `seq`。这不代表通用 DLP：artifact 仍由作者明确选择安全内容。

## 证据索引

完整本地原始证据保留在本会话 `files\deployment-evidence-run-KCgiIc`，汇总为其中的 `summary.json`。验证程序位于同会话 `files\verify-evidence-deployment.mjs`；临时 fixture 已清理，重新执行会创建全新隔离目录与运行 ID。上述本地位置用于本机追查，不是跨设备可用的仓库引用；本节保留稳定的脱敏观察，仓库内补充 [Proof.json](./Proof.json) 供远程审阅。

| 场景目录 | runId | checkRunId |
| --- | --- | --- |
| `default-state\reports` | `37acb826-3c7b-464b-906a-662c5d668fbd` | `38632af4-e6fe-4116-aa0f-3f781b71f628` |
| `override` | `a86fca51-e792-493e-8060-d3328c2af978` | `be73e76a-78c7-4ed2-b996-ad4c8a350da0` |
| `standalone-installation` | `02654cd3-34c0-4abe-bfe7-1763d2e9a14c` | `f2d707a6-ffe8-44ad-9809-7be9c7d540d4` |
| `business-failure` | `10f9fd98-9649-4621-bf69-453d19d05d66` | `8246ccb2-d370-4ed2-be06-12b8e65949b2` |
| `protocol-failure` | `b54987ba-b79d-4994-9215-91291f0cbb00` | `771e5732-6701-4277-a3c7-97e7018b82d9` |
| `timeout` | `5f0d1d18-6f6c-44f3-8a63-19884b62527c` | `86ba6f6c-3945-4750-a209-56f075156948` |
| `hard-interruption` | `4145ec5e-7783-4312-b165-b206bba11a9f` | 见原始根流 `check.started` |
| `safety` | `f7714785-4315-453b-b9d1-124bcbed1709` | `60d7e11a-4a61-4af7-a889-03b327e50f27` |
| `retries` | `5f9c1b91-92a6-4c6a-b281-7626f2d23019` | attempt 1: `4accf50a-17af-4e8f-9960-cbb3c610f6fa`；attempt 2: `e509f519-ad6d-420e-8a5f-a78eb4596cf2` |

每个场景目录再进入 `<runId>`，根流为 `events.jsonl`，检查目录为 `checks\<checkRunId>`，业务流为其 `events.jsonl`，原始 envelope 为 `result.json`。artifact 使用相对引用 `artifacts/proof/summary.txt`。

## 验收对应与限制

- D-AC01：默认 probe、覆盖 probe、内置独立安装检查的流、原始结果与真实版本断言均可关联；业务不通过案例保留断言和 artifact。
- D-AC02：默认、配置、参数覆盖、两种禁用、旧导出、stdout 和历史隔离全部由真实子进程验证；超时后临时目录清理为空。
- D-AC03：协议错误、超时、硬中断、安全边界与显式截断均关联上述已同步提交。`run.finished` 仅表示父调用完成，状态 502/504 仍是失败；缺少业务终止记录绝不推断通过。

验证覆盖 Windows 本地构建，不声称在本阶段新做 Linux、Docker 或 SSH 远端部署，也不声称安装了新的全局 npm 版本。此前实现阶段完整 `pnpm check` 已通过，本阶段未修改仓库可执行代码。

验证脚本最初两次执行的问题仅在临时验证程序：等待型 fixture 未转交报告参数，以及并发读取尚为空的 JSONL。修正参数与就绪等待后，在新的隔离目录完整重跑 10 组通过；未将失败尝试当作部署成功证据，也未修改已验收实现。
