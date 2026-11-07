# 验证 Objective 的真实交付与消费

本文件是准备阶段的可调整交付初版。外部发布需要届时明确的渠道与授权，不由本 idea 自动授权 npm 发布。

## Steps

### D-S01: 交付代表性 Objective

通过选定且获授权的内容渠道交付包含实际 Check 的 Objective，记录根 CID 与来源固化凭据。

### D-S02: 验证独立消费者

在独立消费者环境中获取完整闭包、物化并执行 Probe，检查有效文档与原始 Check 文档的可读取性。

## Acceptance criteria

### D-AC01: 精确成品可获取

真实渠道按记录的 Objective CID 返回完整可验证闭包；以独立下载、哈希验证和物化记录证明，不以构建成功替代交付证据。

### D-AC02: 消费结果与文档一致

独立 Probe 覆盖未完成与完成状态，实际读取 Override 和继承文档；发布入口更新后原 Objective 仍绑定相同 Check 内容。
