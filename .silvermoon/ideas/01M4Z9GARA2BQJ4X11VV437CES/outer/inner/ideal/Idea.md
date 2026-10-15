# 建立可扩展的 Potential Guide CLI

## 问题

Potential Guide 的各软件包目前只能作为库集成，缺少统一、可发现的命令行入口，也没有让各包独立提供命令并被顶层命令组合调用的稳定约定。

## 结果

用户既能直接运行每个软件包拥有的 CLI，也能通过一个 Potential Guide 顶层命令发现并调用这些子命令；Objective Regulator 可以据此驱动指定 Agent 完成一次有边界的 regulation。具体命令与协议见 [CLI 方案](./CLI-proposal.md)。

## 边界

- 顶层命令采用类似 Git 的扩展模型，包拥有自己的命令实现和生命周期，顶层 CLI 不吸收各包的业务逻辑。
- 子命令发现、参数转发、退出码和结构化输出形成稳定契约，并明确可信命令来源，避免意外执行同名程序。
- unscoped npm 包和 canonical 命令统一使用 `pguide`，支持直接运行 `npx pguide`；不采用已被占用的 `potential`，也不提供容易与 POSIX pager 和 PostgreSQL 生态混淆的 `pg`。

## 验收标准

- 安装后的顶层 CLI 能列出并调用内置或包提供的子命令，且同一子命令可通过其独立可执行文件直接运行。
- `probe` 能执行一次无副作用 observation，`regulate` 能通过可替换 Agent adapter 执行有界 regulation，并提供创建及验证 Objective Guide 骨架的辅助命令。
- 命令命名、发现优先级、输入输出和失败语义在 Windows、macOS 与 Linux 上具有可测试且一致的行为。
