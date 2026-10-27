# Portfolio Supervisor 退役边界

本文支撑 [Idea](./Idea.md)。这是用户在周期请求三阶段验收完成后追加的需求，沿用同一 Idea，不删除旧验收事件、不追认新增内容已经通过验收。

## 退役结果

删除业务包 @potential-guide/objective-portfolio-supervisor，以及旧 CLI 包 @potential-guide/pguide-supervise。旧 pguide supervise 和 pguide-supervise 不再作为当前仓库交付的命令、可发现扩展、公共导出或可发布包。

这里选择退役旧入口，而非将其悄悄改接到 Coordinator。旧 Planner 的自动策略、权限交互与配置并不等价于固定时间的不可变请求；不保留空包、改名后的 Supervisor 或未经定义的新上层 Agent 来维持原体系。

外部上层调用者使用 Coordinator 公共 API，调用单次治理仍可使用既有 Regulator / regulate 能力。本轮不增加 Coordinator CLI 或 MCP server，也不撤销已发布 npm 版本、操作注册表 deprecate 或发布新版本。

## 可复用能力先迁移，业务监督器再移除

当前依赖调查表明，Coordinator 新旧运行时仍借用 canonicalJson、levelRank、validateGoal、资源能力匹配及 runner / resource 类型。应按职责将仍必要的能力放到现有合适包或 Coordinator 内部，优先使用已有协议能力；不能复制整个 Portfolio Planner，也不能为了保留旧导入再制造一个新抽象层。

迁移须保留以下已交付行为：

- 不改变已有 Objective / Target 身份、持久化键、源版本绑定及事件事实；尤其不能顺手改变 JSON 规范化顺序而使历史快照失效。
- 一次性与周期请求、后继唯一性、Target 互斥、依赖续接、实际退出确认和耗尽上报保持一致。
- Coordinator 的 legacy 五命令 API 不因移除 Portfolio 包而被顺带删除；删除的是 Portfolio 的 Planner / Coordinator 和 supervise 产品入口。
- 原错误分类、输入校验和公共类型需要有明确迁移归属，不能用 any、宽泛捕获或静默接受非法输入掩盖变化。

## 完整清理的范围

包目录和导入之外，还须检查生产与开发依赖、workspace lockfile、TypeScript 项目引用、package 层级、CLI 发现 / 补全 / settings、包消费者验证、Objective 工具与 fixtures、release 包清单、tag workflow 和当前使用文档。

删除的旧命令测试应改为验证真实退役行为，或保留仍适用的能力覆盖；不能仅删除失败断言来获得绿灯。保留 Pilot、Regulator 和 Coordinator 的现有功能，退役带来的可见行为变化须明确写入迁移说明。

历史 Idea、旧构想及已执行部署证据可以保留旧包名和记录，以证明当时状态；不回写成当时已移除。不允许在活跃依赖、发布目录或安装指引中留下仍推荐使用已删除包的内容。

## 新增验证要求

仓库检查证明两包不再属于当前 workspace 或可发布包，所有活跃生产导入均已迁移。pnpm check 和直接相关的包 / CLI 消费者测试须通过。

重新打包并在工作区外安装 Coordinator：安装闭包中不再包含两个退役包，类型与实际入口可用；重新执行周期请求、耗尽重读、外部追加、重启恢复与停止验证。旧 CLI 的发现和用户指引明确反映移除，不伪装成新实现的兼容入口。
