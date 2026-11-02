# Deployment

前置 Idea 已 completed，本轮实现 `90a038df8d54259a0d17d7fecd8999a804ed6f04`
已接受。现在仅使用受控本地生产 tarball、测试 HTTP 来源与独立临时数据域验证；
不发布 npm，不使用或覆盖用户既有数据库。证据区分生产包独立消费、真实浏览器和 workspace 崩溃集成。

## Steps

### D-S01: 验证独立 Bundle 消费

在不含作者 node_modules 的消费环境中，从受控来源获取打包产物，
经公开提交接口运行，记录制品 URL/Digest 与可观察结果。

同步本计划后运行既有 `node scripts\check-packages.mjs --task-sdk` 及 `--task-bundles`：
验证独立作者构建进程真实退出后依赖不可用，故意依赖 SDK 的负对照确实失败，
自包含 Worker 及真实 Check/Probe 在不含 SDK/Check/Probe 的生产宿主中仍可执行。
运行 Web UI 的 Chrome 隔离冒烟；UI 是私有 workspace，不冒称 npm tarball 消费。

### D-S02: 验证跟踪与重启连续性

以同 Bundle 多 Request、准备期间重启、long poll 和终态查询验证公开链路，
确认请求身份不变、独立受理结果可追踪，完成后关闭验证用服务与资源。

复跑 storage 的 `bundle-admission.test.ts`/`format.test.ts`、HTTP 的 `bundle-admission.test.ts`、
server 的 `bundle.test.ts`，以及 Check/Probe 的 restart/resource-release 场景。
检验真实子进程崩溃、窗口资格、preparing 不占 Task 预算、终态保留、缓存缺失历史读取、
旧 v4 拒绝且字节不变。浏览器和 HTTP 断开只结束观察，不取消 preparation。

## Acceptance criteria

### D-AC01: 发布形态可用

以独立环境的命令、产物摘要和公开响应证明 Bundle 无预注册即可消费，
不在消费者运行包安装或构建钩子。

生产消费者及浏览器命令退出 0，保留正/负对照、同名不同 Digest、准备状态与最终结果的证据。
不能用安装作者依赖的源码直连代替；Worker 隔离不作为安全沙箱声明。

### D-AC02: 公开跟踪结果可信

以 requestId、响应和重启前后记录证明准备可恢复且只创建一次 Task，
preparing 与 Task 时间分离；验证资源已清理、既有用户数据未受影响。

复跑场景全部通过，给出实际命令、退出码、交付提交及验证边界；
最终关闭自有 HTTP/Worker/浏览器并清理自有 profile/临时数据库，不改历史用户数据或前置 Idea。
