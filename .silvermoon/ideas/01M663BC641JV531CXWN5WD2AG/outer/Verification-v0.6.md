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
