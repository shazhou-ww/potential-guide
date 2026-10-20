# Objective 契约交付验证

## 公共 schema

[Pages run 39462410887](https://github.com/shazhou-ww/potential-guide/actions/runs/39462410887)
在源码提交 `fd38533e3c206a9e6993a640e28dc1e434ba0393` 完成构建及部署。
主协调者在实际网络获取中验证以下 URI 均返回 HTTP 200：

| 格式 | URI | SHA-256 |
| --- | --- | --- |
| Objective | https://shazhou-ww.github.io/potential-guide/schemas/objective/v1.json | `6a6399d5a08255902484abb85813101fc1a04afc40874b9a1b4ac39bcfead13f` |
| Objectives | https://shazhou-ww.github.io/potential-guide/schemas/objectives/v1.json | `1137c3e719d9df97faff408f5e17236f4e2b98e85bcda397945785995975430a` |
| Agents | https://shazhou-ww.github.io/potential-guide/schemas/agents/v1.json | `bf6f4e634b0167cbd6302ab56e3a6c56f798c4855e565795e74dbe55c2ed9cba` |

每份响应按字节等于仓库定义，以及对应协议包或 cli-core 公开子路径的包内副本。
随后使用实际发布索引对内存中的更改与删除候选执行不可变检查，分别明确失败；
没有改写远端定义。主协调者直接运行发布构建检查也返回 0。

## 实际独立消费

本地短路径 Windows 工作区的 `pnpm deployment:verify` 返回 0，经过 16 个包、
九种隔离安装场景及实际 shim，验证 CLI 发现、目标观察、治理、持久化恢复、
planner/supervisor、权限拒绝和当前 ceiling 撤销。工具使用新 Objective 入口与引用。
协议独立消费还执行已安装的迁移工具，证明不改写输入且拒绝覆盖既有输出。
这不是 npm 已发布的证明。

[CI run 39462606984](https://github.com/shazhou-ww/potential-guide/actions/runs/39462606984)
针对代码 `f3d80b3e2d1a1672f721998cb6447a5032270bc3` 的实际打包部署作业：

- Ubuntu：job `118765903816`，success。
- macOS：job `118765903505`，success。
- Windows：job `118765903444`，success。

这些部署作业通过不代表该次 CI 整体通过。Ubuntu Node 22/24 完整测试同时暴露
Agent 嵌套测试生命周期及紧进程测试期限问题；后续修复和完整通过记录见下节。

## 最终完整验证

[CI run 39469580773](https://github.com/shazhou-ww/potential-guide/actions/runs/39469580773)
针对源码及实施证据提交 `e906e0fa27d9a3317fbed453006657b81894a371`，
整体 conclusion 为 success，五项作业全部成功：

| 作业 | Job ID | 结果 |
| --- | --- | --- |
| Ubuntu Node 22.13.0 完整检查 | 118789998971 | success |
| Ubuntu Node 24.11.1 完整检查 | 118789999035 | success |
| Windows 实际 tarball CLI 消费 | 118789998849 | success |
| macOS 实际 tarball CLI 消费 | 118789999061 | success |
| Ubuntu 实际 tarball CLI 消费 | 118789999101 | success |

修复包括明确等待 Agent、AHP 和 monorepo 的嵌套 TestContext 子测试，
以及将真实进程准备与精确期限断言分离。期限测试保留 199ms 未到期、
200ms 到期、调用故障及 PID/临时目录清理断言；生产预算、权限和路径语义未改。
本轮改动涉及的 29 个测试文件经 AST 扫描，不再存在嵌套全局 test 注册。
主协调者也在 Windows 执行了新鲜 Pilot 46/46、Agent 9/9、AHP 10/10、
monorepo 43/43 和最终组合 pnpm check。

最终提交与后续门限记录只增加生命周期/交付文档，不把任何未测试的业务代码
混入上述成功来源；验收针对同步后的准确 Deployment revision。

## 验证工具修复与环境边界

主协调者在真实消费检查中修复 `2e92f07` 两处验证工具问题：初始 help/metadata
调用也使用隔离用户目录；独立 objective-contract-migrate 不被误当成
pguide-command-v1 子命令。后者的实际功能由协议独立消费验证，不以跳过功能测试替代。

极长 C 盘 session 路径中的本地 Git fetch 失败，换用本次自建的短 D 盘工作区后
完整部署验证通过。没有为绕过环境问题更改生产路径或 Git 来源语义。
原用户目录和未提交工作保持隔离。主协调者还在独立 overlay 工作区应用原始 stash，
无冲突恢复全部八个原有文件；health/self-check 生成一致性、pguide 依赖构建与
直接相关测试 25 项中 23 通过、2 个平台跳过。原工作区恢复在门限完成后执行，
这些用户修改不纳入本次业务提交或冒充远端 CI 的来源。
