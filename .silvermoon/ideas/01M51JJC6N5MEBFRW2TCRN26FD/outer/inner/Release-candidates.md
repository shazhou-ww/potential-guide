# 函数式迁移 RC 候选清单

本文件是 [I-S03](./Implementation.md#i-s03-交付迁移入口与-rc-发布候选) 的逐包候选决策，不是发布成功记录。最终发布证据属于 [Deployment](../Deployment.md)，当前仍须完成实现验收、primary 同步和发布前核实。

## 版本决策

2026-10-16 通过获准使用的 npmx 包页面观察已发布基线。latest 不能代表最高产品版本：例如 pguide 的 latest 仍是 0.0.0，rc 指向 0.2.0-rc.1，而迁移前仓库 manifest 已是 0.2.0-rc.2。以下以已发布公共契约及本轮变更作判断，不把仓库字段当成已发布事实。

| 包 | 已观察基线 | 候选 | 判断依据 |
| --- | --- | --- | --- |
| `@potential-guide/effects` | 0.0.0 placeholder | `0.1.0-rc.0` | 第一个有功能的运行薄适配产品，不继承退役 Guide 的版本号。 |
| `@potential-guide/git-source` | 0.0.0 placeholder | `0.1.0-rc.0` | 第一个领域无关 Git 来源产品。 |
| `@potential-guide/objective-pilot` | 0.0.0 placeholder | `0.1.0-rc.0` | 新包首个产品；旧 Guide 消费方按破坏性迁移指导切换。 |
| `@potential-guide/objective-regulator` | 0.2.0-rc.0 | `0.3.0-rc.0` | 公开类型、配方 / subject 分离、完整观测 Agent 输入、单次限制及效应接口均有破坏性变化。 |
| `@potential-guide/objective-portfolio-supervisor` | 0.2.0-rc.0 | `0.3.0-rc.0` | 注册与执行接口随 Pilot / Regulator 的公共契约变化；不重设计组合治理策略。 |
| `@potential-guide/cli-core` | 0.1.0-rc.0 | `0.2.0-rc.0` | 配置 schema 2、Agent 单次限制及旧领域来源接口退出属于破坏性变化。 |
| `@potential-guide/config` | 0.1.0-rc.1 | `0.2.0-rc.0` | 配置命令、帮助与可接受配置转向 schema 2；不能按兼容修复只升 patch。 |
| `pguide` | 0.2.0-rc.1 | `0.3.0-rc.0` | CLI 参数、scaffold、统一探针信封、调节和持久化记录契约均破坏性迁移。 |

来源：

- [effects](https://npmx.dev/package/@potential-guide/effects)、[git-source](https://npmx.dev/package/@potential-guide/git-source)、[objective-pilot](https://npmx.dev/package/@potential-guide/objective-pilot)。
- [objective-regulator](https://npmx.dev/package/@potential-guide/objective-regulator)、[objective-portfolio-supervisor](https://npmx.dev/package/@potential-guide/objective-portfolio-supervisor)。
- [cli-core](https://npmx.dev/package/@potential-guide/cli-core)、[config](https://npmx.dev/package/@potential-guide/config)、[pguide](https://npmx.dev/package/pguide)。

npmx 可能缓存页面；发布前仍由获准的 GitHub-hosted workflow 向 registry 核实目标版本未占用并生成权威回执。不在受限本机绕过 registry 网络策略。Trusted Publisher 已配置是用户提供的外部准备信息，实际权限以真实 OIDC 发布结果为准。

## 顺序与产物

依赖顺序为：

```text
effects
  → git-source、objective-pilot
  → objective-regulator
  → objective-portfolio-supervisor

cli-core → config

上述依赖全部可获取 → pguide
```

候选均使用 `rc` dist-tag，保持 major=0，不发稳定版或 1.0，不改变已有 latest。objective-guide 已退役，不创建其新发布 tag。各包单独使用 `effects-v...`、`git-source-v...`、`objective-pilot-v...` 等包专属 tag；tag 版本必须与实际 manifest 一致，且 tagged commit 已进入 primary。

候选 commit 以完成全部验证后同步到 primary 的实现提交为准；发包前核对版本、产物、公开导出及内部依赖属于该提交。若候选版本已被并行工作占用，返回实现准备新 RC，不覆盖 npm 版本或移动既有 tag。若同一目标候选只需修订，则递增 rc.N，不机械再次升 minor。
