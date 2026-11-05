# Deployment

## Steps

### D-S01: 通过 Pinboard 发布检查 CAR

通过标准流程检查三个 CAR，使用 `pinboard import <archive.car> --name <label>` 发布到用户的 Pinboard，核对返回 CID 与本地构建 CID 一致。Pinboard 是公开 IPFS 存储，仅发布确认可公开的自包含检查制品，不上传仓库、凭据或私有配置。记录提交、工具版本、制品名称和 CID；不发布 npm 或代管生产服务。

### D-S02: 验证实际结果与结束状态

在作者源码之外的隔离消费环境，验证 Pinboard 上的 CID 可获取，再向运行中的 Task Engine 提交三个检查。使用受控工具、目录与本地网络端点分别观察通过和不满足要求的结果，验证取消和故障不伪造检查结果，并确认资源释放；另由独立作者项目消费打包后的共享 Check 包生成最小新检查，记录消费者操作证据。

## Acceptance criteria

### D-AC01: Pinboard 制品可按原 CID 独立执行

Pinboard 返回的三个 CID 与本地构建一致，独立环境可获取并由 Engine 消费，无需作者源码或旧 Host；还能按实际 CID 读取各检查的说明与问题 Reference。以发布回执、内容获取及实际请求、Run 身份和最终状态证明，不能仅以构建或上传成功替代。

### D-AC02: 消费者结果与资源行为符合契约

环境检查与独立作者的新检查均保持 `{pass:true}` 或非空问题列表，执行异常进入失败，取消不会生成业务失败结果；以观察记录和物理释放证据验证。独立作者使用共享包的实际打包产物，不依赖仓库内部源码路径；无可用环境时明确报告阻塞而非声称通过。

当前独立消费证据与 Pinboard 认证阻塞见 [部署证据](./Deployment-evidence.md)。
