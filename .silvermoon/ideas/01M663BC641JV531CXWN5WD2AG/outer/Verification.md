# 正式外部验证与受托验收

## 候选与环境

2026-10-31，主 Agent 在 [Deployment](Deployment.md) 同步至 primary `935719ff144f3c057c1f01e07df29d1bcdc7b59b` 后执行本轮验证。执行时的契约树为 `deploymentRevision=570d603568d74439c34a542bf92e88a1dd52e821`；本记录和截图是执行后追加的证据，不改变该契约的要求。

- 已接受实现：`ce03ba23fc977980b92760d0750234e595bf9d1e`，acceptInner#6；实现阶段的独立审阅见 [Review](inner/Review.md)。本阶段没有修改应用、依赖包、工作区清单或 Inner World。
- 应用 `@potential-guide/task-engine-web-ui@0.1.0`；Task Engine、Task Engine Server、Task Protocol 均为 `0.1.0-rc.0`，来自同一工作树，不混用已发布旧包。
- 浏览器产物 `app.js` 的 SHA-256：`687bd36d2a91c1a27984c2db7336190152c4159f07ef84072410e8fbd0a31eb5`。
- Windows、Node `24.12.0`、pnpm `11.22.0`；用户提供的 Chrome for Testing `156.0.8078.73`。只操作主 Agent 新建的测试页，通过该页的 CDP 会话发送原生鼠标/键盘事件，没有向操作系统的其他窗口发送按键。
- 独立真实 Task Server：`http://127.0.0.1:49613`；UI 首次为 `http://127.0.0.1:64606`，仅重启 UI 后为 `http://127.0.0.1:49658`。使用新建的私有 `ui-outer-935719ff` fixture 目录、内存 Store、单资源测试执行器和随机凭据，不连接用户任务库。
- 公开类型均为 version `1`：echo revision `85e4acbd53e6313788f142408aadaba301e4e5045d5c7e6b13cfc2d293e792b2`；survey revision `e1d0663b0b93292e5be7b5c684ae4b4057e5b54188d0b8a3465117d4c5650ea4`。表单来自这些公开 Schema，没有新增类型专用 UI。

## 实际执行结果

| 契约范围 | 本轮观察与断言 |
| --- | --- |
| 单任务 / 键盘 | 可见页面原生 Tab → 跳转链接、Enter → 创建区、Tab → 类型选择、方向键选择 echo、文字输入、Enter 提交，网络中恰好一个 POST；Task 正常完成。Space 展开详情后等待持续 SSE，焦点仍在同一个 summary，展开状态保留。 |
| 单条与多条隔离 | 先加入多条草稿，再快捷单条，只多发一个快捷请求，草稿仍在。三条草稿实际上下调整后发送，网络参数顺序为 `outer-draft`、空字符串、`outer-last`；回执依次“已确认、被拒绝、已确认”。 |
| 共享与排队 | 同一未来 eligibleAt 的 Task `01M67ZFKD6RVA3PCYW6FW1PGP1`、`01M67ZFKDBQ746MNFF0SA8GYKK` 实际关联 Execution `01M67ZFV7DY07RQEKB8B2H5DXC`。第三条 `01M67ZFKDFV2WNBGS2PB9ZFHRG` 先 queued，再以不同 Execution 完成。 |
| 取消隔离与回收 | 显式取消第二个共享 Task；第一个仍完成且无 canceledAt。Execution 独立显示真实逻辑完成与回收时间，取消没有被解释为执行已回收。 |
| 超时与迟到完成 | Task `01M67ZFZR2WBW915KRJVVC3Q72` 的 timeoutMs=100、durationMs=1500，先显示超时，随后执行完成并回收；Task 最终 stage=completed，同时仍显示超时。符合公开协议：超时是独立事实，运行中任务可以迟到完成；不能套用取消冻结规则。 |
| Schema guard | 对真实服务发送失配的 quoted If-Match 得到 HTTP 412；同一请求身份、原参数改用当前正确 guard 得到 202。UI 对 412、未知提交及重试身份的回归沿用已接受实现中的真实 HTTP 集成测试和模型测试，不声称本轮动态替换过服务 Schema。 |
| 跨客户端目录 | 独立 Node HTTP 客户端另发 13 个 survey，UI 按类型和带时区的 receivedAt 范围查询。首批 10 条，续页新增 3 条，UI 累计 13 条。首次查询后另发的 `01M67ZQT9FV56PDVPKKFBM4EBG` 不进入旧快照，重新查询后出现。 |
| 权限与目标 | directory 的发现返回 403，但同 scope 的目录查询成功；other scope 查询成功且为空。切到 other 后点击 demo 收藏直接再发，明确拒绝且网络没有 POST。 |
| 历史重做 | 从真实目录直接重做生成 `01M67ZQV21AY0ZJYFTNS7BKH28`，不是原 Task。原参数中的 `false`、`[2,3]` 保留，没有从目录摘要注入 version；编辑后重做实际提交改过的 name，其他原参数保留。 |
| 收藏派生与重启 | 编辑收藏并发送不修改原收藏。仅重启 UI 后两条本轮测试收藏仍在；直接再发生成 `01M67ZWJMZSTZG0GCV75Z2GVXH`，目标仍是 demo，实际 POST 参数与收藏完整原参数深度相等。收藏文件重启/再发前后 SHA-256 均为 `4893afb2ad05f06d6f2d60fdaa1f4f0434dddf6f38f8b96781bb55d2f655d10b`，且未包含任何 fixture 后端凭据。 |
| 真实过期与连接边界 | 等待 62 秒后续页，服务真实返回 query_expired；旧目录明确标陈旧且禁用续页。该等待跨过 UI 的 60 秒流上限；断流恢复、不重新提交及故障交错的断言另见已接受实现的真实 HTTP 集成测试和 browser-entry 受控传输回归，不把本轮等待本身称为浏览器抓包故障注入。 |
| 无 UI 时任务独立 | 从真实 UI 发起 10 秒任务 `01M67ZVF1PW32A6S0JD83RQ61S`，确认 running 后停止 UI。确认 64606 无监听，仅通过后端轮询，任务仍完成且无 canceledAt；等待完成后才重启 UI。 |

