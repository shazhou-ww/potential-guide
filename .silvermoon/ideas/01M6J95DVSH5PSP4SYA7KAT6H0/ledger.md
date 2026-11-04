# Ledger

## Implementation

### Implementation steps

- [x] **I-S01:** 明确宿主与显式入口边界
- [x] **I-S02:** 接入 Engine 统一校验与拒绝 ACK 生命周期
- [x] **I-S03:** 补齐真实 Engine 回归及体积证据

### Implementation acceptance criteria

- [x] **I-AC01:** 显式入口与轻量依赖成立
- [x] **I-AC02:** 宿主校验、拒绝及物理回收有效
- [x] **I-AC03:** 可复现真实交付体积下降

## Deployment

### Deployment steps

- [ ] **D-S01:** 验证独立消费环境
- [ ] **D-S02:** 验证真实 Engine 数据职责与隔离执行
- [ ] **D-S03:** 固化来源与完整交付证据

### Deployment acceptance criteria

- [ ] **D-AC01:** 实际包可消费且 Worker 自包含
- [ ] **D-AC02:** Engine 校验及拒绝生命周期成立
- [ ] **D-AC03:** 体积及来源可追溯
