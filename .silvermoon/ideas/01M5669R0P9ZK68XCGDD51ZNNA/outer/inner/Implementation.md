# Implementation

本轮改为优先交付独立本机自查，分级及检查职责见 [分级与检查说明](./ideal/Levels-and-checks.md)。以下为准备阶段的高层实现计划，尚未执行；远程整备接入独立自查留作后续工作。

可复用现有 setup 检查和隔离 fixture，不复制另一套就绪逻辑。此前结果见 [历史实现证据](./Verification.md) 和 [目标设备修订验证](./Target-revision.md)，均不证明新独立自查已经通过。

## Steps

### I-S01: 定义独立本机自查

建立独立的本机自查 Pilot、仅本机 subject 和使用指引，明确各级检查及缺少 pguide 时的外部 bootstrap 边界。

### I-S02: 复用检查并打通真实闭环

从现有实现复用安装、配置、ACP 和隔离任务验证，保留旧 setup/bootstrap 兼容行为；解决自查及内层任务的预算与清理，不引入递归自查。

### I-S03: 验证并接入仓库检查

将独立自查和现有 setup 回归纳入默认检查，并在明确授权后使用本机已安装的 pguide 和真实 ACP Agent 验证完整自查。

## Acceptance criteria

### I-AC01: 独立自查可加载

Pilot 加载与分级测试证明 initial、installed、configured 和隐式 terminal 的行为符合说明；本机 subject 不依赖 SSH，文档说明外部 bootstrap 入口。

### I-AC02: 自查不误报就绪

自动测试覆盖缺安装、错配置、ACP 失败、未授权、假修复、超时和清理；只有真实任务及独立复查成功才能 terminal，旧 setup 回归保持通过。

### I-AC03: 自动及真实验证通过

pnpm check 通过，并有本机已安装 pguide 运行独立自查达到 terminal 的已授权真实证据；若 Agent 或模型不可用，明确保留阻塞，不用测试替身替代。
