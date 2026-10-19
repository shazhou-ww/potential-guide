# 实施验证与门禁检查

用户本轮明确委托主 Agent 对各阶段进行检查和批准。subsession 实现检查逻辑；
主 Agent 负责实际 Docker 场景、门禁证据和需求一致性，不把子会话的完成声明当作验收。

## 已执行的仓库检查

在核心实现及具体 gap 诊断修正后执行：

- `pnpm format:check`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm --filter pguide exec tsx --test test\development-health-objective.test.ts`：14/14 通过。
- `pnpm pack:check`：通过，包含全部 workspace 构建和打包约束。

针对性回归验证规范与中文 Wiki 完整、每次观测从首层开始且每组只执行一次、直接 helper
与 Pilot 的严格输入一致、数值版本／阈值临界值、sudo 授权解析、历史身份及新鲜度、
有界的错误样本诊断、apt 索引刷新证据、任务生命周期及路径边界、进程执行／输出限额。

## 全库检查的既有失败

`pnpm check` 已执行，格式、lint、类型检查通过，但既有
`packages/pguide/test/setup-objective.test.ts` 的六个 sanity 相关测试失败，
共同现象为 `protocol: independent sanity probe failed.`，并非本次健康 Pilot 回归失败。
不将该次命令报告为全库通过，也不在本次范围修复无关 setup 实现。

为了区分本次引入的问题，主 Agent 单独重跑
`real sanity verifies a finite repair`，仍得到 `502 !== 200`。随后从本次健康实现前的
`d35db75` 提取 setup Objective、该测试及 fixtures，在临时目录重跑同一测试，
得到相同的协议错误和 `502 !== 200`；[原始结果](./Baseline-check.json)保存命令输出。
该复现复用现有依赖及编译后的 CLI，相关 CLI／Pilot／setup 源码相对基线没有变化，
不是重新安装依赖的独立干净构建，不能据此声称全部既有失败已逐项定位。

上述例外已明确写入 [I-AC03](./Implementation.md)，不放宽本次 Docker gap 检出的交付标准。
