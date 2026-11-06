# Deployment

## Steps

### D-S01: 通过 Pinboard 发布检查 CAR

通过标准流程检查三个 CAR，使用 `pinboard import <archive.car> --name <label> --endpoint https://pinboard.shazhou.work` 发布到用户的 Pinboard，核对返回 CID 与本地构建 CID 一致。Pinboard 是公开 IPFS 存储，仅发布确认可公开的自包含检查制品，不上传仓库、凭据或私有配置。记录提交、工具版本、制品名称和 CID；不代管生产服务。

### D-S02: 验证实际结果与结束状态

依照用户追加授权，仅通过仓库 GitHub Actions 按 SDK、environment 顺序发布两个 npm 包并验证发布回执。在授权 Ubuntu 设备安装已发布的全套 Task Engine 与两个 Check 包，明确指定版本，保留已有配置和服务。使用 `https://pinboard.shazhou.work` 作为 IPFS Gateway，不以本地 Kubo 代替；在作者源码之外按 CID 提交三个检查，使用受控工具、目录与本地网络端点观察通过、问题、取消、故障及资源释放。保留独立作者项目消费实际打包产物生成最小新检查的证据；不在设备上执行 npm 发布。

## Acceptance criteria

### D-AC01: Pinboard 制品可按原 CID 独立执行

Pinboard 返回的三个 CID 与本地构建一致，Ubuntu 设备可通过指定公共 Gateway 获取并由已安装的 Engine 消费，无需作者源码或旧 Host；还能按实际 CID 读取各检查的说明与问题 Reference。以发布回执、内容获取及实际请求、Run 身份和最终状态证明，不能仅以构建、上传成功或网站首页可达替代。

### D-AC02: 消费者结果与资源行为符合契约

两个 Check npm 包有 GitHub Actions 发布与 provenance 验证回执，Ubuntu 全套安装有实际版本清单和 CLI 入口验证。该设备上的环境检查与独立作者的新检查均保持 `{pass:true}` 或非空问题列表，执行异常进入失败，取消不会生成业务失败结果；以观察记录和物理释放证据验证。独立作者使用共享包的实际打包产物，不依赖仓库内部源码路径；既有本地独立消费证据可复用，但不能代替新增的 Ubuntu 公共 Gateway 验证。授权或环境不可用时明确报告阻塞而非声称通过。

当前独立消费证据与 Pinboard 认证阻塞见 [部署证据](./Deployment-evidence.md)。
