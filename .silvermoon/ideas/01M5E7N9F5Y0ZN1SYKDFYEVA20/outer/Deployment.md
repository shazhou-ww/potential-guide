# Regulation Coordinator 隔离消费验证种子

本任务的现实世界交付仅为新包本地构建、打包和隔离 consumer 验证，不发布 npm，不全局部署 pguide，不改设备配置或入口。package-settings 的独立授权不适用于此处。进入部署后先同步准确部署合同，再执行并记录证据。

## Steps

### D-S01 — 准备可消费的本地产物

按仓库既有构建/打包流程生成新包及所需 workspace 依赖的本地 tarballs，记录准确来源与产物身份，不推送 registry。

### D-S02 — 从隔离 consumer 验证

在本 worktree 内的隔离目录安装本地 tarballs，验证公开 ESM/types 和代表性长期调度、依赖、失败恢复与终止场景，不使用源码路径或全局链接替代包消费。

### D-S03 — 确认兼容边界并交付证据

从包消费边界验证现有 Supervisor 仍可用，记录命令、结果和清理情况，核实无全局配置/入口变化并交主 Agent 审查。

## Acceptance criteria

### D-AC01 — 本地产物完整可安装

打包清单及隔离安装日志证明新包 exports/types 与内部 workspace 依赖均可解析，产物可由非 monorepo consumer 消费，无 npm 发布。

### D-AC02 — 隔离运行符合新契约

consumer 执行证据证明驻留、命令到事实流、共享依赖唤醒/回收、可恢复失败和取消确认，且测试进程、订阅、执行句柄及隔离目录已受控清理。

### D-AC03 — 既有 Supervisor 和设备不变

同边界旧 Supervisor smoke/regression 证据及 diff 证明没有改接线或迁移旧服务；部署记录明确未执行全局安装、入口切换或用户配置写入。
