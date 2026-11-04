# Implementation

本次将已交付双 transport 服务收敛为 Gateway-only；旧 [Gateway 实施证据](Gateway-Evidence.md)
仅证明历史范围。当前要求见[配置边界](ideal/Configuration.md)，各项需重新证明。

## Steps

### I-S01: 定义服务设置与扩展入口

移除服务 RPC/transport 字段、flag、setting ID 和默认值，仅保留必需 Gateway URL；
沿用四层逐层校验、来源路径、禁用用户层与项目排除，明确拒绝旧输入并提示迁移。

### I-S02: 装配 Engine 与可选 UI 并迁移调用方

服务只装配标准 Gateway client，保留 CID 校验、流/DAG 预算、超时/取消和 HTTP/UI 边界；
更新 help、文档、示例、生成设置和直接消费脚本。保留程序化读取注入和作者写块/pin，
不以移除服务 RPC 为由改造作者工具或历史证据。

### I-S03: 验证发现配置与服务生命周期

验证两种入口 Gateway-only 执行、缺 URL/旧字段拒绝、四层与隔离规则、失败和退出；
执行相关构建测试、打包消费和 `pnpm check`，准确区分基线失败。

## Acceptance criteria

### I-AC01: 扩展入口与四层设置一致

以两种入口矩阵证明 Gateway URL 四层覆盖与路径正确；缺 URL 和启用来源中的旧 RPC/transport
输入即使被覆盖也在启动副作用前失败，禁用用户层仍不读取，项目服务值不参与。

### I-AC02: 装配保持本机访问与 HTTP 边界

以真实 HTTP 执行和完整性/限额失败证明唯一读取后端是 Gateway；
无 RPC 默认/分支/回退，程序化读取、作者导入、本机访问、UI 与资源清理回归通过。

### I-AC03: 入口文档与范围一致

以 help、设置生成、示例和独立打包消费证明不再宣传服务 RPC/transport，
保留明确迁移说明且不改写用户配置；记录当前 `pnpm check` 结果，不宣称基线全绿。
