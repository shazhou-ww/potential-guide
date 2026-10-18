# Deployment

本次交付为 primary 中可被 Git 子目录引用的 setup Objective，不包含 npm 发布或对当前用户设备进行全局配置。

## Steps

### D-S01: 同步并验证子目录交付

将已验收实现同步到 primary，使用精确 commit 的 Git 子目录 URI 加载并验证 setup Objective。

### D-S02: 验证安装产物与隔离运行

执行现有安装产物验证，并使用本地 ACP 测试替身验证 setup 的端到端行为，记录范围和结果。

## Acceptance criteria

### D-AC01: Git 子目录可用

已提交的 setup manifest 可从 Git URI 读取，引用与执行路由正确，提交可从 primary 到达。

### D-AC02: 交付验证通过

pnpm deployment:verify 及 setup 隔离集成验证成功，明确测试替身不等同于本机真实 Agent 已认证或配置完成。
