# 废弃已退役旧架构 npm 包

## 问题

Guide、Portfolio Supervisor 和旧 config 名称已经退出仓库，但历史 npm 包仍可能被误安装。当前设备无 npm 管理登录，需要在另一台已授权设备继续执行。

## 结果

为确认已发布的退役包设置准确的 npm deprecation 提示，保留历史版本可安装性，并让使用者知道迁移方向与限制。

## 边界

- 第一批仅含 `@potential-guide/objective-guide`、`@potential-guide/objective-portfolio-supervisor`、`@potential-guide/config`；config 必须先证明新名称有可安装的功能版本。
- Task Engine 系列是新架构，不废弃；仍被使用的 Check 文件层、Pilot/Regulator 业务库及共享 CLI 不扩大处理。
- 不 unpublish、不发布、不改变 dist-tag，不自动转换历史状态或删除源代码。

## 验收标准

- 已执行包的全部现存版本展示经审核的退役提示，外部证据可核对。
- 版本集合、dist-tag 与产物完整性未改变；config 前置未满足时保持阻塞而非误报完成。
- 未发布／未确认的旧名和仍有消费者的包未被批量操作。
