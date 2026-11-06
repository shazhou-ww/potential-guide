# Deployment

## Steps

### D-S01: 独立验证实际消费结果

以 Pinboard 上原始三个 CID 在独立消费环境读取全部 Reference 并逐字节对照，不用本地节点替代公共取回。

## Acceptance criteria

### D-AC01: 结果有可复验证据

实际公共页面字节与已验证 CAR 一致，所有失败明确归类；完成后才可为原 IDEA 提供缺失的 Reference 证明。 外部环境或授权不可用时明确报告阻塞，不用建议文档代替结果。
