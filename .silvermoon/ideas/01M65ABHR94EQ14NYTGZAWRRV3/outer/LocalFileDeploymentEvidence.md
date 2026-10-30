# 本地文件扩展部署证据

本文件服务当前 Deployment.md。已验收 Inner 为
`5bea45766484d599e0a2bab86b25da05ec2447de`，
packages tree 为 `fb74721446963a327991a621d88e1ff14a8adc39`。
历史 HTTPS MVP 的 Evidence.md / verification/results.json 保留不变。

本次先同步更新的契约和 harness，再以准确 deploymentRevision 执行全新仓库外安装。
新结果将存于 verification/local-file-results.json；在实测成功前 D 项保持未完成。
新增真实 file 流程必须证明 file 不进入下载 hook、当前内容选择、缓存重授权、
路径拒绝、原文件替换/删除后的 SQLite 原字节恢复与 native helper/worker 物理结束。

## 父代理浏览器收据

[ParentBrowserReceipt.json](ParentBrowserReceipt.json) 是父代理提供的独立观测，
不是本代理的浏览器重跑记录。记录包含初次端到端观测、最终 app.js 文案修订后的
实际文件选择/上传/提交复测，以及完整脚本摘要。最终 app.js 为
`13C35233E5CE734C81CE747AC7068ED35BC141B1EE455EA69E0372267DA34B1E`。
父代理持有的 58865/58864 服务及其 SQLite/imports 不属于本次外部 fixture，
本代理不访问、停止或清理它们。环境摘要分库是会话组装的显式策略，旧 DB 未改写，
不冒充产品迁移或自动 fallback。
