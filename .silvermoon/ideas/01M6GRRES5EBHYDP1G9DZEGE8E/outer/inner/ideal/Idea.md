# 通过 pguide 声明式启动 Task Engine 服务

## 问题

当前 Server CLI 要求可执行配置模块和手工 IPFS 装配，服务启动也未接入 pguide 的命令发现与设置机制，
用户无法从统一服务入口选择仅启动 Engine 或同时启动 Web UI。

## 结果

提供可独立调用、也可通过 `pguide task-engine` 发现的服务命令，
通过参数、YAML/JSON 和 pguide 用户设置启动 Engine，并可选择带 Web UI；规则见[配置边界](Configuration.md)。

## 边界

1. 显式 CLI > 指定文件 > pguide 用户级 JSONC 设置 > 默认值；项目文件不参与服务配置，逐层校验且路径按来源解析。
2. Engine 与 UI 保持 HTTP 边界，CLI 不执行配置代码；程序化注入保留，本机访问边界明确。
3. 不做系统 daemon、开机自启、Kubo 管理、用户数据自动改写或 npm 发布；不实现同级 `pguide task-bundle` 作者工具。

## 验收标准

1. `pguide task-engine` 与独立 binary 通过既有扩展机制提供一致服务行为，无需 JavaScript 配置即可仅启动 Engine 或带 UI。
2. 四层优先级、路径锚点和全局禁用可验证；被覆盖的非法值仍报错，不回退默认值、不另建隐藏全局目录。
3. 原程序化装配仍可用；独立消费证明 HTTP 边界、服务启动/停止和失败清理，不接管既有服务或 Kubo。
