# 通过 raw Gateway 按 CID 读取 Check Reference

父 IDEA：[check-delivery-acceptance-followups](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Idea.md)；来源建议：[R-10](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/recommendations/R-10-reference-reading.md)。完整内容已复制至[修改建议](./Recommendation.md)。

## 问题

公共 raw Gateway 已能经标准 UnixFS 读取三份检查索引和全部 12 篇 Reference，但消费者仍需手工组装读取与校验脚本，缺少受支持的公共消费入口。

## 结果

提供复用标准块验证与 UnixFS 解析的只读公共入口，将已经证明可行的 raw-only 消费方式产品化，并保持通用内容读取与 Check 资源解释分层。

## 边界

- 本子 IDEA 只负责 Task Engine 内容读取及 Check 消费；不要求 Pinboard 新增 HTTP 路径路由，不恢复私有 ipfs-content fixture 为生产依赖，也不加入 fallback 节点。
- 遵守 [Axis 内容分层](../../../../../../docs/axis/task-engine-contracts/task-bundle.md#ipfs-access-与-bundle-解释的分层)：底层只处理 CID、DAG 与字节流，Check 层解释索引、语言和问题码，不新增 Engine 业务状态或类型目录。
- [已完成的公共读取证据](../../../../01M6NZBYXR81BMP219KRK5DQQC/outer/Deployment-evidence.md)仅证明其指定制品与环境；本次更新不等于公共 API 已交付，也不继承 Ubuntu 验证或其他 IDEA 的接受。

## 验收标准

- 独立安装后的公共入口以显式 Gateway/CID/相对路径和预算读取检查索引与 Reference；内容身份只用根 CID，返回字节与对应已验证制品一致。
- 缺子块、坏哈希、越界路径、坏索引、取消与超限有准确失败阶段。
- HTTP 路径 404 不阻断已选择的 raw 读取方式，成功仍须真实外部证明。
