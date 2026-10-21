# Implementation

## Steps

### I-S01: 明确协议与迁移边界

定义协议内置 initial、manifest 至少一个业务层级和累计达成判定；terminal 仅作为所属 Objective 实际最高业务层级的别名，不允许声明同名业务层级。识别 schema、历史 terminal 目标及证据的迁移要求，不以保留别名为由静默重解释旧契约。遵守已发布 schema URI 不可变约束。

采用新的 objective/v2.json，保留 objective/v1.json 的既有字节。协议集中提供目标解析、累计 rank 和严格达成证据 rank；Manifest 迁移必须显式提供逐组审核后的 attainment-levels。旧 Portfolio 和 Regulation 恢复记录通过版本边界拒绝，重新审核目标并从新提交重新观察，不改写旧来源证据。

### I-S02: 对齐运行链路与自有 Objective

调整协议、观察、目标比较、Regulator、Coordinator 及依赖验证的直接相关消费面；迁移仓库内 Objective、引用文档及必要生成物，不合并 command 简化。

覆盖 Pilot 的 current 与 problem scope 分离、initial 无检查入口、Regulator 目标与进度、Coordinator 可信进度及依赖交接、Portfolio/Planner 阈值、CLI scaffold 与呈现。自有 Objective 的最高业务 ID 分别采用 verified、sustainable、standardized；安装 sanity fixture 采用 repaired，同步 scoped references、独立 runtime、消费验证脚本与相关说明。保持 Regulation 的持久尝试、continue、权限与停止语义。

### I-S03: 验证层级与兼容性反例

补充达成矩阵、异常、依赖证据和旧输入反例，执行相关测试及 pnpm check，更新直接相关说明。

复用既有 levelRank、非覆盖迁移 CLI、来源固定与生成物新鲜度检查作为先例，将共同语义下沉至协议而不是另造消费侧比较规则。执行核心测试、真实 CLI 测试、自有 Objective 集成测试、生成物检查及完整 pnpm check；证据与非阻断偏差集中记录于 [Evidence.md](./Evidence.md)。

## Acceptance criteria

### I-AC01: 达成判定准确

测试证明首层失败、逐层通过、全部通过及观察异常的结果准确；current 与未达层级问题引用保持区分，initial 目标不执行业务 checks 或 Agent，但仍拒绝非法契约、目标及 subject。

### I-AC02: 消费面与迁移一致

相关集成测试证明目标比较、依赖交接和仓库内 Objective 使用同一层级语义；terminal 别名按所属 Objective 解析为真实最高层级，观察及达成证据使用真实 level ID。旧契约显式迁移或明确拒绝，已发布 schema 不被原地修改。

### I-AC03: 仓库校验与偏差归档

相关正确性测试与生成物检查通过，执行 pnpm check 并修复本变更造成的失败；已有且与本语义无关的基线失败保留明确结果与复现位置，不虚称全绿。文档能指导消费者使用新契约。此证据标准遵循已确认的非阻断基线处理边界，不扩大理想契约或外部部署范围。
