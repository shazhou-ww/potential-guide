# 从已交付 Bundle 启动 Task Engine

## 三类前提

- **消费设备**：Linux/macOS 为主，Windows 也可；安装 Node.js 22.13+，
  且 `node --version`、`npm --version` 均成功。无需 pnpm、Git、源码工作区、
  Kubo 可执行文件或 RPC 管理端口。Node 运行时须同时满足 Bundle 声明的最低版本。
- **服务操作者**：准备自己的可写目录、未占用的 loopback 端口、新数据库文件；
  明确配置可信 Gateway 的顺序。安装的是交付方实测的精确包组合，不要求每包版本号
  相同，也不限定 stable/RC 通道。不要把“全装 latest”或版本字符串相同当成兼容证明。
- **交付方**：预先提供准确 Bundle 根 CID、至少一个可用的根路径 HTTP(S) Gateway、
  无凭据的服务配置、精确包版本清单与锁文件、测试输入及预期结果，以及本页共用的
  [`verify-consumer.mjs`](../examples/task-server/verify-consumer.mjs)。
  消费者不负责生成 CID、导入 CAR 或维持 pin；Gateway 可用性是独立的交付要求。

只运行已审查的 Bundle：CID 校验证明内容未被替换，不证明代码可信或无副作用。
Task Engine 是代码执行宿主，不是任意不可信代码的安全沙箱。

## Linux/macOS 主路径

在新建的自有目录中放入交付的 `package.json`、`package-lock.json`、
`server.json`、`delivery.json` 和 `verify-consumer.mjs`。清单的 dependencies
须锁定实测版本，例如 `@potential-guide/pguide-task-engine` 的准确版本；
若使用 `pguide task-engine`，还要安装交付清单中的准确 `pguide` 版本。
`pguide-task-engine` 本身可独立运行，不强制安装 `pguide`。
锁文件应来自正常 npm 安装，不含 `workspace:` 或工作区路径。

```sh
node --version
npm --version
npm ci
npm ls --all
./node_modules/.bin/pguide-task-engine --no-global-config --config ./server.json
```

不要用源码根目录的 `node_modules` 代替独立安装。没有锁文件时，先依据交付方提供的
精确版本逐项 `npm install --save-exact package@version` 并保存锁文件；
不能确认包组合、npm 不可用或缺少 CID/Gateway 时，应报告缺失项，而不是安装 Kubo
来绕过交付缺口。本地 tarball 候选可作为显式交付物，但不等于这些版本已发布至 npm。

`server.json` 示例（将示例域名替换为交付方实际可用的来源）：

```json
{
  "host": "127.0.0.1",
  "port": 3000,
  "database": "./consumer.sqlite",
  "ipfsGatewayUrls": ["https://primary.example", "https://backup.example"],
  "ipfsGatewayTimeoutMs": 30000,
  "ipfsGatewayAttemptTimeoutMs": 5000,
  "ui": false
}
```

保留终端运行，在另一终端使用 ready 输出中的准确 URL：

```sh
node ./verify-consumer.mjs http://127.0.0.1:3000 ./delivery.json
```

交付的 `delivery.json` 形状如下；CID、业务输入和预期结果必须来自同一实测交付，
不是照抄占位符：

```json
{
  "bundle": "<delivered-root-CID>",
  "input": { "text": "hello" },
  "expectedResult": { "text": "hello" }
}
```

同一个纯 Node 脚本检查 HTTP 可达、提交回执、Task 完成和精确业务结果，
在 30 秒内结束；失败不伪装成空结果。它会执行一次真实 Task，不应对未知业务反复运行。
根 CID 不包含 Gateway；备用来源必须提供同 CID 的每个所需块。
可在自有测试环境令首选来源返回错误，重用同一根 CID 检查备用来源，
并保存准确版本、URL、回执和结果；未做此检查不能宣称外部故障切换已验证。

### Windows 差异

使用 PowerShell，在上述同一交付目录运行相同 `node` / `npm` 检查和 `npm ci`；
启动命令改为：

```powershell
& .\node_modules\.bin\pguide-task-engine.cmd --no-global-config --config .\server.json
node .\verify-consumer.mjs http://127.0.0.1:3000 .\delivery.json
```

若执行策略阻止 npm 的 PowerShell 包装器，使用 `npm.cmd`；不要为此更改全机执行策略。
JSON 中路径使用 `./consumer.sqlite` 或转义反斜线。Linux/macOS 的 PATH 使用 `:`，
Windows 使用 `;`；本流程直接调用本地 binary，不依赖手工修改 PATH。
Ctrl+C 触发拥有进程的正常关闭；Windows 强制结束不保证优雅清理。
不得停止其他人的服务或复用其数据库。

## 来源、迁移与诊断

完整配置规则见 [服务配置](task-server.md)。列表有序、最多 16 项、整项替换，不进行
节点管理、负载均衡、公共发现或重定向。每个未缓存块的所有来源共享总预算，
单来源耗尽后才轮到下一来源；总预算不是整个 Bundle/Task 的截止时间，
Task 仍有独立的 timeoutMs。所有成功返回的块都经 CID 校验，缓存/历史身份仍只有根 CID。
最后失败诊断列出实际尝试来源及超时或读取/校验失败，不包含响应正文。

旧 `ipfsGatewayUrl` / `--ipfs-gateway-url` / `task-engine.ipfsGatewayUrl`
继续作为单来源别名；任一较高层来源配置替换较低层全部来源，同层新旧并存报错。
新的单来源默认 5000 ms 同样用于旧别名和字符串工厂调用；若需要旧的最长 30 秒单源等待，
显式把 `ipfsGatewayAttemptTimeoutMs`（代码中为 `attemptTimeoutMs`）设为 30000。
旧文档关于 `/content` 等路径前缀的承诺不符合现有 Helia broker；
现在所有服务入口提前拒绝路径前缀，应使用独立 Gateway origin，绝不静默丢弃路径。
旧程序化字符串调用保持可用；已有 `allowGateway` 策略继续授权实际块 URL，
授权 hint 排在配置来源之后且共享预算。普通服务不授予 Request hint 任何网络权限；
不要用 hint 代替操作者配置。

Pinboard 或其他“支持 IPFS”的服务不能据名称推断可用。交付方须对实际 origin、
CID 和 `/ipfs/{cid}?format=raw` 做兼容性实测，包括需要的后继块及 CID 校验；
页面/文件下载 URL、可预览文件或 pin 成功均不是 Trustless Gateway 兼容证明。
本页和本地测试不声称某个外部 Pinboard 实例已经兼容或可用。

## 可选：交付方使用 Kubo

仅发布者/运维方需要此路径，不属于普通消费者 prerequisite。
安装和运行自有 Kubo 后，可使用 `ipfs dag import ./bundle.car` 导入，
核对根 CID，再用 `ipfs pin add <root-CID>` 维持可用性，按自身运维策略提供 Gateway。
CAR 可由 Bundle authoring 工具离线生成，也可经其他独立工具上传/import/pin。
核对实际 raw-block 读取后再交付 CID/Gateway。不要向消费者开放 RPC 管理 API。
Engine 不启动、停止或配置节点，不管理 pin/GC，也不保证远程持久性。
