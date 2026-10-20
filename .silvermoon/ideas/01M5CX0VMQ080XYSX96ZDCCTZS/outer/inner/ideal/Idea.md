# 规范化 Objective 定义与跨格式引用

## 问题

静态目标定义仍使用 Pilot 命名、冗余 advancement 包装及宽泛 schema 类型，引用字段在声明、Portfolio 和恢复记录中混用。范围依据[总构想评审中的 M-01 至 M-05、G-01](../../../../01M5CR0X2B4R2C6K3183Y1T3SQ/outer/inner/ideal/Schemas.md)。

## 结果

目标定义使用 Objective Manifest 与 objective.yaml，扁平化 levels[].checks，采用 subjectSchema 和标准 Draft 2020-12 类型及校验。所有数据格式中指向目标定义的 pilot 引用一致改为 objective；公共格式以不可变 schema URI 标识。

## 边界

- 保持检查、推进、来源证据和恢复语义；Pilot 执行角色不作机械重命名，不改变未评审格式的其他业务语义。
- 旧入口、结构及字段明确拒绝，提供显式迁移；不兼容读取、不静默改写或覆盖未知数据。
- canonical URI 采用项目现有身份下的 `https://shazhou-ww.github.io/potential-guide/schemas/<format>/v1.json`，文档以 `$schema` 标识，定义随包离线校验。实际托管与不可变发布必须验证，不购买域名或发布 npm。

## 验收标准

- 公共类型、schema、生产者与消费者使用一致的新命名和结构；有效定义可离线校验并完成既有观察流程。
- 旧格式明确失败且可显式迁移，迁移后保持级别、引用和固定来源证据的含义。
- schema URI 对应定义可独立取得且与包内一致，旧已发布定义不可被悄然替换。
