# 人工状态手册修正

## 问题与处理

用户指出旧手册把“运行手册包装器”混同于人工使用服务，并且按测试路径展示 before/after，
没有展示面向操作者的 state tree。这是实现理解偏差，不是简单的 shell 语法问题。

本次修正：

- YAML 中的人工说明改用原始公开 `CheckKernel`、`serve`、`CheckClient` 和 `fetch`，
  不再调用 Test Tree、绑定、tsx 或手册专用包装器。
- 删除 `test/check-host/manual.ts`；业务 worker 代码在说明中透明给出，不读取测试 fixture。
- 明确 Check Host 没有通用 start/run/cancel CLI，本路径直接运行真实内核、HTTP、worker，
  不冒充 discovery 守护进程启动验证。
- HTML/Markdown 正文按 state 展开，每状态一份“如何进入”“在此状态观察”
  “可以转向的状态”和实际退出说明。主导航只列状态，保留旧观察锚点兼容定位。
- before/after 及固定函数约定仍可用于数据和自动执行侧，不成为人工页面标题。
- 代码围栏安全格式化，正文和代码全部转义，无页面脚本；提供响应式两栏状态导航。

理想世界支持文档同步澄清人工视图不调用测试包装器，由用户本次纠偏明确授权；
该变更使旧 ideal/inner 验收不再代表当前候选，不复用旧门禁结论。
历史消费证据保持不变，不用新页面替换历史快照。

## 验证

Windows / Node v24.12.0 / pnpm 11.22.0。

- **19/19 通过**：自动绑定路径仍能执行；独立 Node 进程直接执行 YAML 中的原始
  JavaScript 说明，六个观察状态及资源收尾全部成立。不导入测试绑定/helper。
- 新增约束检查文档代码没有测试工具调用；渲染测试确认每个 state 正文仅一份，
  包含进入、观察和后继状态链接，不含测试 hook/函数标题。
- 派生 Markdown/HTML 与 YAML 完全一致；文档 CLI 不加载 Binding TS。
- **`pnpm check` 退出 0**：构建、层级、格式、lint、类型、测试、打包全部通过。
- 真实浏览器重载后点击 recovered 状态链接：
  URL=`docs/check-host-manual.html#state-recovered`，正文 article 数=7，
  标题为“状态：新任务 Completed，原失败保持不变”，栏目为“如何进入”
  “在此状态观察”“可以转向的状态”；页面脚本=0，
  测试框架标题=false、helper 命令=false。
- 使用 Node 自带 REPL evaluator 按完整代码块依次执行准备、启动、观察、关闭、删除：
  HTTP 就绪和“场景目录已删除”均实际出现，退出 0。

## 验证中发现并解决的问题

初次文档回归发现进入块中的 headers/client 在独立执行脚本的 finally 中不可见，
改为准备阶段声明、进入时赋值；凭据赋值使用 void，避免交互控制台回显 token。

一次性把多行顶层 await 直接管道送给 `node -i` 会并发排队，不能代表人工逐块操作。
手册明确要求 `.editor` 粘贴整块、Ctrl+D 执行、等待提示符后再继续；
随后用 Node 的真实 REPL evaluator 分块验证，不将只退出 0 当作成功证据。

目前仅在 Windows 实测；Node 原始接口写法不依赖 shell，并不意味着 Linux/macOS 已验证。
