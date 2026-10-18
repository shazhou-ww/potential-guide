# 权限支持验证记录

## 领域与调度

regulator 导出 PermissionGrant、RegulationPermissions、AuthorizationRequest 和 makeRegulationPermissions。ceiling 定义规则，grants 只引用其 ID，缺省为空；同名 ID 不允许自行替换管理员规则。文件规则支持 read/edit 与明确资源，execute 规则匹配明确命令，不以 cwd 或前缀声称沙箱安全。

normal outcome 增加 authorization-required。Agent 调用后仍先观测：达标优先，有实际推进时允许替代路径；没有推进且仍有授权需求时优先返回授权受阻，包括最后允许的一轮。时间中断可以保留请求并返回 exhausted。

coordinator 支持权限快照和 permissionUpdates。重复策略、普通优先级、队列序号或资源变化不应解除相同阻塞；有效授权或执行计划变化才重新观测与执行。撤销会安全取消，非法策略暂停启动。planner 不能批准权限。

## ACP、配置与恢复

默认拒绝未知和不完整请求，明确匹配才选择 allow_once。检查文件规范路径、符号链接和多路径一致性；真实 Copilot 的 fileName/unified diff/locations 需要交叉验证，拒绝重命名、多文件混入和不一致路径。

CLI 通过 regulationPermissions 配置授权，持久继续执行使用当前可信配置而非复活旧 ceiling；进程 worker 和 supervisor 传递同一不可变快照。权限事件有结构化原因，不从模型文本推断授权。

## 已完成的真实验证

Windows 当前用户已有 Copilot 认证，启动配置不含 allow-tool、allow-all-tools 或 allow-all-paths；没有复制秘密，没有修改用户默认授权。仅对临时目录内一个 marker 文件给出 edit ceiling，grants 初始为空。

真实拒绝 run `6639e7f6-cd54-4d30-bc22-476ad1522beb` 返回 exit 3、authorization-required、operation=edit、reason=not-granted，包含确切 marker 路径；文件未生成。

仅添加该规则 ID 后，新会话 run `8b2c5155-e79c-405a-a89b-b05bc0c20c13` 一轮达到 target-reached，独立 probe 验证随机内容。实际事件为 pguide/permission_decision 的 allowed-once、explicit-grant，证明不是启动参数绕过权限。

首次原 session 继续执行时 Agent 仍记得先前拒绝而未再次请求；此问题单独修正为在 prompt 中传达本次有效授权，并说明旧拒绝不代表本次授权。这不是授权凭证，仍须逐次通过策略判断。

修正后再次继续原 regulation，session `67992282-dfd1-479f-bc63-e349541ede43` 与初次拒绝一致，resumeMode=resumed，一轮 target-reached 且独立内容检查成功。相同会话的事件先为 denied/not-granted，后为 allowed-once/explicit-grant，验证了真实授权变化后的恢复。

## 最终实现门禁

主会话执行完整 pnpm check，226 项测试中 224 项通过、2 项环境相关跳过、0 失败。regulator 38、supervisor 31、cli-core 23、config 5 项通过；pguide 68 项中 66 通过，两项跳过分别为平台路径敏感性及 Windows 文件符号链接权限。目录链接逃逸测试实际通过。构建、类型检查、格式、lint 和八包打包验证均通过，lint 保留非阻断警告。

一次全量运行暴露 supervisor 定时测试依赖固定时长；修正为等待明确 planner 反馈确认，并保留原反馈断言和超时边界，最终全量验证通过。没有通过删除断言掩盖失败。

I-AC01、I-AC02、I-AC03 均有自动测试、跨包与真实协议证据支持，主会话判定实现候选可提交验收。

## 安装验证

独立八包安装验证已通过真实形状的 ACP 测试替身，覆盖空 grants 拒绝、当前配置增加 grant 后 continue 成功，以及删除当前 ceiling/grants 后旧恢复记录不能再执行。此证据与真实 Agent 验证分别记录，不互相替代。

## 范围限制

ACP 只约束实际发起的请求，不是恶意 Agent 或 shell 的 OS 隔离；Agent 启动时预授权的工具可能不发请求。真实验证仅覆盖受限文件编辑，没有批准通用 shell。本轮不修改 setup Objective 的无换行标准，也不把权限验证当成该独立 idea 的终验。
