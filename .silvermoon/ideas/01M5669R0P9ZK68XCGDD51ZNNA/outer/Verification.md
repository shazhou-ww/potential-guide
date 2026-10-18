# setup Objective 交付证据

## D-AC01: Git 子目录交付

实现提交 `1c6ab1beb863a6ee56a61c78d99c23e9c1a046ba` 已同步到 primary，实现验收在 `f20bdf7a5d5009163ab68b3475c52cc6cfb34a81` 记录。

2026-10-18，主会话通过生产 withPilot 源适配器从以下真实 HTTPS Git URI 读取精确实现 commit，成功校验身份、版本、全部 manifest/Wiki 和 check 路由：

```text
git+https://github.com/shazhou-ww/potential-guide.git#objectives/pguide-setup/pilot.yaml
```

返回版本为上述实现 commit，等级为 initial、installed、configured，语言为 zh-CN；读取过程中没有执行真实设备修复或调用付费 Agent。临时 Git 源作用域已自动清理。

## D-AC02: 独立安装与实际 sanity

`pnpm deployment:verify` 在 Windows x64 上通过，八个本地包独立打包安装。新增验证在独立 Git 仓库提交 setup 子目录，用安装后的 pguide 经 `#objectives/pguide-setup/pilot.yaml` 精确 commit URI 完整观察设备就绪目标。

使用本地 ACP 测试替身，根据实际 pguide prompt 的 subject 写入本次随机 nonce；独立校验 terminal、无问题及精确源版本，不以 Agent 自报完成为证。验证最后输出：

```text
installed pguide loads committed setup subdirectory and verifies real nonce repair
deployment verification passed
```

部署契约与本证据同步后，再对稳定 deployment revision 执行同一安装验证和 HTTPS 读取，结果通过后完成根 ledger。

## 边界

本轮发布的是仓库中的 Objective，不是新的 npm 版本，也没有新增 pguide setup 命令。没有对当前设备执行全局安装、覆盖用户配置、导出凭据或发起真实模型请求。测试替身证明执行链，不代表真实用户的 Agent 已经配置完毕。

环境变量认证在隔离 Git probe 下可能报告 environment-unavailable；直接 setup-check 可在用户显式授权的环境中运行，未削弱现有 probe 的环境隔离。已有文件认证路径可用。POSIX 分支未在本会话运行。
