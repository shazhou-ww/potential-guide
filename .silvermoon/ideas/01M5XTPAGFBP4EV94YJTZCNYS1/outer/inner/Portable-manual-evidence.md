# 手册命令的 shell 中立修订

## 反馈与边界

用户反馈针对 HTML 手册中已有的测试命令，而不是要求新增命令入口。
保留现有 manual.ts 工具与 state/transition 绑定，修改唯一 YAML 的人工说明，
同步重新生成仓库 docs 中的 Markdown/HTML；不手改 HTML，不增加命令别名。
理想世界保持已接受版本不变。

历史 `outer/consumption` 是前次真实验证快照，保持原样，不能覆写后冒充新验证。
浏览器已从历史快照切换到仓库 docs 的当前 HTML。

## 变更

- 所有手册命令从仓库根执行，统一使用
  `pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts`。
- prepare 直接输出目录，不再通过 `$case = ...` 接收。
  后续命令统一使用 `"SCENARIO_DIRECTORY"`，明确要求复制实际目录并保留双引号。
- 不使用 shell 环境变量赋值、管道、重定向、反引号续行或反斜线脚本路径。
- 前台 serve 输入 stop 并回车收尾，不以 OS 信号作为通用操作指令。
- 区分“命令写法 shell 中立”与“已经完成所有 OS 实测”，不新增跨平台实测声明。

## 验证

环境为 Windows / Node v24.12.0 / pnpm 11.22.0。

- 修改命令回归：核对 YAML 中的确切命令形式，使用同一 pnpm filter/exec 入口，
  从仓库根真实执行 prepare/serve/inspect/run/cancel/release/finish/fault/recover/clean。
  以 stop 标准输入停止前台 Host；不通过直接调用测试 helper 代替命令入口。
- 新增说明约束探针，检查 15 条命令不含 shell 专属语法，目录占位符明确且带双引号。
- 包内 **19/19 通过**，包括真实取消/故障恢复操作和派生文档完全一致检查。
- 修复测试代码中环境变量在闭包内的 TypeScript 收窄问题后，
  `pnpm exec tsc -p tsconfig.test.json --pretty false` 通过。
- **`pnpm check` 退出 0**，包括构建、层级、格式、lint、类型、测试和打包检查。
- 真实浏览器导航至 `docs/check-host-manual.html#recovered.result`，
  确认页面显示仓库根命令、新占位符及 stop 说明，不再显示 `$case`。

第一次验证发现新测试误嵌套且命令数预期少计一条，修正为独立测试和 15 条后再验证；
这些是本次变更引入的问题，已修复，不归类为基线故障。
没有在 Linux/macOS shell 中实跑，不把 Windows 的 pnpm 进程验证等同于跨平台证据。
