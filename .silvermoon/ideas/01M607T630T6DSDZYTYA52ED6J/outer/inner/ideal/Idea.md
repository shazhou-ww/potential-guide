# 将 Check 交付为独立的内容固定制品

## 问题

自包含 worker 的执行要求不应迫使作者把生成 bundle 提交到源码仓库，也不应要求每个 Check 发布 npm 包。执行格式、制品格式和分发渠道需要解耦。

## 结果

Check 可以作为包含 manifest、worker、资源和 References 的独立制品交付；消费者按声明的 digest 获取准确内容，不需要安装 Check 的依赖或在消费时构建。

## 边界

- 保留现有 Check Host 的执行、取消和内容校验边界，不让 Host 理解分发渠道或 Objective。
- 支持本地开发制品与 HTTPS 压缩包；不建设 registry，不要求 npm 发布，不把生成 bundle 作为源码提交。
- 本项交付 Check 能力；Objective 组合及内置内容的正式 Release 迁移分别属于后续两项。

## 验收标准

- 一个真实 Check 可从源码生成含完整 References 的制品，并在无需安装其依赖的消费者环境执行。
- 相同声明固定相同内容；篡改、缺失和不安全的压缩包明确失败。
- 既有执行结果、预算、取消及资源清理语义不因新分发方式而变化。

设计动机和取舍见[设计说明](./design-rationale.md)。
