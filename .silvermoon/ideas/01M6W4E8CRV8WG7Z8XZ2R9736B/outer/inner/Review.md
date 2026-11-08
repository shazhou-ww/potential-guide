# 实施门限评审

用户已明确委托本会话自主审查 Silvermoon 各阶段门限。本记录不豁免测试，
也不把实施通过等同于真实部署完成；准确 revision 的接受仍由事件记录。

## 审查范围与结论

已对照接受的 Ideal 检查两阶段准备/编译、Check 作者格式迁移、生成 Schema、
完整 CAR/子 CID/binary 验证、publication 固化、Probe 阶段和文档覆盖、
独立子 Task 调用，以及错误与取消传播。

结论：当前实现满足 Inner 契约，可提交并在准确同步 revision 上接受，
随后进入 Outer 的独立安装和实际 HTTP 交付验证。
没有改写已接受的 Ideal、旧 Objective attained-Level 契约或通用 Engine 业务边界。

## 发现并修复的问题

初版调用器仅处理 submit 返回 preparing 的情况；若提交已持久接纳但 HTTP 响应丢失，
或后续查询失败，未取得 taskId 的父调用可能遗漏子 Task 的取消。
此问题已阻止初版验收，并由实施 agent 修复：

- 按原 requestId 在独立有界清理窗口内恢复接纳结果；
- 重试暂时失败的查询与取消，校验返回的 Task 身份；
- 永久失败或未完成清理明确报告未确认，保留原始和清理错误；
- 补充响应丢失、查询失败、取消失败、永久不可用及永不返回的回归。

同时修复 JSON reader 清理错误被忽略，以及将未知 Task result 双重断言成
CheckResult 的问题；现有内容支持包的 README 已更新为实际使用边界。

## 独立核对的证据

- 父级审查了关键准备、契约、内容读取、结果装配与调用代码，
  并核对 [Evidence](Evidence.md)所列完整检查日志的 SHA-256：
  `dd387c591014753ce31c1dcb21d11ebce72a3c1dccb6757cc205cc8ec704a9c5`。
- 使用当前 Windows 候选独立重跑正确的 package-scoped 测试：
  `pnpm --filter @potential-guide/probe-sdk --filter @potential-guide/ipfs-content --filter @potential-guide/check-sdk test`，
  进程退出 0；Probe 14/14、Check SDK 9/9 通过，内容支持测试按原有条件执行。
- 首次直接从仓库根执行跨包 tsx 测试时，fixture 的 cwd 依赖解析失败；
  改用各包正式 test script 后通过。没有因此修改测试、增加 skip 或掩盖失败。
- 完整 `pnpm check` 的成功环境是同源候选的隔离 WSL/ext4 副本；
  不是声称 Windows 已取得原本缺失的符号链接权限。
  局部 store 解决共享 store 损坏阻断，未修改共享 store 或全局配置。
  复跑和安全清理方法见 [Validation](Validation.md)。

## Outer 仍需独立证明

使用精确源码提交打包并在独立消费者安装，真实传输完整 Probe DAG，
执行首阶段失败、后续失败和 terminal，实际读取覆盖/继承文档，并确认子调用回收。
真实 Pinboard 旧 publication 被正确拒绝是兼容性证据，不是新格式 publication
成功交付的证据；外部指针更新或发布不得被默认为已发生。
本地私有 SDK 的 pack 验证不意味着 npm 发布已获授权或已完成。
