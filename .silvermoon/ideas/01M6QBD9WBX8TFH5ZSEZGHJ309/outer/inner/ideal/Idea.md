# 按当前验收范围生成仓库交付报告

父 IDEA：[check-delivery-acceptance-followups](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Idea.md)；来源建议：[R-11-local](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/recommendations/R-11-evidence-scope.md)。完整内容已复制至[修改建议](./Recommendation.md)。

## 问题

安装、上传、业务执行与公开读取的证据范围不同，历史恢复叙述和当前结论混在一起，容易误读完整交付状态。

## 结果

在本仓库以同一结构化来源生成当前验收摘要及详细报告，绑定要求来源、环境、制品身份和实际检查范围。

## 边界

- 只实施 R-11 的仓库报告适配：摘要、范围绑定和同源呈现。完整建议副本中的 Silvermoon gate review 产品修改属于外部项目，不纳入本子 IDEA；不改其 event schema 或自动执行 submit/accept。
- 本次仅创建与整理独立子 IDEA，不代表已批准实施或验收；与父 IDEA 分别维护生命周期。

## 验收标准

- 报告区分通过、失败、阻塞、未执行和不适用，缺失或冲突证据不能变成默认成功。
- 新增要求明确标出待补证明，旧事实可经显式复核沿用而不混同不同环境或 CID。
- 摘要与详情来自同一投影，历史保持可追溯，报告不替代实际运行或人工门禁。

## 下一步

核对本子 IDEA 的范围和验收标准，再提交构想验收。
