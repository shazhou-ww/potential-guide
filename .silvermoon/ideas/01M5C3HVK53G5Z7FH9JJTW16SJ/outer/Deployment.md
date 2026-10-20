# Deployment

部署对象为已接受的 Inner `61ecfc89b1208bca68ca7ec98e8caf2adf4f77ea`。仅授权本机全局命令接线与独立安全消费者验证，不发布 npm、不调用真实模型/凭据、不执行真实发布目标，不修改 accepted Inner 或产品代码。可重放步骤见 [Validation-plan.md](./Validation-plan.md) 与 [consumer-validation.mjs](./consumer-validation.mjs)。

## Steps

### D-S01: 验证独立消费者的目录目标

在安装好的 CLI 上，使用非 pnpm 仓库的根目录、普通子目录和两个 checkout 验证统一发现、Unit/参数化输入、probe 与受控 regulation。

先把本计划和验证资源普通同步到 primary，重新观测精确 deploymentRevision，再重建已接受产品的 dist。检查既有全局 junction 指向本 worktree，仅为新增 pguide-objectives 使用本机 npm 自带 cmd-shim 接线；不得覆盖未知命令或迁移真实用户目标。消费者通过全局 pguide.cmd 及其命令发现入口运行，配置、状态与假 ACP 均隔离于操作拥有的 fixture。

### D-S02: 验证跨目录依赖与恢复

使用安全 fixture 验证仓库目标发现多个目录目标、依赖交接与重新观察；实际修改 Pilot 目录资源和仓库无关内容，验证持续跟随与目录内容版本，记录 commit、tree OID 和可重放命令。

实际运行全局发现的 supervise，不编辑 portfolio：先观察无关提交，再修改根检查脚本，最后仅修改独立依赖仓库；同时验证多目录依赖由消费者决定 terminal 阈值、根 Regulation 交接且不调用根修复 Agent、子目标推进后重新观察根。continue 必须在来源和同名声明改变后保留原 commit/tree 与 subject，旧记录明确拒绝。

### D-S03: 验证部署边界与清理

记录原有全局命令和用户配置不变；所有 subprocess 有硬超时，supervise 有运行期限并正常取消/释放。只清理本次命名 scratch、检查 fake Agent PID 已退出与来源缓存已释放，保留精简可重放证据，不记录凭据。若发现产品缺陷，停止部署并向父 agent 请求回到实现门限，不在此阶段修产品。

## Acceptance criteria

### D-AC01: 技术栈无关的发现与绑定可用

消费者证据显示目录无需包清单，不同 checkout 目标互不混淆，Unit 可省略输入且拒绝额外参数；用户级/目录级均可参数化，缺失声明、无效输入或投影及来源失败均明确报错。

证明全局 objectives 扩展在已配置 commandDirectories 被发现；列举/详情不启动检查、Agent 或远程解析；同名必须消歧；根 relativePath 为 "."，普通子目录为相对路径，用户文件位置不替代调用上下文。

### D-AC02: 实际依赖推进无隐式副作用

受控证据证明发现不启动 Agent、probe 不修复、Supervisor 推进后重新观察根目标；Pilot 资源更新触发新绑定，无关提交不改变其内容版本，旧结果不解除新需求；重启后仍能以来源 commit 取回目录 tree，旧恢复记录按声明策略迁移或明确拒绝；未选择的发布目标不执行。

证据同时包含实际 Git commit/tree 对照、多来源版本表、持续全局 CLI 根脚本与 dependency-only 更新、未编辑 portfolio 的证明及 continue 固定快照。独立执行环境/安装的公共桥接库不伪称被 Pilot tree 覆盖。

### D-AC03: 全局数据与资源所有权可审计

除新增 objectives 三个 shim 外，原命令及真实用户 config/objectives 文件保持不变；实际用户别名不自动猜测或迁移。安全 fixture 只访问自己的标记文件，无真实模型/发布；有界取消后无存活 fake Agent，来源缓存释放，命名 scratch 针对性清理成功，结果与限制持久保存于本 Outer。
