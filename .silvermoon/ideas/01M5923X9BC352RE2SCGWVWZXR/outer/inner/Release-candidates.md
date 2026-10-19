# 新 RC 清单

基线为 main `7103371b913b555e4c4b14bcd70e9b38bc928017`，旧 RC producer 为
`a8314ddb0a375f9edc97ce496373874e213367c6`；effects producer 为
`4526dd019d806c4d83f45fa60b66dde687e8c669`。以下仅为本地候选，不是 registry 发布记录。

| 包 | 原 RC | 本次候选 | 分类与依据 | 将来稳定映射 |
| --- | --- | --- | --- | --- |
| effects | 0.1.0-rc.0 | 不变 | producer 后源码、公开 API 无差异；复用已有上游 | 0.1.0 |
| git-source | 0.1.0-rc.0 | 不变 | producer 后源码、公开 API 无差异 | 0.1.0 |
| objective-pilot | 0.1.0-rc.0 | 0.2.0-rc.0 | feature minor：process probe 向检查注入实际 timeout 的 runtime-owned 元数据，支持与本地 setup 协调显式长预算；默认 30 秒及取消/清理语义不变 | 0.2.0 |
| objective-regulator | 0.3.0-rc.0 | 0.4.0-rc.0 | breaking minor：54afc42 将无限协调改为有 quota 的有限执行；输入、结果、prerequisite 和错误模型改变，b4a0061 新增显式授权结果 | 0.4.0 |
| objective-portfolio-supervisor | 0.3.0-rc.0 | 0.4.0-rc.0 | breaking minor：54afc42 改为 planner/coordinator 与资源绑定、队列反馈接口；b4a0061 增加授权反馈与实时策略 | 0.4.0 |
| cli-core | 0.2.0-rc.0 | 0.3.0-rc.0 | breaking minor：AgentProfile 由旧 ACP 结构变为 ACP/AHP 判别联合，AcpClient 类型收窄；同时新增权限请求及 AHP 执行/恢复接口 | 0.3.0 |
| config | 0.2.0-rc.0 | 0.3.0-rc.0 | feature minor：AHP profile、运行权限及 limits 配置校验/输出；适配新的 cli-core，非单纯补丁 | 0.3.0 |
| pguide | 0.3.0-rc.0 | 0.4.0-rc.0 | breaking minor：schemaVersion 3 portfolio、planner/executor 分离与有限 regulate 结果；后续权限、AHP、setup 功能及本次验证修复 | 0.4.0 |

所有已改变包均选择新的 minor RC 系列，而非覆盖已发布 rc.0。未改变的 effects/git-source 两个上游不重复发布；
本次没有仅补丁分类的独立包。命令 metadata 与相应包版本一起更新。

依赖顺序：复核已有 effects → git-source / 新发 objective-pilot；
新发 objective-regulator → objective-portfolio-supervisor；
独立分支 cli-core → config；最后 pguide。所有内部声明保持 `workspace:^`，
pnpm pack 会展开为各上游当前候选的 `^0.x.y-rc.N`，例如 regulator/supervisor 为
`^0.4.0-rc.0`，cli-core/config 为 `^0.3.0-rc.0`，objective-pilot 为
`^0.2.0-rc.0`，effects/git-source 为 `^0.1.0-rc.0`。
lockfile 的内部引用是 `link:../…`，不是版本副本；刷新 lockfile 后无需文本变化。

将来稳定映射只是去掉 RC 后缀的目标，不授权发版：需要另行更新并复核所有被提升包的 manifest、
pack 依赖与发布顺序，再以真实 registry 的 `--published` 和 `--latest` 验证。
当前保持既有 release hold，不创建 tag、不发布 npm、不移动 latest。
