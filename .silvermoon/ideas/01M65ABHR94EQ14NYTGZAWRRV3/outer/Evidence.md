# 独立消费部署验证

本文件服务 [Deployment.md](Deployment.md)，不替代部署契约。
已验收实现为 `4db53c32aa9765262fd0a67626eba114e5e08ae7`；
部署验证不得更改 Inner World 或生产源码。

本次通过 [verification/verify.mjs](verification/verify.mjs) 在此前不存在的仓库外目录
建立三个独立消费者。先将本契约与 harness 同步至 primary，再记录准确的被测试
deploymentRevision，执行真实安装及 HTTP/SSE/进程测试。
结果将由 [verification/results.json](verification/results.json) 保存实际 tarball 身份、
安装图、命令、API 观测、Worker exit/PID 记录和唯一标记目录清理证明。

尚未执行外部验证，D 项保持未完成；本准备文档不宣称部署成功或获得验收。
