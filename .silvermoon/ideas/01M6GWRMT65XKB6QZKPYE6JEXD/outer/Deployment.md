# Deployment

旧 Inner `282fc60f2e22da55ae4e2775e4c62567d641fcb7` 的接受与 Kubo/publish
证据仅对应历史流程，不代表本次离线 CAR 候选已接受或复验。使用准确 tarball、
仓库外新建消费目录及非敏感样例；不发布 npm、不上传或 pin，不接管用户服务和配置。

## Steps

### D-S01: 验证独立作者 CLI

在仓库外安装准确候选包，通过 pguide 发现和独立 binary 执行 init、author check、
build 和 artifact check。覆盖显式入口、增删资源、LF/CRLF、binary 和失败重建；
记录 Node、包来源、精确清单、目录/CAR 字节及重复构建 CID，不要求 Kubo 或上传权限。

### D-S02: 验证仅凭 CAR 独立消费

将 CAR 交给不含作者源码的独立消费者，经公开 artifact API 校验，再以明确测试
block port 或自有 raw Gateway 提供其标准块，由调用方提交根 CID Request 给真实 Engine。
运行端仅安装必要宿主依赖，不能解析作者 CLI、TypeBox 或 SDK；验证同根 CAR 重排、
错误根/坏块拒绝、真实 Task 结果和物理退出，最后只清理本次拥有的进程和目录。

## Acceptance criteria

### D-AC01: 作者工作流独立可用

以命令、产物清单和重复构建 CID 证明不需顶层手写 task.yaml 或 include 更新命令，
pguide 与独立 binary 的 init/check/build 行为一致，构建不联网或发布。

### D-AC02: CAR 与执行边界可核验

以准确包身份、CAR 校验回执、根 CID、独立 Task 结果和退出事实证明只凭成品可执行；
目录与 CAR 来自同一快照，缺失/额外文件、坏哈希和错误期望 CID 明确拒绝。
同根不同块序不误拒绝；上传/pin 与 npm 发行均不在此验收范围，不编造发布回执。
