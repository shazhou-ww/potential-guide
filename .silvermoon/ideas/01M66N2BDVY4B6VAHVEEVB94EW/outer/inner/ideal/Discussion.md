# 类型资产管理：来源与未决边界

本文支撑 [Idea.md](Idea.md)。来源为 [task-engine-web-ui](../../../../01M663BC641JV531CXWN5WD2AG/outer/inner/ideal/Idea.md) 的 US-07 至 US-11 及[能力调研](../../../../01M663BC641JV531CXWN5WD2AG/outer/inner/ideal/Research.md) E6–E9。2026-10-30 用户要求将已明确的后端修改拆为独立 ideas，交给后续 session 跟进；本条承接类型资产侧缺口，并非通用 Engine 内核功能。

## 已有事实

- 现有 ArtifactSource 公开 authorize、resolve；其默认缓存是进程内 Map，按 scope/kind/URL/digest 绑定，没有查询或选择性清理接口。
- 任务 Prepared 保存精确文件内容；Check worker 的逐执行目录另有生命周期；旧 prepareCheckArtifact 又有不同的磁盘缓存。不能把这些对象混成一个可任意删除的“本地缓存”。
- Checker/Objective manifest 已携带 subjectSchema；UI 按类型表单还需要所选制品的这层元数据。
- digest 精确校验已有，但版本目录和持久可用性没有保证；Check 的原始未固定版本请求不等于公开可回读的实际解析版本。

源码与测试路径、行号集中在来源调研，不复制实现设计或把这些缺口宣称已解决。

## 本条与其他 idea 的分工

- [task-type-schema-discovery](../../../../01M66MRFCSDK99MAEN8RN3NKBH/outer/inner/ideal/Idea.md) 拥有通用 Task 输入契约及类型发现；本条拥有类型资产元数据与管理边界。Task 输入 Schema 与具体制品 subjectSchema 不互相替代。
- UI idea 保留使用流程、同机收藏/Endpoint 绑定、历史重做的产品语义。此处不替 UI 决定默认使用旧版或当前版，也不先实现账号/同步或任务全量列表。
- [artifact-host-contracts](../../../../01M61G3GCGWGHGA8VHG16WCNZ5/outer/inner/ideal/Idea.md) 是已有制品与服务化方向来源；本条聚焦缺失的管理面，不重新定义制品格式、摘要或业务执行器。

## 需要在准备阶段收敛

1. 管理对象是现有进程内缓存，还是需要持久的精确制品存储；版本目录覆盖缓存过的版本还是其他明确来源。仅知道旧 digest 不能承诺可下载任意历史版本。
2. 如何受控取得所选制品 subjectSchema；若首次取元数据需要下载/解析，应明确副作用、授权与资源边界，不执行制品。
3. 清理与并发 resolve、动态 Probe 解析及在用内容的保护关系。建议以受控资产标识执行，由所有者判断并逐项返回成功/保护/失败；不接受任意文件路径。
4. 按 UI 最终确认的复用规则决定需要公开哪些解析版本证据，以及原内容不可得时如何说明；不暴露完整 Prepared 或后端内部数据库。

上述方案仍待独立 session 讨论。本次只建立方向卡和下游种子，所有执行条目保持未勾选；未授权实施、验收、真实清理或发布。
