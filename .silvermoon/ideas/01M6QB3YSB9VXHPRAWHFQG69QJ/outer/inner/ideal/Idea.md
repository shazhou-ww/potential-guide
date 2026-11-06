# 将 Check 消费契约做成可执行范例

父 IDEA：[check-delivery-acceptance-followups](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Idea.md)；来源建议：[R-08](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/recommendations/R-08-check-contracts.md)。完整内容已复制至[修改建议](./Recommendation.md)。

## 问题

消费者仍需凭印象拼请求、问题码和取消预期，容易把契约误读变成产品失败判断。

## 结果

提供针对真实打包 Schema 的受测消费范例和字段诊断，明确区分业务结果、运行终态与物理回收。

## 边界

- 仅改 Check SDK、环境包消费示例和诊断接线；不引入旧 Host，不把 Check 业务规则移入通用 Engine，不暗改取消语义。
- 本次仅创建与整理独立子 IDEA，不代表已批准实施或验收；与父 IDEA 分别维护生命周期。

## 验收标准

- 公开示例使用已安装包独立运行，输入、问题码与实际打包契约保持一致。
- 缺字段和非法结果得到准确路径诊断，不以静默默认值掩盖问题。
- 工具与网络的既有不同取消终态被准确解读，并分别验证无伪结果和真实回收。

## 下一步

核对本子 IDEA 的范围和验收标准，再提交构想验收。
