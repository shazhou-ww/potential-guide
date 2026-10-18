# Implementation

此前本机版验证见 [历史实现证据](./Verification.md)。本轮修订增加控制端/目标设备边界及真实 ACP 兼容，旧证据不作为新要求已满足的证明。

本轮结果与真实模型访问阻塞见 [目标设备修订验证](./Target-revision.md)。

## Steps

### I-S01: 定义设备就绪观测与引导

修订 setup Pilot、subject 和文档：本地 bootstrap 与 SSH 目标检查分开，目标缺少运行环境时明确说明由控制端 Agent 完成准入。

### I-S02: 实现有界检查与真实 sanity

统一正式 ACP 客户端与 setup 的数字版本序列化；远端检查必须在目标用户环境中执行，有界连接、输出、清理和身份证据。

### I-S03: 验证并接入仓库检查

新增严格协议和 SSH 通道回归，pnpm check 通过；按授权配置本机持久入口和真实 Copilot，不复制认证。

## Acceptance criteria

### I-AC01: 定义可加载且指引完整

Pilot 校验通过，文档明确控制端指挥、目标侧验证，不把未知远端当成 localhost；旧本地 subject 行为有明确兼容方案。

### I-AC02: 就绪必须有实际证据

严格 ACP 测试证明数字 wire 版本；远端失败、拒绝授权及目标结果转发有测试，不信任本机替代证据。

### I-AC03: 仓库行为保持一致

pnpm check 通过，新增测试纳入默认入口，本机正式配置经真实 Copilot initialize、session 和隔离 sanity 验证。
