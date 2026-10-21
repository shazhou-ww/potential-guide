# Deployment

## Steps

### D-S01: 准备固定版本的隔离消费

固定已验收实现的提交，在独立消费环境中通过真实包或 Git Objective 加载入口验证，不借用源工作区文件。

选用已同步的 `682311db15c41344232a5d3f5cd806d5750779d5`：它包含实现提交 `b85b32c18ad82733769ee24f111dc66c20fcfd0f` 和正常并入的并发 primary 历史，代码对应已验收的 `implementationRevision=71ced19b3de4885c86cd736a9b22c25c941d8d28`。通过 Git archive 提取固定源码，在专属执行根目录内重建并打包；消费者目录与归档源码目录分离，只安装本次 tarball 及其正常第三方依赖。执行根位于忽略的 `.cache` 下，不把实时工作区的源码、dist 或 workspace 模块链接用于消费者。

记录 Node、pnpm、Git、平台、源码 pin、归档及 tarball SHA-256、包版本与安装清单；审核安装图和模块真实路径，拒绝解析到消费者之外的模块。使用已安装公开 API 和 CLI，不使用源文件导入，不发布 npm、部署 Pages 或修改生产环境。

### D-S02: 验证层级结果与迁移入口

从消费者入口验证 initial、部分达成、最高业务层级、terminal 别名及旧契约处理，记录所用版本、命令和实际结果；不将单元测试冒充交付证据。

消费者拥有独立已提交的三层示例 Objective，检查只读取本地 subject 和运行记录。通过真实 `pguide probe` 验证首层失败、第二/第三层失败及全部通过，检查 current 与未达层 problem ref 分离。以已安装 API 和 CLI 对比真实最高 ID 与 terminal 目标；initial 目标必须零业务检查、零 Agent 调用，非法 subject 仍失败。补充实际依赖观察，确认达成证据只含真实 ID。

从已安装迁移 CLI 验证 schema-identified v1 的明确拒绝、缺少审核映射时拒绝、带显式 attainment-levels 的非覆盖迁移；比较原始输入字节。通过公开 CLI 拒绝旧目标型 Portfolio 和旧 Regulation 恢复记录，保留并核对旧 commit/tree 等固定证据，不重新绑定。将可复现脚本、原始机器结果和中文结论保存在本 Outer World 的验证材料中。

## Acceptance criteria

### D-AC01: 隔离消费者观察一致

固定版本的真实消费输出证明初始、部分达成和全部达成语义一致；terminal 目标与真实最高层级目标等价，观察结果使用真实 level ID，不出现独立 terminal 层级；证据包含版本和可复现操作。

证明同时包含隔离安装与来源检查、完整观察矩阵、依赖真实 ID、initial 零检查/零 Agent 以及非法 subject 反例；不得以源测试结果或独立 helper 的摘要替代公开消费输出。

### D-AC02: 迁移行为可验证

隔离环境证明旧契约按文档显式迁移或清晰拒绝，现有证据不被静默重绑定。npm 发布及远程 schema 部署如有需要，须另行明确授权，不默认执行。

证明必须包含迁移前后文件、预期失败的退出码/机器错误、原始输入及旧固定证据的相等校验。发现实现阻断缺陷时停止并交回父代理，不在部署阶段修改已验收实现；非阻断环境偏差记录后继续。
