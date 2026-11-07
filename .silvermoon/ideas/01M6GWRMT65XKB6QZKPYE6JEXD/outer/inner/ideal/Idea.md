# 离线构建类型安全的 Task Bundle 与 CAR

## 问题

TypeBox 作者输入、离线 CLI 与 CAR 产出已经落地，但本 IDEA 仍要求已移除的内置 publish，
并以旧生成入口和 Kubo 验证描述当前交付，无法准确指导后续复核。

## 结果

以 `task.build.yaml`、TypeBox 契约模块及显式 SDK 入口离线生成完整成品目录和 CAR，
通过独立扩展的 init/check/build 交付可复现作者流程；当前边界见[作者流程](Authoring.md)。

## 边界

1. 构建规则可用通配符，成品声明生成精确 include/binary 清单；不维护第二份顶层 `task.yaml`，不提供独立 include 命令。默认文本按 UTF-8/LF 规范化，显式 binary 保留原字节。
2. TypeBox 类型与生成 Schema 同源；构建检查离线契约闭包并绑定声明，SDK 只负责 Worker 运行时，Engine 承担业务数据接纳校验，不恢复自动 Worker validator。
3. init/check/build 均不上传、pin、启动 Engine 或发布 npm；工具输出 CAR，外部工具负责导入及交付。服务启动和 Web UI 不在本 IDEA 内。

## 验收标准

1. init 生成显式启动 SDK 的最小作者项目；声明、Worker、共享 Schema 和精确清单同源生成，类型与宿主实际校验可对照验证。
2. clean 目录与 CAR 来自同一规范化快照；缺失、额外文件、错误 CID、非法文本和不支持 Schema 明确失败，失败不破坏旧输出。
3. pguide 发现与独立 binary 均支持 init/check/build；仅凭 CAR 可独立校验并由 Engine 实际执行，执行环境不依赖作者源码或构建工具，上传另行处理。
