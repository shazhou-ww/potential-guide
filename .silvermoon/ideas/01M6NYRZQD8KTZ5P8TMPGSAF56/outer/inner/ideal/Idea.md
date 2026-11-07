# 废弃已退役旧架构 npm 包

## 问题

Guide、Portfolio Supervisor 和旧 config 名称已经退出仓库，但历史 npm 包仍可能被误安装；原执行手册还包含已退役 CLI 的活跃性描述，需要按当前消费者重新核对。

## 结果

准备并按独立门禁执行准确的 npm deprecation 提示，保留历史版本可安装性；迁移说明反映当前入口，不把 Coordinator、Task Engine 或同名 binary 当作自动兼容替代。

## 边界

- 第一批仅含 `@potential-guide/objective-guide`、`@potential-guide/objective-portfolio-supervisor`、`@potential-guide/config`；config 必须先证明新名称有可安装的功能版本。
- Task Engine 系列是新架构，不废弃；仍被使用的 Check 文件层、Pilot/Regulator 业务库及共享 CLI 不扩大处理。
- 不 unpublish、不发布、不改变 dist-tag，不自动转换历史状态或删除源代码。

包清单与当前边界见[执行手册](../../Deprecation-runbook.md)；旧登录和 registry 查询仅代表历史观察，实际管理授权、版本集合及 config 功能版本须在部署时重新确认。本次合约刷新不执行 npm 管理操作。

## 验收标准

- 已执行包的全部现存版本展示经审核的退役提示，外部证据可核对。
- 版本集合、dist-tag 与产物完整性未改变；config 前置未满足时保持阻塞而非误报完成。
- 未发布／未确认的旧名和仍有消费者的包未被批量操作。
