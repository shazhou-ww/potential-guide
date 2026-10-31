# 自有独立消费者验证方案

本文件服务 D-S01/D-S02 和 D-AC01/D-AC02，不修改已接受 ideal/inner。

## 制品与环境

从已接受代码打包 task-protocol、task-engine、HTTP/SQLite/Server、
check-artifacts/check-runtime-files/check-task/probe-task 的完整生产依赖闭包。
仓库外自有非 Git 消费目录通过 file tarball 安装，不 symlink/import 仓库 src；
记录原 commit、每个 tarball SHA-256、依赖锁文件及真实 installed 路径。
Checker/Objective 同样通过已安装公开制品构建入口生成真实归档。
只授权自有 file 根、loopback Task HTTP 与自有 HTTPS Checker 归档服务；
Objective 输入及内嵌 Checker 遵循既有 HTTPS 约束；不把 source 支持 file 当作 Probe 输入支持 file。
自有证书仅通过 NODE_EXTRA_CA_CERTS
加入当前验证进程，不关闭 TLS 校验、不修改系统信任库，不连接未知服务或使用现有用户数据库。

## 场景与判据

| 场景 | 外部观察 |
| --- | --- |
| Check 完整复用 | 制品已读但准备尚未返回时接收新需求；只有一份准备、同一完整 Run、旧 Checker 内容及业务 Execution 子证据 |
| Probe 完整复用 | 同一准备中 Objective 在 URL 内容改变后仍固定旧 root/Checker；接收方共享父 Run，不独立准备 |
| 精确版本 | 新 pin 使用明确内容 digest；错误 digest 拒绝，不混入兼容需求 |
| 服务/source | Caller scope 由静态认证映射产生；跨 scope 查/取消/历史拒绝，未授权 source 在读取前拒绝 |
| Never/取消 | 任意业务 payload 拒绝，但独立取消可用；指定 Run 不终结另一同类型 Run |
| 测试业务消息 | 同 ID 追加只有一次实际接纳效果；目标拒绝，不改另一共享 Task 原 Input/deadline；过期投入撤回，终结后不能继续投递 |
| Worker 故障 | 自有进程内 crash/hang、Engine HTTP 响应、按需新代际、旧 Run 调用次数不增加；未知回收不伪造成功 |
| 宿主资源 | 未 await 的已启动动作与仍存活句柄各有门闩；动作/证明完成前无 reclaimed/waitRelease 成功 |
| SQLite 真实重启 | 独立 Node 进程使用同一自有数据库/同一 installed 制品，原 Check/Probe 结果和历史可复验，不重跑旧业务 |

驱动、类型模块与实际观察结果作为本 Outer 的支持物同步；先同步此标准再运行。
失败与重试分开保留，不删除不利证据或通过改变已接受代码取得通过。
故障消费者允许按自己的 child handle 结束整个自有进程，但不把该清理称为旧 Run 已回收。
限 Windows x64/Node 24；不承诺 OS 安全沙箱、跨故障 exactly-once 或生产 Regulator 已注册。
