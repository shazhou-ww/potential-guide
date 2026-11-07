# Deployment

## Steps

### D-S01: 独立验证实际消费结果

在仓库外安装准确候选包，通过新公共入口从明确配置的 raw-only Gateway 读取三个已发布 CID 的索引和全部 Reference，逐字节对照对应已验证 CAR；不用本地节点或 CAR fallback 替代公共取回。

## Acceptance criteria

### D-AC01: 结果有可复验证据

记录包版本、源码提交、Gateway、CID、路径、预算和真实结果；公共字节与对应 CAR 一致，缺块、坏哈希、取消及超限准确失败。旧验收已提供的读取证明不冒充新入口实测；HTTP 路径 404 和未执行平台单独记录，不从历史 Ubuntu 延期推导本候选跨平台通过。
