# Implementation evidence

## 架构边界

- `@potential-guide/cli-core` 只拥有 CLI 协议、配置、ACP client 和持久化工具，不复制 Objective 业务逻辑。
- 三个 Objective packages 分别拥有其 bins，并直接调用原有 public API。
- `pguide` 只拥有发现、协议检查、进程分派以及两个保留 built-ins。
- `pguide-config` 是可选外部 command，与所有运行时命令共享同一配置实现。

## 自动化证据

- `packages/pguide/test/cli.test.ts` 覆盖 package metadata/help、顶层 built-ins、Windows-compatible metachar 参数逐字分派、平台大小写去重语义，以及 scaffold/validate/probe 链路。
- `packages/objective-regulator/test/cli.test.ts` 使用本地 fixture ACP Agent，覆盖 initialize、session/new、prompt、session/update、action 后 re-probe、初始 probe/ACP timeout、原子 report、Guide 变化拒绝、失败 Attempt 收尾、脱敏快照和 still-satisfied continue。
- `packages/pguide-cli-core/test/config.test.ts` 覆盖 schema、transport secret literal 拒绝与普通参数无误报、完整 Guide/Reference/check/prerequisite tree revision、symlink 边界、retention 安全清理和原子显式配置加载。
- `packages/pguide-config/test/config-command.test.ts` 覆盖临时副本编辑、验证失败保留原文件与清理，以及 `show-agent` 不回显被拒绝的 secret。
- `scripts/check-packages.mjs` 对声明包执行真实 `pnpm pack --json` 并检查内容和 bins。

## 安全与已知边界

- profile 仅接受 ACP stdio，凭据只允许以环境变量名声明；Regulation snapshot 仅保存允许继承的名称，不保存值。
- state 和 transcript 原子创建为当前用户私有；Windows 依赖用户 profile ACL，POSIX 显式使用 `0700/0600`。
- 外部命令通过安全的跨平台 spawn 直接传递 argv；Windows `.cmd` shim 不使用 `shell: true`，信号和退出状态仍由顶层转发。
- 过期 Regulation 仅在规范化 state root 的 UUID 目录内清理，拒绝 root symlink 并跳过目录 symlink；公开输入/Guide/ACP/I/O 失败分别映射 2 或 6，未知内部错误保留 70。
- v1 persistence 是单进程调用模型，不提供 daemon 或多客户端并发写锁；这与已接受的 v1 非目标一致。
