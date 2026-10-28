# 将内置 Check 与 Objective 迁移到 Release 制品交付

## 问题

仅增加新制品 API，仍会留下内置 Objective 的 npm 发布要求、旧脚手架和消费声明。用户需要一条不依赖业务包 registry 的真实获取与运行路径。

## 结果

内置 Check 和 Objective 使用新制品模型，通过 GitHub Release assets 交付；使用者只安装工具即可获取准确制品并完成检查，源码仓库不保存生成 bundle。

## 边界

- 依赖 [Check 制品](../../../../01M607T630T6DSDZYTYA52ED6J/outer/inner/ideal/Idea.md)、[Objective 组合](../../../../01M607XBNKWQDZAC6EPTZ474NH/outer/inner/ideal/Idea.md)及 [Check Host v2](../../../../01M60XR4JGPZN2SSJ12WTMJ97G/outer/inner/ideal/Idea.md)；在 v2 就绪后按其制品管理与观察任务入口交付，不重新设计这些协议。
- CLI、Pilot 引擎和 Host 等工具可继续通过 npm 发布；退出的是业务 Check/Objective 的 npm 发布要求。
- 提供旧来源的兼容或明确退出说明，不改写历史证据；不建设 registry、镜像或签名平台。

## 验收标准

- 内置内容、消费声明和脚手架均可生成并消费新制品，无业务包 npm 安装前提。
- CI 发布的真实 Release assets 可在干净消费者环境下载、校验和执行。
- 文档及发布入口一致，失败不宣称发布成功，历史证据保持原语义。

迁移取舍与交付原则见[设计说明](./design-rationale.md)。
