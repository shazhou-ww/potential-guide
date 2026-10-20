# Deployment

以下为外部消费验证种子，不授权 npm 发布或改写用户真实 Agent 配置。

## Steps

### D-S01: 验证独立安装后的管理入口

通过打包产物安装到独立目录，使用实际包管理器 shim 验证 pguide agents 的帮助、资源位置与管理行为，不依赖仓库源码或偶然 PATH。通过确认的 Pages 渠道取得 canonical Agent schema，并按哈希核对包内外定义。

### D-S02: 验证迁移与执行衔接

使用隔离的用户/项目配置样例，演示显式迁移后诊断及治理按正确名称和来源消费 Agent。

## Acceptance criteria

### D-AC01: 新入口独立可用

交付环境证据证明约定命令可发现且操作独立定义；`https://shazhou-ww.github.io/potential-guide/schemas/agents/v1.json` 真实返回与包内相同的定义，定义变更受不可变发布检查保护。主配置语法不被本项暗中改变；不把 tarball 验证表述成 npm 已发布。

### D-AC02: 迁移后的来源与边界保持

外部样例证明旧内嵌格式明确拒绝、迁移后有效定义一致、秘密不出现在输出中，不通过文件移动扩大信任。

实际验证记录见 [Verification.md](./Verification.md)；公共 URI 尚未验证时保持对应条目未完成。
