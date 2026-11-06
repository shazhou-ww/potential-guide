# Implementation

## Steps

### I-S01: 落实规范化与自解释契约

按[准确契约](./ideal/Scope-and-evidence.md)实现默认 UTF-8/LF 文本、binary 最终路径 pattern 和 manifest 精确清单；贯通协议、Schema、作者工具、Engine、生成器与夹具，不保留旧契约兼容分支。

### I-S02: 接通缓存与 CID 消费边界

复用标准读取/校验器，仅按根 CID 判定身份，复制消费已验快照；修订 SDK/environment 的规范资源比较和缓存后核验，保留失败不覆盖输出的行为，不新增容器哈希或来源批准体系。

### I-S03: 完成回归与公开文档

覆盖规范化、binary、旧缓存、同根不同容器、错根和替换竞态，更新直接相关公开文档与生成 Schema，运行定向验证及 pnpm check。

## Acceptance criteria

### I-AC01: 规范内容与声明一致

LF/CRLF/CR、UTF-8 错误、BOM、binary glob 和最终清单测试证明规范化幂等、binary 不变、目录/CAR 一致；公共读取只验证，新声明缺失明确拒绝。

### I-AC02: 唯一 CID 与实际消费一致

同根不同合法 CAR 表示通过，明确错根拒绝，坏块/DAG/路径/容量保护不退化；确定性替换测试证明后续只消费已验快照，失败不覆盖已接受输出。

### I-AC03: 缓存与仓库集成通过

真实接线的冷构建、正常命中和 binary 配置变化得到正确内容，旧输出不能逃过新校验；定向测试及 pnpm check 通过，证据可重复，不使用永久强制重建。
