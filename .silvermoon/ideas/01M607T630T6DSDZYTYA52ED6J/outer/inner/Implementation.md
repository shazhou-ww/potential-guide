# Implementation

## Steps

### I-S01: 明确 Check 制品契约

交付 `@potential-guide/check-artifacts` 的 `pguide-check-v1` 契约：`check.json` 声明稳定 Check/problem 身份、现有 Host 协议、自包含 subject/result JSON Schema、显式 resources、Check/problem References 及辅助 References。文件闭包、大小写/NFC/Windows 路径和限额由准备层验证。详见[制品格式与 API](../../../../../packages/check-artifacts/README.md)。

### I-S02: 打通构建与准备执行

通过独立 `/build` 导出显式使用 esbuild 和 node-tar 构建/打包；`prepareCheckArtifact` 支持准确逻辑 digest 的本地目录及同时固定传输 digest 的直接 HTTPS gzip tar。使用 Node TLS/gzip、node-tar、Ajv 和现有 Host 的私有目录、受保护 manifest 写入及完整 no-follow 内容读取，不运行安装、构建或生命周期脚本。缓存按 digest 原子发布、逐次复核、拒绝修复/覆盖；只将 worker/resources 的规范目录与 Host revision 交给 Host。

### I-S03: 补齐验证与开发说明

以真实 file-content Check 捆绑 Ajv，交付 expected 资源与完整 Check/problem References；覆盖本地及真实 localhost HTTPS、离线复用、错误/缺失/越界/链接/篡改与取消清理。更新作者/消费者说明与 Host 边界链接，执行最小相关测试及项目要求的 `pnpm check`。实际命令和结果见[验证证据](./verification.md)。

## Acceptance criteria

### I-AC01: 独立制品可执行

集成测试从 Git 源码显式构建/打包，在没有 Check node_modules 的私有消费目录中通过 Host 执行正确与错误文件内容，验证捆绑 Ajv、资源字节与全部 References；真实 TLS 子进程验证 HTTPS 准备与离线复用。验证证据索引到对应测试和实际结果。

### I-AC02: 内容与提取边界可验证

测试覆盖逻辑/传输摘要分别不符、缺失/未声明内容、路径穿越及平台歧义、软/硬链接、重复/冲突项、压缩/展开/文件/路径限额、截断和嵌套压缩。并发准备保持同一缓存，损坏缓存拒绝且不覆盖；References 变化改变逻辑 digest 而不改变相同执行内容的 Host revision。

### I-AC03: Host 语义保持一致

Host 不增加渠道、manifest 或 Objective 语义。经制品准备的 worker 保留业务结果、协作取消、deadline 触发取消和确认后的清理；既有 Host 完整测试及构建、lint、类型、项目 `pnpm check` 通过。外部消费者部署与正式 Release 均不在本实现 gate 中宣称完成。

## 契约边界

- 逻辑摘要为 `sha256-pguide-check-v1:`，覆盖域分隔符、排序文件路径/长度及 manifest、worker、resources、References 全部原始字节；执行位由 manifest 的 portable 声明固定，物理 mode、tar header 和压缩不参与。
- 传输摘要为 gzip tar 原始字节的 `sha256:`；Host revision 保持现有算法，只覆盖执行树全部字节及本平台的物理执行位。不得相互替代。
- 默认 TLS 验证、拒绝自动重定向/内嵌凭据/片段，不继承 registry 认证；可信调用方负责源授权和可信 digest。digest 不是身份认证，Node worker 不是沙箱。
- 输出在忽略的 `dist/` 或项目本地 `.cache/`；Git 保留源码、原始 References/资源、显式 build 配置和锁文件。Objective 组合/继承覆盖、内置迁移和正式 Release 留给后续 idea；Deployment seed 不变。
