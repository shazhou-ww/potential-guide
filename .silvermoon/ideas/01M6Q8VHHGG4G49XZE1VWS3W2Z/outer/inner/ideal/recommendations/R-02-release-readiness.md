# R-02：把新包接线和发布门限变成一次就绪检查

**产品与责任**：本仓库包集成与发布工具、GitHub Actions。**覆盖**：A-06、A-07、A-10，关联 A-09。证据见[问题清单](../Acceptance-issues.md)的 E1、E5、E7。

## 判断

业务包已经能构建，但 Objective 声明、结构验证、发布 inventory、tag 路由和 workflow choice 仍可能遗漏。这次已补齐具体遗漏；建议解决的是下次新增包时的可发现性。准确 main CI 门限是应保留的保护，不是待放宽的障碍。

## 建议修改

1. 在既有 release inventory 上提供只读、按包聚合的就绪报告，分别列出“仓库接线”“制品验证”“外部发布前提”，一次展示所有已发现的缺项，而不是每修一项再暴露下一项。
2. 仓库接线检查复用现有结构测试：manifest 名称/目录、导出与文件、适用 Objective/层级声明、build/lint/test/typecheck 接线，以及 release tag 与 workflow 手动选择。未选择正式发布的包明确显示“仅验证”，不要自动把每个新包加入发布列表。
3. 对准确候选 SHA 展示现有 `verify-release-ci` 的结论、run attempt 和未通过项；CI 缺失、运行中、失败与通过分开。包版本占用、内部依赖版本可用性、trusted-publisher 验证是否实际执行也分别报告；不能从仓库配置推断 npm 侧授权正确。
4. 多包发布时先给出依赖顺序和每步阻塞条件；SDK 发布成功并确认所需版本后再允许进入依赖包。复用现有发布校验，不另建较宽松的“快捷发布”通道。

## 复用入口与取舍

以[release-packages](../../../../../../../scripts/release-packages.mjs)、[包结构校验](../../../../../../../scripts/check-packages.mjs)、[CI 门限校验](../../../../../../../scripts/verify-release-ci.mjs)、[发布 workflow](../../../../../../../.github/workflows/publish-npm.yaml)和[现有文档](../../../../../../../docs/npm-publishing.md)为基础。优先增加一致性检查和统一呈现，不必一开始生成所有 workflow YAML。

就绪报告不是发布许可证：tag 到达 Action 时仍重新执行关键门限，防止观察后状态变化。发布与 provenance 验证分开显示；已发布但后验失败时应走现有 verify-published 路径，不能盲目再 publish。

## 验收方式

- 在测试 fixture 中新增包并漏掉任一适用接线，报告准确指出缺项；故意仅做本地验证的包不会被自动发布。
- 错 SHA、错 attempt、未完成矩阵或缺 Release verification 都不能显示为可发布；本地通过不覆盖远端结论。
- 依赖版本不可用时，依赖包发布被阻止且给出正确先后顺序。
- 就绪检查不创建 tag、不更改 registry；实际发布仍仅通过现有 Actions，且后验恢复不重复发布。
