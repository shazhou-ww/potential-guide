# Regulation Coordinator 隔离消费验证

本轮验证已接受的 implementationRevision `764bdf07cd0496708947495ae96c8b70f1bdc382`，运行时代码来自提交 `344136c5b47bd4a55663b23089efd7dd7cedef6b`。先同步本契约与验证脚本，再针对该固定契约执行隔离消费；旧 [Evidence.md](./Evidence.md) 与旧 verification 文件只对应此前交付。

验证入口为 [verify-behavior.mjs](./verification/verify-behavior.mjs)，隔离进程使用 [behavior-consumer.mjs](./verification/behavior-consumer.mjs)。只从公开包入口读取/运行，不导入工作区源码；真实 Node 子进程提供进程终止证据，测试观察载荷不冒充真实 Agent 或业务环境的达标证明。

## Steps

### D-S01 — 固定版本并准备隔离产物

核对 inner tree 与已接受版本一致，构建并打包 effects/coordinator 的内部依赖闭包，记录各包版本、源码 Git tree 与 tarball SHA-256。在仓库外的临时 consumer 写入独立 manifest 后安装 tarballs，验证所有内部包的实际解析路径在 consumer 内；不发布 npm、更改设备配置或全局入口。

### D-S02 — 验证公开契约与观察结果

验证声明类型与公开 ESM 入口。首次 consumer 从 no-resource 切换配置后执行真实 Node 子进程，核对 initial 无执行、准确请求归属、观察/终结与视图、资源拒绝及旧入口空 scope smoke。退出后另起 consumer 进程，从真实文件快照恢复相同请求，核对零重复启动且状态版本不回退。另以明确标注的未核实执行 fixture 验证恢复保持占用、不虚报退出或重复启动。

### D-S03 — 记录证据并清理

在新证据中记录契约版本、产物身份、消费者结果与清理情况；确认临时安装、快照及进程均已清理。区分真实进程/文件恢复、fixture 观察及尚未实施的中央网络/真实 Agent 集成，不引用旧结果冒充本次通过。

## Acceptance criteria

### D-AC01 — 包可独立消费

隔离安装、公开 ESM 入口和声明类型检查通过；递归内部依赖版本正确，实际路径不逃出 consumer，源码 tree 与产物摘要可关联本次接受的实现。以脚本的解析断言、类型检查与打包清单证明。

### D-AC02 — 行为与观察可核对

独立进程记录证明 initial 不启动、资源意图与实际执行分离、固定请求关系可查询、退出后才结束；文件重启恢复同一已完成请求不再启动 runner。未核实 fixture 仍占槽，Host/Objective/Target/Request/Run 视图与纯重放结果一致，共享请求满足仍不凭本地结果假定。用 consumer 断言及两次进程输出证明。

### D-AC03 — 证据与清理完整

新结果包含旧入口 scope smoke、真实 child 启动/退出计数、store scope 清理、临时目录删除确认和完整产物身份；所有验证进程退出。无 npm 发布、全局入口或设备配置变更；实现阶段独立 check-host 用例超时仍按实现验收时披露的范围处理，本轮不借部署验证宣称全仓检查通过。
