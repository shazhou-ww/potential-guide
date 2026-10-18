# 建立设备级 pguide setup Objective

## 问题

安装命令成功或配置文件存在不能证明设备能够实际运行 pguide。首次接入缺少统一的观测、修复指引和端到端验收，也容易陷入先配置 pguide 才能执行 setup 的循环。

## 结果

在本仓库提供可通过 Git 子目录引用的 setup Objective，指导当前用户完成安装、Agent 配置和隔离的真实 sanity check，只有经过观测确认可用才达到 terminal。

## 边界

- MVP 针对当前设备、当前用户；不新增 pguide setup 命令，不进行本机全局安装或 npm 发布。
- 优先复用执行 setup 的 Agent 的可用 ACP 入口和已有认证；没有 ACP 入口时明确说明，不复制秘密或自动申请付费资源。
- 检查不擅自修复设备；sanity check 仅在明确允许时使用有界额度和隔离目录，不修改真实项目。

## 验收标准

- manifest、检查程序及指引在仓库子目录中独立可用，未安装时也有外部 Agent 可执行的 bootstrap 指引。
- 缺少安装、错误配置、不可用 ACP 和未通过 sanity 均可观察为明确问题，不能只凭 help 或 Agent 自报成功判为就绪。
- 通过已配置的 Agent 完成隔离的 detect-repair-recheck，确认正确结果并清理资源；自动测试和实际 Git 子目录加载验证通过。
