# Task Engine 服务命令实施交接

## 当前候选

工作者已完成实现与相关验证，交主代理审查。
权威要求仍是 [Idea](ideal/Idea.md)、[Configuration](ideal/Configuration.md) 和
[Implementation](Implementation.md)；逐项结果及基线限制见 [Evidence](Evidence.md)。

- Idea：`01M6GRRES5EBHYDP1G9DZEGE8E`，`task-engine-server-config`，`zh-CN`。
- 原 Task Bundle 检查点 `8c817d434f81ed2aef3dd624d6ac8aeb226b8e56` 已保留。
- 已普通合并服务检查点 `6d9a6d6f471c42509ead3108108630b9d3425bf0`；
  merge commit 为 `c36bed4d`，生成的设置同时包含 Task Bundle 与 Task Engine。
- 未修改 Ideal、生命周期事件、其他 Idea；没有 npm 发布、primary 推送或门限决定。
- 当前 I 项记录工作者完成情况；D 项仍全部未开始。

## 主代理接续

1. 审查本候选、证据及基线失败，不把执行过全量命令理解为全量通过。
2. 由主代理刷新、整合并同步 primary；工作者没有代替主代理提交生命周期事件。
3. 由主代理在准确同步修订上决定是否提交 Inner 及门限决定。
4. Outer 的真实独立 Kubo、非敏感 Bundle 执行、外部消费及用户环境验证仍须另行开展；
   本次受控 RPC、独立 tarball 安装和 HTTP 测试不是 Outer 的替代品。

本文件替代旧的“换机器暂停”恢复步骤；旧进度保留在服务检查点的 Git 历史中。
