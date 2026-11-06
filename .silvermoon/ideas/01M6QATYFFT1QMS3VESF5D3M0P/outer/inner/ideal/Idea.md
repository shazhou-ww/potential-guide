# 统一包接线与发布就绪检查

父 IDEA：[check-delivery-acceptance-followups](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Idea.md)；来源建议：[R-02](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/recommendations/R-02-release-readiness.md)。完整内容已复制至[修改建议](./Recommendation.md)。

## 问题

新包可以构建却仍可能遗漏声明、发布 inventory 或 workflow 路由；准确 CI 与依赖发布前提分散，操作者需逐项试错。

## 结果

用只读聚合报告提前展示仓库接线、制品验证和外部发布前提，保留实际发布时的严格二次校验。

## 边界

- 修改本仓库发布工具和 Actions 配置，不修改 GitHub/npm 产品，不创建较宽松发布通道，也不自动授权所有新包发布。
- 本次仅创建与整理独立子 IDEA，不代表已批准实施或验收；与父 IDEA 分别维护生命周期。

## 验收标准

- 一次报告列出候选包适用的接线缺项，明确区分仅验证与正式发布包。
- 准确候选 SHA、run attempt、Release verification 及依赖版本状态可辨，不以本地成功替代远端门限。
- 检查无发布副作用，已发布但后验失败时指向 verify-published 而不重复 publish。

## 下一步

核对本子 IDEA 的范围和验收标准，再提交构想验收。
