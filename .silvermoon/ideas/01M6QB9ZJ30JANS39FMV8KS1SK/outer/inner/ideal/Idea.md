# 通过 raw Gateway 按 CID 读取 Check Reference

父 IDEA：[check-delivery-acceptance-followups](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Idea.md)；来源建议：[R-10](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/recommendations/R-10-reference-reading.md)。完整内容已复制至[修改建议](./Recommendation.md)。

## 问题

raw 块获取足以运行 Task，但消费者误以为同一 Gateway 必然支持 HTTP 文件路径，导致 Reference 验证停在 404。

## 结果

提供复用标准块验证与 UnixFS 解析的只读消费入口，让 raw-only Gateway 上的索引和 Reference 也可独立逐字节验证。

## 边界

- 本子 IDEA 只负责 Task Engine 内容读取及 Check 消费；不要求 Pinboard 新增 HTTP 路径路由，不恢复私有 ipfs-content fixture 为生产依赖，也不加入 fallback 节点。
- 本次仅创建与整理独立子 IDEA，不代表已批准实施或验收；与父 IDEA 分别维护生命周期。

## 验收标准

- 显式 Gateway/CID/相对路径与预算足以读取三个检查索引和全部 Reference，并与已验证制品字节一致。
- 缺子块、坏哈希、越界路径、坏索引、取消与超限有准确失败阶段。
- HTTP 路径 404 不阻断已选择的 raw 读取方式，成功仍须真实外部证明。

## 下一步

核对本子 IDEA 的范围和验收标准，再提交构想验收。
