# v0.6 正式验证与保留数据更新

## 候选及顺序

本轮消费 acceptInner#18 的 `958107dc3f67ea9356cf8dfc8ae57e805e2b0f41`，代码提交 `8e5ec6739d4eecb5ca3c37daa00082285083cd72`。[Deployment](Deployment.md) 在 primary `c92e27d2acaa7719e905a6d799ab3b060b4efa8e` 同步，执行时契约 revision 为 `12f2cf59af8ef61b26bc3f82cf25f97ef84612e8`；随后才更新用户 UI 并重新执行正式浏览器检查。

主工作树通过依赖构建图完成 build/typecheck，实际产物：

- app.js SHA-256：`7150b96f8c544a19d683bb4eb88265d8d7833db2c9355c93171ce0142f67e9df`
- style.css SHA-256：`c04baeea55589511d913cb6c95bf42e7c8b1b92e847363624c23d391c7edba14`

真正的 shadcn React 组件及上游许可已在 Inner 独立复核；主 Agent 的 53/53 回归、完整 pnpm check 及源码审阅见 [Review](inner/Review.md)，不把组件名或子 agent 的截图单独当成运行证明。

## 最终地址上的实际结果

Windows Chrome for Testing，保留用户浏览器设置。以新建的自有测试页打开 **http://127.0.0.1:64319/**，测试仅读取已有任务，未提交、取消或改动星标：

| 项目 | 测量/观察 |
| --- | --- |
| 合并顶栏 | 1280×900 CSS 视口，顶栏高 56.375px；标题、任务/执行 Tabs、服务选择和任务栏入口同处一栏 |
| 全宽列表 | 打开详情前后列表宽度均为 1223px，没有预留详情列或压缩表格 |
| 右侧覆盖 | 宽屏 Sheet x=650..1280，贴右覆盖；关闭后焦点回原详情按钮，列表滚动位置仍为 88px |
| 关联导航 | Task → Execution → Task 始终只有一个详情 Sheet，无叠加模态层或隐藏焦点陷阱 |
| 新建弹窗 | Escape 返回新建按钮；跨 Tab 和关闭重开后保留原字段节点及未提交文本 |
| 窄屏 | 390×844 CSS 视口，clientWidth=scrollWidth=375；Sheet x=0..390，详情内容 overflow:auto，整页无横向溢出 |
| 实际 CSP | 正常交互零 violation，合法 nonce 的 Radix 样式真实生效；独立负向探针的无 nonce inline script/style 被浏览器阻止 |
| 其他行为 | 没有未捕获页面异常；此次原生检查没有任何 POST，不通过改变后端数据来证明布局 |

截图：[全宽任务列表](evidence/v06/tasks.png)、[任务抽屉](evidence/v06/task-sheet.png)、[执行列表](evidence/v06/executions.png)、[执行抽屉](evidence/v06/execution-sheet.png)、[新建弹窗](evidence/v06/popup.png)、[窄屏](evidence/v06/narrow.png)、[窄屏抽屉](evidence/v06/narrow-sheet.png)。

## 数据、服务与清理

- 只停止旧 UI 进程，启动已接受的新 UI；地址固定沿用 **64319**。原 Backend **61123** 没有停止或重启，收藏文件路径没有变更或迁移。
- UI-only 更新前后收藏文件 SHA-256 相同，抽样的 10 个原 Task 均继续从原后端读取成功。用户原任务和星标保留。
- 更早的 UI62952 / Backend61109 未操作。新版 UI 句柄为 `ui-v06-user-frontend`，后端仍为 `ui-v05-trial-backend`；按用户要求保持运行。
- 独立验证 UI61429 已关闭，收藏副本目录已删除；所有自动检查页已关闭并清除自身设备模拟。临时脚本/事件输入和中间图片在交付前清理。
- 最终另外在用户 Chrome 打开同一64319地址，未强制刷新或关闭原页面；旧页面刷新后加载新 UI。没有改动用户缩放设置，没有发布 npm 或部署生产环境。

## 受托结论

重新执行的 D-S02 / D-AC02 及数据保留检查通过，其余未变更的后端和服务独立性证据继续有效。没有剩余 blocking issue；主 Agent 按明确受托授权接受随后提交的准确 Outer revision，完成事实仍由同步的 CLI 事件记录。此结论不是用户已经认可新版视觉，用户可继续实际试用反馈。

## v0.6.1：单 Glyph 行内动作

代码 `5383e841998346041c8987b5d29d4732c3c59b03`，acceptInner#22 对应 `8413a9b325bcd076d81ac7b66e39f50911bc1715`。本轮契约先同步于 primary `316fd6a9e37b3cdee86ef7e1c83dc54dc2b26d99`，执行时 Outer revision `3d63862d28c5a871779742c7f6e0b28902050d4e`，再仅替换 UI64319并执行正式浏览器检查。

