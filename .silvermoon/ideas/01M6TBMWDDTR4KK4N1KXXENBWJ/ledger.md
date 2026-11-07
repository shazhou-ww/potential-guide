# Ledger

## Implementation

### Implementation steps

- [ ] **I-S01:** 明确多来源配置与迁移边界
- [ ] **I-S02:** 实现有界且可观察的来源切换
- [ ] **I-S03:** 更新消费走查与回归验证

### Implementation acceptance criteria

- [ ] **I-AC01:** 所有配置入口具有一致语义
- [ ] **I-AC02:** 故障切换不破坏内容与时间边界
- [ ] **I-AC03:** 文档和发布包消费者可复现

## Deployment

### Deployment steps

- [ ] **D-S01:** 确认真实 Gateway 与制品交付条件
- [ ] **D-S02:** 走查无本地 Kubo 的消费路径
- [ ] **D-S03:** 验证现实故障与保留证据

### Deployment acceptance criteria

- [ ] **D-AC01:** 真实来源可交付同一内容
- [ ] **D-AC02:** Node-only 软件前提完成业务与恢复
- [ ] **D-AC03:** 故障路径有界且不虚报