验证驱动曾把目录累计显示误当成只显示末页，也曾误把取消冻结套用于超时。对照真实协议纠正断言后重跑上述流程通过；没有为迎合测试而修改产品或后端语义。独立客户端的身份仅放在 Idempotency-Key，快捷提交测试遵守 300ms 防重复激活窗口。

## 中文、键盘与布局

- 已检查本轮 [桌面截图](evidence/desktop.png)、[窄屏截图](evidence/narrow.png) 和 [Task / Execution 分区截图](evidence/task-execution.png)。这是运行中的产品，不是离线草图。
- 1280×900 为双区布局；390×844 实际视口下 main 为单列，clientWidth=scrollWidth=375，没有全页横向溢出，主要可见输入及按钮无越界；任务栏高度 45.42px，小于页面预留的 80px。历史表格有自己的滚动容器。
- 使用真实 Chrome 解决了集成浏览器 hidden/视口重置问题，没有采用此前裁切的无效截图。原生键盘与实际截图覆盖本轮要求，不声称完成所有浏览器或屏幕阅读器矩阵。
- 用户只提供了测试浏览器，尚无本轮业务使用的 UX 反馈；不虚构用户亲自试用了所有流程。后续实际使用中的细节反馈仍可单独迭代，首版没有增加资产管理。

## 隔离与清理

- 已关闭主 Agent 创建的两个 Chrome 测试页；用户原有 Chrome 进程仍运行，没有关闭用户浏览器。
- 先停 UI，再停本轮 Task Server；最终检查 49613、64606、49658 均无监听。此前实现审阅的 52395、63488、63637 资源也已回收。
- 删除本次明确拥有的 fixture 目录、凭据文件和临时验证脚本；正式截图保存在本文件同层的 evidence 目录。没有递归清理工作区、session 根目录或其他会话资源。
- 没有发布 npm，没有生产部署，也没有改动来源工作区或实现子 agent 的工作树。

## 主 Agent 结论

D-S01 至 D-S03、D-AC01 至 D-AC03 的外部结果已验证，未发现剩余 blocking issue。用户授权主 Agent 负责 review & acceptance；主 Agent 据此决定接受随后同步并提交的准确 deployment revision。最终完成事实以 CLI 的 submitOuter / acceptOuter 事件及 primary 可达性为准，不由本段或 ledger checkbox 代替。
