> 来源：[R-10 原始建议](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/recommendations/R-10-reference-reading.md)，提交 `a5eb19115b212c1675b6ab56cab7c0a28a9ec434`。父 IDEA：[check-delivery-acceptance-followups](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Idea.md)。
>
> 本副本保留原建议全文；跨产品引用仅说明协作边界，不代表本子 IDEA 承接外部服务改造。

# R-10：提供基于 raw Gateway 的受验证 Reference 读取入口

**产品与责任**：Task Engine 内容读取能力、Check 消费工具；Pinboard 负责声明实际 Gateway 能力。**覆盖**：A-31、A-32。证据见[问题清单](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Acceptance-issues.md)的 E3、E4。

## 判断

三个正确根的 raw 块请求为 200，Engine 九个用例已执行，但直接 HTTP 文件路径为 404。不能由此推断 CAR 缺少资源，也不能在未确认 Pinboard 承诺支持路径路由前认定它有 bug。`ipfs://CID/path` 是内容寻址方式，不等于任意 Gateway 都实现同样的 HTTP path 服务。

最小且符合当前边界的方向，是把已有受验证 UnixFS 读取能力做成消费者可使用的入口，而不是要求 Pinboard 新增完整文件网关，或让每个调用方自己拼 DAG。

## 建议修改

1. 基于 Engine 内部已有内容读取实现，提供窄的、只读的公开适配入口，接受显式 Gateway、根 CID、Bundle 内相对资源路径、取消信号和读取预算。具体导出名需实现时定案；不假装当前根入口已公开 `openContent`。
2. 通过配置的 raw Gateway 获取块，由标准 multiformats/UnixFS 组件验证和解析路径。严格限制相对路径、块/文件/总量/时限；不启用发现、公网 fallback、RPC 或本地 Kubo。
3. Check 消费工具先读取 `resources/check.json`，再按声明语言/问题码读取 Reference；先报告实际可用路径和语言，不做隐式语言 fallback。对页面实际字节与已验证包/CAR 做比较，既验证内容正确，也验证外部取回成功。
4. 提供小型能力预检，使用明确 CID 验证所需 raw 读取和目标资源读取；HTTP path 支持可以另报“可用/未知/不支持”，但不是 raw-only 消费的必要条件。根存在不能证明所有子块齐全。
5. 错误区分连接/HTTP、块不可用、CID 校验失败、路径不存在、资源索引非法和预算耗尽。HTTP 404 本身不能准确断言全网缺块；错误消息应保留所请求能力与阶段。

## 复用入口与取舍

复用[Engine 内容读取](../../../../../../packages/task-engine/src/content.ts)和[Check 资源约定](../../../../../../packages/check-sdk/README.md)，并对照[现有 Gateway 边界](../../../../../../docs/task-server.md)。[ipfs-content](../../../../../../packages/ipfs-content/README.md)当前仅是私有回归 fixture，**不要为了方便恢复为生产依赖或建议安装它**。

首选现有包的明确子入口/适配器，不预先新建通用 IPFS 产品。若需 HTTP 浏览器直链，另行提出 Pinboard 路径网关需求，评估内容安全与缓存；不能把它混入本次受验证读取的最小改动。

## 验收方式

- 在只支持 raw 块、不支持 HTTP 文件路径的 Gateway 上，按三个原始 CID 读完索引和全部 Reference，并与已验证制品逐字节一致。
- 删除子块、返回错误哈希、越界路径、坏索引、取消与超限均明确失败，不使用备用节点偷偷补齐。
- HTTP 路径返回 404 时仍能走所选的正式 raw 读取流程；这不是失败后自动切换 transport，而是调用前已选择的能力。
- E4 中未完成的公开 Reference 验证只能在实际重跑成功后关闭，写完本建议不构成验收证据。
