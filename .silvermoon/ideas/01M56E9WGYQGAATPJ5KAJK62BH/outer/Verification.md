# 权限支持交付验证

## 交付范围

实现提交 `b4a0061024d25a3ccd3c84c4b4b7c44035703157` 已同步 primary，三个领域角色的权限边界、ACP 接入和 CLI 恢复已完成实现验收。本轮交付为本地可安装产物及真实 ACP 有界验证，不发布 npm、不连接未知远端、不增加用户默认权限。

## D-AC01: 安装产物

pnpm deployment:verify 将八个包独立打包安装，检查公开库导出及命令入口。新权限测试替身使用真实 Copilot 对应的 fileName/unified diff/locations 请求形状，未获得批准不执行写入。

实测验证顺序：

1. ceiling 中存在文件规则但 grants 为空：authorization-required，exit 3，marker 不存在。
2. 当前配置授予该规则后 continue：target-reached，marker 内容为 permission-verified。
3. 移除当前 ceiling/grants 并删除测试 marker 后再次 continue：重新 authorization-required，旧持久记录不能重新授予权限。

测试最终输出 `installed permissions deny, grant-on-continue, and current-ceiling revocation verified` 与 `deployment verification passed`。

## D-AC02: 真实 ACP

真实 Copilot 使用已有用户认证和当前运行时，在独占临时 Git 目标中验证。临时 Agent profile 不含工具预授权参数，不借助用户默认 profile 的 allow-tool=write；仅一次 run 的显式单文件编辑规则可放行。

相同 regulation `6639e7f6-cd54-4d30-bc22-476ad1522beb`、相同 ACP session `67992282-dfd1-479f-bc63-e349541ede43` 先拒绝，随后添加有效 grant 继续：各执行一轮，先 exit 3 authorization-required，后 exit 0 target-reached，独立 probe 核对随机内容。事件由 denied/not-granted 变为 allowed-once/explicit-grant。

真实试验中发现的旧拒绝记忆已通过当前有效授权快照提示解决；提示不替代真正的逐次权限判断。

本契约和证据同步后，对稳定 outer revision 再验证安装行为，以及真实拒绝/授权恢复；随后清理本轮独占目录及进程，仅在根 ledger 记录完成，不再改变此世界修订。

部署阶段再次验证：run `493ebbb2-1c77-4ec3-9792-31beb7219871` 首轮真实 edit 请求拒绝，exit 3、authorization-required 且 marker 不存在；添加同一精确文件 grant 后，原 session resumed 一轮 target-reached，独立内容核验通过。安装拒绝、授权恢复和撤销场景也再次通过。

## 已知限制

验证平台为 Windows；文件符号链接自动测试因系统权限跳过，目录链接越界测试实际通过。ACP 不是 OS 沙箱，无法约束不请求权限的预授权工具或恶意 Agent。本轮没有批准 shell 任意执行，也没有更改 setup 独立 Objective 的无换行校验。

既有 setup idea 的其他遗留项与本次权限交付分开处理，不通过本门禁自动结案。

保留会话可能自行记住拒绝并不再发起请求；一次这样的额外观察返回 exhausted，而非 authorization-required。没有新的结构化请求时不会从拒绝文本猜测授权状态。明确的请求链与新会话拒绝、原会话授权恢复均已实测；不能承诺每个模型在所有保留历史下都产生相同请求序列。
