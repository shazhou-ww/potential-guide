# 规范化 Objective 定义与跨格式引用

## 问题

静态目标定义仍使用 Pilot 命名、冗余 advancement 包装及宽泛 schema 类型，引用字段在声明、Portfolio 和恢复记录中混用。范围依据[总构想评审中的 M-01 至 M-05、G-01](../../../../01M5CR0X2B4R2C6K3183Y1T3SQ/outer/inner/ideal/Schemas.md)。

## 结果

目标定义使用 Objective Manifest 与 objective.yaml，扁平化 levels[].checks，采用 subjectSchema 和标准 Draft 2020-12 类型及校验。所有数据格式中指向目标定义的 pilot 引用一致改为 objective；公共格式以不可变 schema URI 标识。

## 边界

- 保持检查、推进、来源证据和恢复语义；Pilot 执行角色不作机械重命名，不改变未评审格式的其他业务语义。
- 旧入口、结构及字段明确拒绝，提供显式迁移；不兼容读取、不静默改写或覆盖未知数据。
- schema 地址须在写入新文件前确定；不把尚未部署的地址当成已发布，不据此授权 npm 发布或域名采购。

## 验收标准

- 公共类型、schema、生产者与消费者使用一致的新命名和结构；有效定义可离线校验并完成既有观察流程。
- 旧格式明确失败且可显式迁移，迁移后保持级别、引用和固定来源证据的含义。
- schema URI 对应定义可独立取得且与包内一致，旧已发布定义不可被悄然替换。

## 下一步

确定 canonical schema URI 的托管地址和实例标识字段；GitHub Pages 仍为候选，不预先固化为协议。
