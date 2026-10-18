# Deployment

本次交付为修订后的 setup Objective 及当前用户可用的本机 pguide 配置，不发布 npm，也不连接未指定的远端设备。

此前交付结果见 [历史交付证据](./Verification.md)，本次修订的本机真实接入需另行验证。

## Steps

### D-S01: 同步并验证子目录交付

将已验收实现同步到 primary，使用精确 commit 的 Git 子目录 URI 加载并验证 setup Objective。

### D-S02: 验证安装产物与隔离运行

验证现有安装产物并在本机运行真实 Copilot sanity，记录持久配置位置、执行结果和限制。

## Acceptance criteria

### D-AC01: Git 子目录可用

已提交的 setup manifest 可从 Git URI 读取，引用与执行路由正确，提交可从 primary 到达。

### D-AC02: 交付验证通过

安装产物验证与本机真实 Agent 隔离 sanity 成功；远端只声明通道测试，不宣称未知设备已配置。
