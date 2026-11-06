# 按验证过的套件清单安装 Task Engine

父 IDEA：[check-delivery-acceptance-followups](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Idea.md)；来源建议：[R-03](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/recommendations/R-03-suite-installation.md)。完整内容已复制至[修改建议](./Recommendation.md)。

## 问题

用户需逐包猜测可用版本，latest 可能是占位版本；安装成功也不证明作者和运行能力都可用。

## 结果

提供经过发布消费验证的套件版本清单、明确安装范围及能力后验，让用户安装可复验的兼容组合。

## 边界

- 仅改本仓库发行清单、安装指引和验证接线，不自建包管理器、不绕过 npm 脚本或设备网络策略、不静默覆盖用户现有环境。
- 本次仅创建与整理独立子 IDEA，不代表已批准实施或验收；与父 IDEA 分别维护生命周期。

## 验收标准

- 清单绑定准确版本、Node 范围和验证来源，不从各包当前 latest 临时拼装。
- 运行、作者和完整验收范围有清晰依赖闭包，实际安装图与清单一致。
- 脚本受限或网络不可用时逐项报告能力与未知状态，不把安装退出 0 当完整成功。

## 下一步

核对本子 IDEA 的范围和验收标准，再提交构想验收。
