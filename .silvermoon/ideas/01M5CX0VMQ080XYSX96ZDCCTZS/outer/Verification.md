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
Agent 嵌套测试生命周期及紧进程测试期限问题，正在修复；在后续完整检查通过前，
不完成本契约的最终门限。

## 验证工具修复与环境边界

主协调者在真实消费检查中修复 `2e92f07` 两处验证工具问题：初始 help/metadata
调用也使用隔离用户目录；独立 objective-contract-migrate 不被误当成
pguide-command-v1 子命令。后者的实际功能由协议独立消费验证，不以跳过功能测试替代。

极长 C 盘 session 路径中的本地 Git fetch 失败，换用本次自建的短 D 盘工作区后
完整部署验证通过。没有为绕过环境问题更改生产路径或 Git 来源语义。
原用户目录和未提交工作保持隔离，最终仍需恢复原始工作区修改。
