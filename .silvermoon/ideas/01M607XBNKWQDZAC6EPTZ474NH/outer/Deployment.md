# Deployment

## Steps

### D-S01: 准备真实组合与文档场景

先同步本契约与复验脚本到 primary。作者显式构建两个独立 Check 和两个数据 Objective，将交付目录与本地工具 pack 复制到仓库外新建的操作拥有目录；消费者离线安装工具，不使用源码链接、NODE_PATH 或 loader hook，不安装或隐式构建业务制品。记录来源提交、准确摘要和消费者模块位置。见[复验入口](./verify-consumer.mjs)与[独立消费者](./consumer.mjs)。

### D-S02: 验证业务入口与恢复

通过真实隔离 HTTP Host 和已安装的公开 CLI/API 验证累计等级、依赖观察、References 继承/覆盖/基础原文，以及已满足目标的零 Agent regulation。删除原交付来源后恢复同一任务，比较准确闭包和 Host revision；损坏缓存或缺少准确内容必须拒绝，不增加执行或静默替代。关闭本操作的服务与权限 helper，核对拥有标记后删除外部目录，仅保存脱敏证据。不发布 npm/Release，不修改已接受的 Ideal/Inner。

## Acceptance criteria

### D-AC01: 使用者获得正确等级与指导

记录 Windows/Node/pnpm 环境、仓库外路径、工具 pack 摘要及实际模块 realpath，证明无源码依赖。API 与公开 CLI 实际获得 initial/ready/complete 等级及真实依赖问题；未覆盖说明继承、第二局部引用的中文说明覆盖、显式基础原文及资源归属均正确，initial 目标不执行 Check。

### D-AC02: 恢复不漂移

保存 regulation v6 及恢复前后的准确 Objective/Check/Host 闭包，证明来源删除后从已验证缓存恢复同一任务；新缓存缺失来源、Reference 篡改和 Check 缺失均明确失败，不增加 Host 执行。证据同时记录服务关闭、权限 helper 退出和外部目录删除。本项仅使用本地 Objective 来源，不把它描述为正式托管或跨平台验证。
