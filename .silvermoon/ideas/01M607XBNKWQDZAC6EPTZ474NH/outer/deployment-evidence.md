# 独立 Objective 消费者交付证据

## 契约与实际环境

Deployment 契约和两个验证脚本先同步到 primary，之后才执行真实消费者。
本页和[原始结果](./consumer-evidence.json)只证明当前交付范围，不证明正式 Release、
外部托管、Linux、最低 Node 版本或 Agent 修复能力。

| 项目 | 实际值 |
|---|---|
| 执行来源提交 | `b469ff3171b9d766db6d0ce4390ce2abde9a7ae3` |
| 执行前 deploymentRevision | `6108ab27b39be51ddea0ae985e75c9327e0561d2` |
| Deployment.md blob | `19a32300bd5f002ac86a0e3ac06d1a2e8fa26ae0` |
| 环境 | Windows / Node 24.11.1 / pnpm 11.22.0 |
| 独立消费者 | `D:\Code\potential-guide-objective-consumer-662fab48-f748-4f50-9ab2-3e0f4704a51a` |
| 通过场景 | 15 |
| 真实 Host 执行 | 36 |

消费者是源码仓库外新建目录。13 个工具包从本地 pack 安装，所有实际模块 realpath
均在消费者的 node_modules 内，不指向源码 checkout；NODE_PATH 和 NODE_OPTIONS
均为空。安装实际使用 `--offline --ignore-scripts` 和作者现有 store，没有业务包
registry 解析、生命周期脚本或 Check/Objective 隐式构建。工具包逐个 SHA-256、
完整安装输出和模块位置在原始 JSON 中。

作者在独立阶段显式构建两个 Check 以及主 Objective 和前置 Objective；随后仅复制
生成交付物给消费者。业务制品没有 package.json 或 node_modules。消费者通过
公开包 API 和已安装的命令入口使用它们，不 import 作者的 dist 或测试 helper。

## 准确内容

| 内容 | 摘要 |
|---|---|
| 主 Objective | `sha256-pguide-objective-v1:dcb55ca8ea54eaec63d9b018f2f9e9199fce75025018846b2041b270c91e707f` |
| 前置 Objective | `sha256-pguide-objective-v1:c7085eddbfa538525160d165786848e0fd96e6a696014a3a3a3923e7ea18d943` |
| value Check | `sha256-pguide-check-v1:7260a798dfebe395ffb8e5a738c9582b7142d2e00937f9fd51b03979352c0a47` |
| dependency Check | `sha256-pguide-check-v1:79bbdffbaf63ca60f930c2418452dc85941d569a7aa79f48d8aa68393fa6a998` |
| value Host revision | `37ee73244f1dc7490b583ec4fb50f636795df08f0ae76fbee4b9a0b331d9a5de` |
| dependency Host revision | `26bdd0327c2b72fb74b0cdbc7bd0d93b7978e43e9255e8fa920eb3bae91b9635` |

同一个 value Check 在主 Objective 中以 first 和 second 两个局部引用使用；
其 digest/Host revision 相同，指导可分别覆盖。制品来源、准确依赖闭包和真实
执行摘要保存在原始 JSON 的 sources、observations、regulation 及恢复结果中。

## 实际验证结果

| 场景 | 观察结果 |
|---|---|
| API 累计等级，4 个输入 | 分别得到 initial、ready（内部问题）、ready（依赖问题）、complete |
| initial 目标 | 验证输入但不增加 Host 执行 |
| References 继承与覆盖 | first 保留 Check 原文；second 的中文问题说明为“第二输入场景” |
| 显式基础页与资源归属 | 场景页指向基础原文；基础页保留 Check digest/base，覆盖页归 Objective |
| 公开 validate artifact | 准确闭包有效，无业务执行 |
| objectives.yaml 声明调用 | 公开 probe 得到 ready 与正确局部问题 |
| 中文 CLI 指导 | 输出真实场景化页面 |
| regulate terminal | 目标已满足，iterations=0，未调用禁止执行的 Agent |
| 删除原交付来源后 continue | 同一 regulation 恢复成功，准确 source 与原记录一致 |
| API 离线恢复 | 从已验证缓存恢复同一来源闭包 |
| 新缓存且来源已删除 | 明确失败 |
| 已缓存 Check worker 缺失 | 明确失败，不修复或替换 |
| 已缓存 Reference 篡改 | digest 不符，明确失败 |

最后三个失败场景均未增加 Host 执行。regulation 真实记录为 schema v6，
没有伪造 Git commit 或 npm packageDigest。Host 只处理执行目录和 revision；
当前消费者使用真实、鉴权的 loopback HTTP Host，不以本地函数替身代替服务。

## 清理、复验与限制

复验入口是 [verify-consumer.mjs](./verify-consumer.mjs)，消费者代码为
[consumer.mjs](./consumer.mjs)。在本候选的干净 checkout、已有构建输出和
离线工具依赖缓存的同类 Windows 环境执行：

```powershell
node .silvermoon\ideas\01M607XBNKWQDZAC6EPTZ474NH\outer\verify-consumer.mjs
```

每次生成新的仓库外目录和作者输出，完成后关闭 Host、kernel 和权限 helper，
核对操作 UUID 标记后删除该外部目录，并以 ENOENT 验证删除成功。
新结果默认写到忽略的 `.cache`，不会覆盖本次原始证据。

首次验证在离线安装前发现 `pnpm config get store-dir` 返回 undefined，明确失败；
仅将 Outer 脚本改为使用 `pnpm store path` 的真实解析结果，重新同步后才取得本次
15 场景成功。首次操作的外部目录和作者输出均已清理，没有修改 accepted Inner。

本阶段没有修改生产代码、accepted Ideal 或 Inner；它们的准确修订保持不变。
主体阶段最终 `pnpm check` 及八项定向组合/公开集成测试已通过。
Objective 当前消费本地目录，Check 的 HTTPS 能力沿用首项；本次不宣称测试了
Objective 远程分发，不发布 npm/Release，也不提前完成第三项内置迁移。
