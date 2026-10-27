# 原始 API 状态手册的实际消费

## 候选

- 已接受实现：`fde3ff4096b592d28167487941381645dff805df`。
- 修订部署契约已同步到 primary `b366f6d94fc3201a59a6b140142acd75615ae044`，
  外部验证开始前观测为 `deploymentRevision=d57982e007e8`。
- 本次不修改主体世界或仓库交付物，仅新增外部消费快照和证据。
- 环境：Windows、Node v24.12.0。未宣称 Linux/macOS 已验证。

## 同源生成

实际从仓库中的 host.states.yaml 生成：

- [终端树](./state-consumption/host-tree.txt)
- [Markdown](./state-consumption/host-manual.md)
- [离线 HTML](./state-consumption/host-manual.html)

使用公开 model/render 读取同一数据，不导入 Binding TS；
新快照位于 state-consumption，旧 consumption 保留为历史记录。

## 真实浏览器

浏览器实际打开新快照的 file: HTML，不启动 HTTP 展示服务。

- 正文 article 数为 7，与七个 state 一致，不按每个检查重复整条路径。
- 点击状态链接，地址分别到达 `#state-cancelled`、`#state-recovered`。
- recovered 栏目为“如何进入”“在此状态观察”“可以转向的状态”，
  资源释放在单独的原生折叠说明中。
- ready summary 聚焦后按 Space，open 实际从 true → false → true，折叠可用。
  summary 内文字链接直接导航，点击文字不会被当成折叠动作；没有通过修改 DOM 属性伪造结果。
- 实际 script 数为 0、network resources 为 []，可离线阅读。
- 当前页面没有 before/after/transition 函数名标题，命令块没有 manual.ts、
  测试绑定、test-tree 或 tsx 调用；使用 Node 原始 API 和 HTTP。

## 独立 Node 控制台操作

不是运行 manual.test.ts，也不是调用测试 helper 或状态绑定。
分别启动新的 Node 进程，使用 Node 自带 REPL evaluator 按手册整块执行公开 API 指令，
再执行各状态的原始观察命令。读取文档中的代码仅用于复制相同操作，不使用自动测试执行器。
Running/cleaning 尚未出现时重复观察并有界等待，与手册中的人工等待条件一致。

两个场景分别执行：

1. 准备独立目录和透明 worker → CheckKernel.create/serve → GET /checks →
   CheckClient.start/sample → cancel → 观察 Cancelling/cleaning →
   原始 fs.writeFile 创建 release → wait/sample → 关闭 Host/kernel → 删除自有目录。
2. 新独立目录和 Host → start(fail=true) → wait/sample 原异常 →
   同 artifact 新任务 start → wait/sample 新结果及原异常 → 关闭与删除。

[去敏现场结果](./state-consumption/raw-api-results.json)记录时间、平台、实际目录与快照，
不含 token、headers 或完整凭据对象。结果：

- 取消场景：held=Cancelled、cleaned 存在、active=[]。
- 恢复场景：fault=Failed，error=`Error: manual injected failure` 未变；
  recovery=Completed，result=`{marker:"tree-manual",calls:2}`，active=[]。
- 两个场景均实际输出“Host 与 worker 已关闭”“场景目录已删除”，进程退出 0。
- 全部操作后 `.cache/manual-check-host` 场景数为 0。
- 使用隔离公开 API，不连接默认 discovery，不按进程名清理，不运行测试包装器。

源代码、测试及生成器在本阶段均保持已接受版本；本证据不再以旧的包装器操作
证明人工使用原始服务。本次覆盖内核/HTTP/worker，不声称验证 discovery daemon。