- 详情/重做/编辑等 13 类明确次级动作采用单个 Lucide Glyph；实体名称、主要新建/提交及高风险动作仍有文字。
- 主 Agent 在最终64319地址实际测量表格三个动作各一个 SVG、31.5×31.5px点击区域，原中文名称保留为 sr-only，aria-label 分别清楚说明查看、创建新任务及编辑后重做。
- 原生鼠标悬停和键盘 Tab 均显示中文 Tooltip；Enter 打开对应详情，编辑图标打开原参数弹窗。主要提交和新建按钮仍有可见文字。
- 390px视口 clientWidth=scrollWidth=375，正常交互零 CSP violation，全程无后端 POST。
- UI-only 更新前后原收藏文件字节一致，Backend61123及其任务未停止/重启；最终进程句柄为 `ui-icons-user-frontend`。临时 UI/收藏副本/测试页已关闭清理，原用户服务保留。
- 父 Agent 独立48/48 UI测试、build/typecheck和完整 `pnpm check` 通过；实现复核见 [Review](inner/Review.md)。

最终截图：[行内图标与提示](evidence/v061/tooltip.png)、[详情抽屉图标](evidence/v061/drawer.png)。自动测试只使用自己的新 Chrome 页；另为用户打开了同一64319地址，没有关闭原页面。

本轮 D-S02/D-AC02 通过，无剩余 blocking issue。主 Agent 按既定委托接受随后提交的准确 Outer revision，仍由同步 CLI 事件记录，不代替用户后续视觉反馈。

## v0.6.2：数据行导航与新 Run 环境

代码 `cd38f2cba73b99b80984025ac8545ef1f99a7e8b`，acceptInner#26 的实现 revision 为 `f95b390ccc2822dad289e15172f24669a26104d2`。先同步 primary `43d480007924ab5542773a1f657df06a20c4f739` 的契约（Outer `92a38ec8dd9e21310c5c119f24ce095d3e32a5b7`），再切换最终 UI64319 到新 Run 后端51283，并重跑正式浏览器检查。

- 主线 Run 升级已完整保留；新后端的真实类型发现、提交、完成及 `/runs` 成功。示例 Task `01M6978P9ZMR76TQSQP23Y192F`，对应 Run `01M6978PA00XE2HK9J0THFZVX9`，不是旧记录迁移或假造执行。
- 最终页面的 Task/Run 类型都是普通 SPAN 文本，不是按钮；任务行没有重复的查看图标。行仍为原生 TR，没有覆盖成 button 角色，并可键盘聚焦。
- 主 Agent 原生鼠标点击和 Enter 打开正确 Task；Space 打开 Run。关闭抽屉后焦点回原行，整行导航不挤压表格。
- 实际星标/取消星标、编辑及操作区空白都未触发行详情；编辑只打开原参数弹窗。原生文字拖选保留选区且不跳转，Ctrl 点击也不打开抽屉。禁用 wrapper/子控件键盘边界由独立 UI 回归补充。
- 390px CSS 视口 clientWidth=scrollWidth=390，无整页横向溢出，正常交互零 CSP violation。最终脚本没有提交或取消 Task；只按测试切换了新演示记录的本机星标。
- 父 Agent 独立 53/53 UI、依赖图构建/typecheck及完整 pnpm check 通过；首次并发检查的停滞和受限重跑详情已如实记入 Inner Review，没有跳过断言。

截图：[普通文字任务行](evidence/v062/tasks.png)、[行打开任务详情](evidence/v062/task-detail.png)、[Run 行详情](evidence/v062/run-detail.png)。已刷新用户共享的集成浏览器页，实际可访问树中 `echo` 是单元格文字，右侧只有重做/编辑等独立操作。

用户明确“不用保留旧的数据，直接适配新的吧”。据此按准确登记句柄关闭旧 UI64319、旧 Backend61123、UI62952、Backend61109及验证 UI52663；61109/61123/62952/52663 均实际返回连接拒绝。只删除本 session 的两个旧演示 fixture 目录（包含旧凭据/收藏），不修改其他会话资源；所有自有自动测试页和脚本已清理。

最终保留供用户使用：`ui-run-trial-backend`（51283）与 `ui-rows-user-frontend`（64319），数据目录 `ui-run-trial-20261031-2230`。这是匹配当前 Run 协议的新演示数据集，旧数据没有迁移。未发布 npm 或部署生产环境。

本轮各 D-* 已验证，无剩余 blocking issue；主 Agent 按既定委托接受随后提交的准确 Outer revision，并同步 primary。用户仍可继续对实际体验提出反馈。
