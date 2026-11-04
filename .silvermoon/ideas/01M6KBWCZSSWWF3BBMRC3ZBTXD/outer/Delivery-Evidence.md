# 独立 CAR 交付证据

## 准确候选与检查边界

- 已验收实现候选：`93ad00d0fd901785d0d70177b67c1deb6b59245d`，Inner 修订保持 `0da2e9e970eb0e1d10ae8c4011f7010cdaff5e99`，Ideal 保持 `95ba1df289fdecbd971464ceca57a0ab8b129a8c`。
- 本次实际打包所在 commit：`c27a07b9c42e3e3c669b0df7ca2751d61815a6db`。脚本确认 `apps`、`packages`、`scripts`、依赖清单及 Turbo 配置没有偏离已验收候选；构建前后也没有改变实现交付物。
- 检查前已同步并重新观察的部署契约修订：`312909bba56d9a75041aa41720c39faa3a0ca01d`。该修订包含 Deployment 与三个可复现脚本；随后只追加检查结果、锁文件、本文与 ledger，没有改变被检查的方法或要求。
- 执行平台：Windows amd64、Node `v24.12.0`、pnpm `11.22.0`。实际六个运行场景发生在 `2026-11-04T16:25:48Z` 至 `2026-11-04T16:25:50Z`，均由真实 Worker 执行。
- [Delivery-Result.json](Delivery-Result.json) 保存完整包清单、版本、归档指纹、导入命令、Request、受理决定、Task、Run、47 条 Gateway 请求与 fetch 来源记录；未截断业务结果或失败事实。其 SHA-256 为 `8ec80b98c74cdf73b7149325c93e20e6b62e15a8cf6cd686c35746127a3d7705`。

## 隔离安装与离线作者

交付目录为 `.cache\official-car-delivery-02`。作者和运行消费者分别安装实际 tarball，而不是 `workspace:`、`link:` 或仓库源码。内部归档共 11 个，每个归档的准确版本、字节数和 SHA-256 均保存在结果的 `context.archives`：

- Bundle、Engine、Engine HTTP、Engine Server、Engine Storage、Task Protocol、Task SDK、artifact-files：`0.1.0-rc.0`。
- cli-core：`0.3.0-rc.0`。
- check-artifacts、check-runtime-files：`0.1.0`。

作者仅直接安装 Bundle；运行消费者仅直接安装 Engine、HTTP、Server，实际递归审计到 8 个内部生产包，解析位置全部位于运行消费者自身的 `node_modules`。pnpm 自身包内链接属于正常归档安装结构，不指向工作区源码。运行消费者无法解析 Bundle、Task SDK 或 ipfs-content；发布闭包没有 ipfs-content。

作者通过公共 `/build` 生成 CAR、通过库与 CLI `/artifact` 检查。作者网络拦截器记录为零请求，原始 `callback.mjs`、`task.yaml`、`payload.bin` 在生成后删除，作者 node_modules 在运行消费者启动前移走。运行消费者仅取得 CAR 与公开期望值，不读取作者文件或借用作者依赖。

保存准确的外部依赖解析快照：

- [Author-Consumer.lock.yaml](Author-Consumer.lock.yaml)：SHA-256 `4796f88ad3bd78c8a799b85b5615048306ca07e96f125da8652a1bbf5c9eda44`。
- [Runtime-Consumer.lock.yaml](Runtime-Consumer.lock.yaml)：SHA-256 `73266911bb0d457adb33671fd45818659411a7a01ecd42bd94dc992af2682035`。

这些快照中的 `file:` 指向本次归档，属于测试安装输入，不是源码链接，也不是 npm 已发布的证明。

## 外部工具、CAR 与持久保留

独立导入工具是系统已安装的 Kubo CLI，不是 Bundle 导入 API、测试 MemoryIpfsClient 或生产 ipfs-content：

- Kubo：`0.43.1-acc53c093`，repo format `18`，Golang `go1.26.5`。
- `ipfs.exe` 二进制 SHA-256：`fd0d46df76f455d938713c98c7fca5fa117b74c934c9fc0d37730fdb33313651`。
- 使用任务独占 `IPFS_PATH`，`Bootstrap=[]`、`Addresses.Swarm=[]`、`Discovery.MDNS.Enabled=false`。
- 两次 daemon 均带 `--offline --migrate=false`，日志均确认 `Swarm not listening, running in offline mode.`，API 和 Gateway 仅绑定 `127.0.0.1`。

实际制品：

| 项目 | 准确值 |
| --- | --- |
| CAR 根 CID | `bafybeifmmopz2gkvc7bzv6hgwlfkg6s7jsnr6zyqm2dpuii7l4rlx7pkpe` |
| CAR 字节数 | `812645` |
| CAR SHA-256 | `64a9366e2ec7628826fdd6c9e53bf239d4fffbd4de575f234fdd50d7ed8792ec` |
| 嵌套资源 | `resources/nested/payload.bin` |
| 资源字节数 | `800000` |
| 资源 SHA-256 | `e2e4edd479ed8c39944c757110ded875b4bd125af24d43fe5487596df0af7c57` |
| 资源逐字节求和 | `99999533` |

实际执行 `ipfs dag import --pin-roots=true <bundle.car>`。pin 是本次外部操作者明确选择的策略，不是 Bundle 自动选择。导入后、独立 daemon 关闭并重启后、所有消费者与 Worker 关闭后，以及 daemon 最终关闭后的 `ipfs --offline pin ls --type=recursive <CID>`，均得到同一根 CID 的 `recursive` pin。

