# 实施验证与门禁检查

用户本轮明确委托主 Agent 对各阶段进行检查和批准。subsession 实现检查逻辑；
主 Agent 负责实际 Docker 场景、门禁证据和需求一致性，不把子会话的完成声明当作验收。

## 已执行的仓库检查

在核心实现及具体 gap 诊断修正后执行：

- `pnpm format:check`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm --filter pguide exec tsx --test test\development-health-objective.test.ts`：首次 14/14 通过；补充依赖一致性检查后 15/15 通过。
- `pnpm pack:check`：通过，包含全部 workspace 构建和打包约束。

针对性回归验证规范与中文 Wiki 完整、每次观测从首层开始且每组只执行一次、直接 helper
与 Pilot 的严格输入一致、数值版本／阈值临界值、sudo 授权解析、历史身份及新鲜度、
有界的错误样本诊断、apt 索引刷新证据、任务生命周期及路径边界、进程执行／输出限额。

## Docker 扩展检查发现并修复的缺口

首轮真实 CLI 矩阵 27/27 通过。扩展“待更新软件包”场景时，测试驱动把 base-files
版本元数据降到 0.0.1，实际制造了依赖损坏而非单纯的可升级状态；`dpkg --audit`
仍成功，但升级模拟返回 100。这暴露了系统层缺少依赖关系检查的真实缺口。

修复包括：区分 ninja-build 的兼容旧版本（仅待升级）与 base-files 的不满足依赖状态；
系统层增加只读 apt 模拟 check，禁用锁及两个缓存文件写入，将语义上的依赖损坏报告为
`package-database-unhealthy`，而不是假健康或泛化为调用失败。子会话的实际 Docker
烟测验证了该 gap，且 apt 配置、缓存和状态目录没有被检查修改；主 Agent 的最终矩阵
同时覆盖这两种不同状态。

## 全库检查的既有失败

首次 `pnpm check` 已执行，格式、lint、类型检查通过，但既有
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

## 最终实施 Docker 验证

执行 `node scripts\verify-development-health.mjs --report .cache\development-health-docker-implementation.json`，
从 2026-10-19T06:04:00.833Z 到 06:16:46.916Z，33/33 场景通过，
`passed: true`、`cleaned: true`，Docker Server 为 29.8.2。
[原始收据](./Docker-verification.json)保留每个场景的实际观测和故障参数。

代码版本为 `0420ecf50e9e09dd883394b8230235c35d378b41`。一次固定 Git 绑定贯穿
真实 Pilot API 观测，但每组 check 都启动独立进程访问实际容器；健康场景另行通过
真实 CLI，并断言 API／CLI 层级和版本相同。所有场景均执行，没有把失败替换为跳过。

33 个场景包含正常四栈、无历史、传输失败不回退、非法输入、root 和环境类别不符、
目录／sudo 的故障与恢复、真实 tmpfs 容量／inode 不足、HTTP 故障、包数据库损坏、
最低版本不符、四栈分别缺工具、编译器存在但不能构建、目录重叠、非法任务登记、
已知残留／孤儿／超期／结束后仍存活的任务、正常任务及未提交工作保护、外来／过期
历史、实际缓存／日志增长与恢复、过期包索引、仅待升级与依赖关系损坏两种状态，
以及健康后重新引入故障的降级。每个故障检查层级、问题 ID 和非空参数；
容量、inode、目录、工具和增长等场景还断言具体对象与阈值证据。

主 Agent 据以上证据确认本次实施标准成立，包含已披露的 I-AC03 基线例外；
最终交付仍需在部署阶段按同一标准重新运行 Docker 验证，不将实施通过替代部署收据。
