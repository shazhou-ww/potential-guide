# 补全 Objective Guide 三层关系

## 问题

Objective Guide manifest 目前只声明 level 到 check 的关系，check 返回的
problem 没有归属声明，无法形成可验证的 level-check-problem 三层树。
Reference 也无法完整证明其 ID 与 manifest 节点一一对应。

## 结果

manifest 显式声明每个 check 可产生的 problem，并在加载时验证三层节点与
Reference 的双向对应，使调用方能可靠导航和校验完整的 Objective 结构。

## 边界

- 保持 `schemaVersion: 1`，由当前唯一调用方 Silvermoon 单独完成适配升级。
- 仅调整 Objective Guide manifest、运行时校验、脚手架与直接文档测试。
- 不在本 Idea 中修改 Silvermoon 仓库或发布 npm 包。

## 验收标准

- manifest 能表达每个 level 的 checks 及每个 check 的 problems。
- 缺失、多余或归属错误的 level、check、problem Reference 会被明确拒绝。
- check 只能返回其 manifest 声明的 problem，现有并发与顺序语义保持不变。