Kubo 两次正常退出均为 code `0`，没有强制停止。任务独占 repo 保留在 `.cache\official-car-delivery-02\runtime\kubo-data`，但 daemon 已停止；仓库配置及私钥没有复制进 Git 或本证据。CAR、归档与 SQLite 事实也保留在该任务目录，便于本机复核。

## 六个实际 Request 与 Worker 结果

全部请求使用同一根 CID、`timeoutMs=60000`，均实际得到 `accepted`。请求正文、Task/Run 完整快照及时间戳见机器证据。

| 场景 | Request ID | Run ID | 实际结果 |
| --- | --- | --- | --- |
| 正常嵌套读取 | `01M6KP31B2WKATK43VW9PKZJNK` | `01M6KP31GEMHKP8DTCPN0QM4V7` | `completed`；800000 字节、SHA-256、逐字节求和均与作者期望完全一致 |
| 清单外路径 | `01M6KP31RD0ZD4D0Y02V6YYK52` | `01M6KP31W769YJ734BF4H57X8V` | `failed/invalid_bundle`；没有成功结果，也没有资源叶块读取 |
| 资源块缺失 | `01M6KP31ZFFW8BXVXY2HYAWZMB` | `01M6KP322Q1C5F3J4EY4H26E4W` | 资源叶块返回 404 后 `failed/bundle_fetch_failed` |
| CID 不匹配 | `01M6KP326BST8RT59A9YFD3YQC` | `01M6KP329KKS6HE3P7NC6AM1HZ` | Gateway 改变首个资源块字节，校验拒绝，`failed/bundle_fetch_failed` |
| 在途读取取消 | `01M6KP32DHV5QAJYXE8QDJKTX0` | `01M6KP32GV9Z9JF132PMR3GZWA` | 资源响应仅发送 32 字节后保持；取消后 `canceled=true`、阶段 `stopped`，连接已关闭，无成功结果 |
| Gateway 中断 | `01M6KP32N7X6TG2TFHR5W3ETHX` | `01M6KP32RFC4607B5DB1NA1YBS` | 首个资源请求到达时实际停止 Gateway listener 并断开连接，`failed/bundle_fetch_failed` |

每个 Run 都有 `reclaimedAt`，消费者正常关闭；取消不是伪造为业务成功或仅停止等待。取消与中断各观察到一条中止连接。Gateway 的 47 条请求全部为 `GET /ipfs/<CID>?format=raw`，没有 `/api/` 请求；运行消费者未配置来源访问记录为空。

资源叶块首读均晚于相应 `run.startedAt`。例如正常场景 Run 于 `16:25:48.868Z` 开始，首个资源叶块于 `16:25:48.897Z` 请求；因此外部实际链路也证明默认按需读取，而不是把准入当作全量预取。缺块与断网均发生在受理之后并使 Run 明确失败。

## 已复核的用户迁移步骤

1. 离线 build 得到 `{directory,car,cid}`，再用 `check artifact <CAR>` 验证；作者不连接 RPC、上传或 pin。
2. 选择外部工具和保留策略。本次选择 Kubo 的 `dag import --pin-roots=true`；上传到其他服务及其可用性不由 Bundle 决定。
3. Engine 只配置根 Gateway URL。本次同时验证带 `/old-prefix` 的基址被拒绝，旧前缀部署需要迁移到独立根 origin。
4. 已安装 CLI 帮助只有 `init/check/build`；旧 `publish ... --ipfs-rpc ...` 返回用法错误 code `2`，`/publish` 导入为 `ERR_PACKAGE_PATH_NOT_EXPORTED`，包不再声明 settings 描述。使用者应移除旧 `task-bundle.ipfsRpc` 及相应手动注册。
5. Worker 用 Bundle 相对路径读取资源。默认 accepted 不承诺所有资源已离线保留；若需要旧的准入前全量预取，使用实现契约中的显式 `bundlePrefetch: true`，不应把外部 pin 或根 CID 本身误认为运行消费者已缓存所有资源。

原始成功命令：

```powershell
& .\.silvermoon\ideas\01M6KBWCZSSWWF3BBMRC3ZBTXD\outer\Verify-Delivery.ps1 `
  -DeploymentRevision 312909bba56d9a75041aa41720c39faa3a0ca01d `
  -CandidateCommit 93ad00d0fd901785d0d70177b67c1deb6b59245d `
  -RunDirectory (Join-Path (Get-Location).Path '.cache\official-car-delivery-02')
```

原目录已存在，脚本会拒绝覆盖。重放应先同步并重新观察当前部署修订，选择新空目录；结果证据的追加会改变 Outer tree，不应把上述旧契约修订假装成当前树。脚本不会修改已验收源码、ledger 或生命周期事件。

## 限制

- 本次外部结果仅覆盖 Windows 回环隔离环境与一个持久 Kubo repo，不承诺公网可达、多副本、长期 SLA、其他发布服务或 npm 安装可用性。
- 没有执行 npm 发布、公共 IPFS 节点、外部公开上传或用户默认 Kubo repo 操作；只有本任务独占离线节点的外部 CLI 导入与 pin。
- macOS CI 取消的实现阶段限制不在本阶段被“补证”为成功。本次六场景没有另行证明多平台部署。
- pnpm 使用项目本地 store/cache；没有修复或删除此前出现损坏的共享 store。全部证据不包含 Kubo 私钥、真实令牌或用户凭据。
