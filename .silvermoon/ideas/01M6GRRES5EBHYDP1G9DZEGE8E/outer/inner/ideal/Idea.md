# 通过 pguide 声明式启动 Task Engine 服务

## 问题

现有声明式服务入口已支持 Engine 与可选 Web UI，但读取 Bundle 仍依赖 Kubo RPC；
运行端仅需按 CID 读取内容，不应因此必须连接完整的节点管理接口。

## 结果

提供可独立调用、也可通过 `pguide task-engine` 发现的服务命令，
通过参数、YAML/JSON 和 pguide 用户设置启动 Engine，并可选择带 Web UI；
运行端可直接使用标准只读 IPFS Trustless Gateway，无需本机 Kubo，保留 RPC 兼容；规则见[配置边界](Configuration.md)。

## 边界

1. 显式 CLI > 指定文件 > pguide 用户级 JSONC 设置 > 默认值；项目文件不参与服务配置，逐层校验且路径按来源解析。
2. Engine 与 UI 保持 HTTP 边界，CLI 不执行配置代码；程序化注入保留，本机访问边界明确。
3. Gateway 仅负责读取，保留逐块 CID 校验与资源上限；不做内容发布或持久化承诺、Kubo 管理、daemon、用户数据自动改写或 npm 发布，不重做 Bundle 作者工具。

## 验收标准

1. `pguide task-engine` 与独立 binary 通过既有扩展机制提供一致服务行为，无需 JavaScript 配置即可仅启动 Engine 或带 UI。
2. 四层优先级、路径锚点和全局禁用可验证；被覆盖的非法值仍报错，不回退默认值、不另建隐藏全局目录。
3. 无 Kubo RPC 的独立 HTTP Gateway 消费可成功执行 Bundle，损坏内容与超限响应明确失败；原 RPC、程序化装配和 UI HTTP 边界保持，服务停止不接管内容源。
