# Deployment

## Steps

### D-S01: 通过 Pinboard 发布检查 CAR

通过标准流程检查三个 CAR，优先使用 `pinboard import <archive.car> --name <label> --endpoint https://pinboard.shazhou.work` 发布到用户的 Pinboard。用户恢复 MCP 授权而 CLI 仍缺少独立 token 时，可通过已授权 MCP 上传相同的完整单根 CAR，不复制或导出 OAuth 凭据。两条通道均须核对返回 CID 与本地构建 CID 一致。Pinboard 是公开 IPFS 存储，仅发布确认可公开的自包含检查制品，不上传仓库、凭据或私有配置。记录提交、工具版本、制品名称和 CID；不代管生产服务。

### D-S02: 验证实际结果与结束状态

依照用户追加授权，仅通过仓库 GitHub Actions 按 SDK、environment 顺序发布两个 npm 包并验证发布回执，不重复发布已有版本。在仓库之外的独立 Windows 消费者项目中安装明确指定版本的已发布 Check 与 Task Engine 相关包，保留已有配置和服务。使用 `https://pinboard.shazhou.work` 作为 IPFS Gateway，不以本地 Kubo 代替；在作者源码之外按 CID 提交三个检查，使用受控工具、目录与本地网络端点观察通过、问题、取消、故障及资源释放。保留独立作者项目消费实际打包产物生成最小新检查并实际执行的证据；不在设备上执行 npm 发布。

依据用户“那可以提交了，ubuntu 先不验了”的本轮范围调整，Ubuntu 设备的全套安装、CLI 入口和运行验证延期，不作为本次 Outer 提交或验收门限；不将延期记录为已验证，也不推断 acceptOuter 授权。

## Acceptance criteria

### D-AC01: Pinboard 制品可按原 CID 独立执行

Pinboard 返回的三个 CID 与已发布 CAR 根及既有本地构建一致，独立 Windows 消费者可通过指定公共 Gateway 获取并由已安装的 Engine 消费，无需作者源码或旧 Host；还能按实际 CID 读取各检查的说明与问题 Reference，并核对内容完整性。以已有发布回执、当前内容获取及实际请求、Run 身份和最终状态证明，不能仅以构建、上传成功或网站首页可达替代。标准 UnixFS/block Gateway 按 CID 解析资源可以作为读取证据；HTTP 路径返回 404 时仍须如实记录，不把该响应视为成功。

### D-AC02: 消费者结果与资源行为符合契约

两个 Check npm 包有 GitHub Actions 发布与 provenance 验证回执，独立 Windows 消费项目有实际安装版本清单和已发布 Engine 的运行证明。环境检查与独立作者的新检查均保持 `{pass:true}` 或非空问题列表，执行异常进入失败，取消不会生成业务失败结果；以观察记录和物理释放证据验证。独立作者使用共享包的实际打包产物，不依赖仓库内部源码路径。按同步后的当前部署合约重新执行公共 Gateway 和独立作者验证，不能用历史 Ubuntu 或仓库实现测试替代。授权或环境不可用时明确报告阻塞而非声称通过。

本轮范围调整、独立消费证据、延期事项与已知限制见 [部署证据](./Deployment-evidence.md)。
