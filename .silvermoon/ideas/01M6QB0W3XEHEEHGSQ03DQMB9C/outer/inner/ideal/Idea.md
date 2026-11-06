# 交付受测试的跨平台消费验收工具

父 IDEA：[check-delivery-acceptance-followups](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Idea.md)；来源建议：[R-07](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/recommendations/R-07-consumer-verification.md)。完整内容已复制至[修改建议](./Recommendation.md)。

## 问题

临时验收脚本易受换行、编码、Shell 参数和模块解析影响，报告代码错误还会遮蔽已经执行的业务事实。

## 结果

将现有消费验证收编为受测试、分阶段留证的入口，减少操作者拼脚本并在异常路径保持结果与资源所有权可追溯。

## 边界

- 先改本仓库消费验证工具，必要时再经 pguide 分发；不建设远程运维平台，不自动搜寻密钥、修改全局 PATH 或接管服务。
- 本次仅创建与整理独立子 IDEA，不代表已批准实施或验收；与父 IDEA 分别维护生命周期。

## 验收标准

- 同一受校验配置在 Windows/Ubuntu 可运行，预检明确真实工具版本与公开导入能力。
- 阶段结果在后续失败前持久化；业务失败、工具故障和报告失败不能混为成功。
- 静态与运行回归覆盖报告及清理路径，仅操作本次拥有的资源。

## 下一步

核对本子 IDEA 的范围和验收标准，再提交构想验收。
