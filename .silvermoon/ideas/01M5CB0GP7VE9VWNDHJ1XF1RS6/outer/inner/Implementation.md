# Implementation

## Steps

### I-S01: 确定命令归属与协议分层

按[三层与包归属](./ideal/Package-layering.md)盘点全部工作区包、七个待拆命令、已有 config 和共享代码，仅使用由高到低的工具层、业务逻辑层、协议层。保留 effects 协议核心原语，将 Pilot 定义规范、schema 和相应校验与业务观察执行分开；运行环境组装归工具层。git-source 与四个具体 Objective 显式列为三层之外的待外迁包，本轮暂留，不新增其他层，也不执行外迁。

实际归属以 `config/package-layers.json` 为机器检查入口。新增 `pilot-protocol` 保存唯一的 Pilot 定义实现；`objective-declarations` 仅依赖 CLI 基础设施和协议，共享选择与绑定；`cli-runtime` 组装来源与观察运行时，不依赖命令包或调节执行包。具体边界和迁移理由见[实施证据](./Package-split-evidence.md)。

### I-S02: 拆分包并贯通分发与安装

先在当前仓库完成命令拆包及必要的协议职责提取，紧密协作命令可共包并说明理由。迁移入口和共享能力，更新工作区、构建、发布及迁移文档，避免共享模块重新引入全部业务依赖；增加自动分层检查，覆盖包清单及源码导入，包括类型导入和跨包源码引用。允许同层依赖，阻止下层引用上层，不以移动目录替代约束。

命令分为 `pguide-pilot`（probe/scaffold/validate）、`pguide-regulate`（regulate/continue）、`pguide-supervise`（supervise）和 `pguide-objectives`（objectives），保留已有可选 `config`。主包仅发布 `pguide`，生产依赖只有 `cli-core` 和 `cross-spawn`；组合安装由消费者显式选择命令包。各包继续使用独立版本、统一命令协议和原有二进制名称。

### I-S03: 验证分层、协议与命令兼容

补充分层检查的正反例、协议独立消费及校验回归测试，证明上层依赖下层和同层依赖允许、反向依赖被拒绝。验证按需安装、缺失与冲突诊断、两种入口及 Windows 与 POSIX 分发，并执行仓库要求的检查。

验证入口包括 `scripts/check-layers.test.mjs`、协议独立测试、迁移后的 CLI 集成测试和 `pnpm pack:check` 中八种离线 tarball 消费组合。现有 Ubuntu/macOS/Windows 分发 CI 保持覆盖；本机执行的平台、跳过项、完整检查及打包结果记录在[实施证据](./Package-split-evidence.md)，不把尚未执行的远端 CI 或 npm 发布视为完成。

## Acceptance criteria

### I-AC01: 包边界与协议独立性可核验

全部业务命令有明确归属；通过包清单、构建产物和依赖图证明主包不再强制安装全部业务能力。effects 保留为协议核心原语；Pilot 定义规范、schema 和相应校验的公开接口及测试证明，消费协议不要求引入上层观察、调节和 CLI 实现。

### I-AC02: 命令兼容性有回归证据

通过现有及新增测试证明两种入口的参数、输出协议、退出码和缺失或冲突诊断符合约定，覆盖最小安装与组合安装。

### I-AC03: 分层约束自动执行且文档一致

全部工作区包明确属于三层之一或显式待外迁清单，未知归属报错；分层检查接入 pnpm check，以正反例证明跨层单向依赖和同层依赖规则，类型导入、重导出或跨包源码路径不能绕过检查。待外迁包不被当作第四层，不以清单豁免三层内的反向依赖。pnpm check、包构建及打包检查通过；分层、安装、迁移和包级发布文档与实际清单一致，明确本轮不外迁，并记录验证结果。
