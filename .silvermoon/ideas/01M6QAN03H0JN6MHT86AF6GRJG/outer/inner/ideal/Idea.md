# 绑定 Task 制品身份与交付来源

父 IDEA：[check-delivery-acceptance-followups](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Idea.md)；来源建议：[R-01](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/recommendations/R-01-artifact-identity.md)。完整内容已复制至[修改建议](./Recommendation.md)。

## 问题

CAR 根 CID、容器哈希与来源由操作者分散拼接，旧缓存和同名旧副本容易被误当成正确制品。

## 结果

通过现有离线制品校验入口生成同一稳定快照的身份记录，在复制和发布前自动拒绝不配套的数据。

## 边界

- 仅改本仓库的 Task Bundle 校验及构建/发布接线；Pinboard 服务端期望根约束属于外部 R-05。保留 CID 与容器哈希的不同含义，不偷偷规范化资源字节。
- 本次仅创建与整理独立子 IDEA，不代表已批准实施或验收；与父 IDEA 分别维护生命周期。

## 验收标准

- 同次校验输出根 CID、CAR 哈希、大小与来源可信状态，目录输入不伪造容器身份。
- 旧 CAR、相互矛盾的身份记录和检查后替换文件在网络写入前明确拒绝。
- 跨平台及旧缓存案例验证精确资源字节，既有 CAR/DAG 安全校验保持有效。

## 下一步

核对本子 IDEA 的范围和验收标准，再提交构想验收。
