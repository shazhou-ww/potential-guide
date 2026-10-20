# Deployment

本契约验证已确认的 Pages schema 与独立 tarball 消费，不授权发布 npm 包、购买域名或修改无关远端资源。

## Steps

### D-S01: 验证公共 schema 交付

从 `https://shazhou-ww.github.io/potential-guide/schemas/objective/v1.json` 和
`objectives/v1.json` 取得定义，验证 HTTP 200、公共源码及包内副本的字节一致性，
并用实际已发布索引验证更改/删除被拒绝。包消费者不依赖运行时下载 schema。

### D-S02: 验证作者与恢复场景

使用独立消费环境中的目标定义、声明、Portfolio 及受支持的迁移样例验证实际流程，不用源码直接导入冒充发布交付。

## Acceptance criteria

### D-AC01: URI 真实可用且不可变

外部获取及内容比对证明 canonical URI 的定义与交付包一致，发布检查拒绝覆盖已发布定义。

### D-AC02: 新旧边界可观察

独立消费证据证明新入口可工作、旧格式明确拒绝、显式迁移后含义保持一致，且离线执行不需要访问 schema 托管服务。

实际证据见 [Verification.md](./Verification.md)。远端完整检查中的失败须修复并记录，不以单独部署作业成功代替全部检查通过。
