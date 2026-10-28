# Deployment

## Steps

### D-S01: 按正式入口发布候选制品

在具备所需授权后通过新流程发布 Check 与 Objective 的 Release assets，记录来源提交、准确摘要及实际可用地址；不额外授权 npm 发布。

### D-S02: 从干净环境验证真实消费

仅安装工具，按公开文档下载已发布 Objective 及其 Check，完成观察、References 查询和受控业务流程验证。

### D-S03: 验证迁移边界

核对旧来源处置、历史任务证据和发布失败路径，确认用户能区分不可获取内容、内容不符及业务未达标。

## Acceptance criteria

### D-AC01: 真实 Release 内容可核验

记录 Release、assets、来源提交及摘要，实际下载并确认依赖引用全部可获取；不能以本地打包成功代替线上发布证据。

### D-AC02: 消费者不安装业务 npm 包

记录独立环境与真实检查结果，证明没有源码 checkout、业务包 registry 依赖或隐式构建，References 可用。

### D-AC03: 迁移不会伪造历史或发布成功

记录旧证据读取或明确退出行为及候选失败结果；缺少授权、上传失败、缺失 asset 均阻止宣称交付完成。
