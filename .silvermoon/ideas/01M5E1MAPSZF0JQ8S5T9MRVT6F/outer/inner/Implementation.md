# Implementation

## Steps

### I-S01: 完善命令人类输出

以[审计清单](./ideal/output-audit.md)为基线，修复 objectives list/show，并统一相关列表、详情、诊断和执行摘要；先复用现有展示方式，只在确有共享需要时提取辅助函数。

### I-S02: 补充兼容性测试和说明

在既有 CLI 测试中覆盖默认、显式 Markdown 和 JSON，以及空态、歧义、失败和脱敏。更新命令帮助及相关 README，注明合理的原文出口。

## Acceptance criteria

### I-AC01: 人类输出可判断且一致

测试证明 objectives 列表/详情不再整段输出 JSON，其他纳入优化的命令显示关键来源、空态或停止原因；默认与显式 Markdown 内容一致，主入口与独立命令结果一致。

### I-AC02: 机器契约及原文出口不变

回归测试证明 JSON 可独立解析、既有字段含义和退出码保持不变，脱敏仍有效，补全脚本、元数据、配置原值和报告产物保持各自用途；运行相关测试和 `pnpm check`。
