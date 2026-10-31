# v0.6 实施验证

2026-10-31。仅为本实现候选的 Inner 证据，不是独立 review、submit/accept 或外部部署。
基线 `c491036b5d8b6a3ca06110f0a82d464735072f04`，对应 acceptIdeal#16 /
`88a18b021f155546ff6f71ac3ac58670188f59aa`。旧 Verification 与 v0.5 证据原样保留。

## 实现与边界

- 真正的 shadcn Button、Input、Table、Tabs、Sheet、Dialog；来源固定为官方
  `shadcn@4.23.0` / `96da9cc7f1aa10580a3741664e2a77c721206c00`。
  MIT 原文在 `apps/task-engine-web-ui/src/ui/LICENSE`，并随 app.js 产物保留；
  来源、依赖与手工导入变换见同目录 `SOURCES.md`。
- React 独占展示 DOM，分离的描述节点只生成 React 元素，不挂入页面。
  模型、协议、提交身份、收藏世代、取消事实和观察生命周期不重写。
  唯一 Schema 岛由原 `form.ts` 独占字段；弹窗卸载/再挂载不丢节点或非法文本。
- 只有一个覆盖层状态：实体 Sheet、创建 Dialog 或任务栏 Dialog。列表全宽；
  源码与实际浏览器均验证不会通过隐藏详情占位列“模拟”抽屉。
  异步关闭不会抢走已转移的新焦点，跨 Tab/关联导航不叠模态层。
- 所有第三方版本进入 catalog；没有 SSR/router、CDN、字体下载或新后端。
  pnpm 供应链策略未豁免；Tailwind 可选 Parcel 源码构建脚本明确拒绝，
  一次性 CSS 构建使用包内平台二进制。
- 每份 HTML 的随机 nonce 只授权 Radix scroll-lock 样式；`script-src 'self'`、
  `style-src-attr 'none'`，无 unsafe-inline / unsafe-eval。代理、错误脱敏、
  Host/Origin/CSRF、限额及持久收藏格式不变。

## 自动化

实际环境：Windows，Node 24.12.0，pnpm 11.22.0。

| 检查 | 实际结果 |
| --- | --- |
| UI build / typecheck | 通过；本地 esbuild React bundle + Tailwind CSS |
| UI `tsx --test "test/*.test.ts"` | 47/47；保留原 41 项语义，新增 6 项组件/所有权父子测试 |
| 三个 Execution 目录测试文件 | 6/6；Engine、SQLite、HTTP 的授权、共享去重、冻结分页、过期与重启 |
| `pnpm check` | 通过（exit 0）；包含 layers/build、format、lint、typecheck、全套 test 和所有 packed consumption |
| Silvermoon worktree / staged | 均通过（exit 0）；提交前再次核对最终快照 |

首轮全仓检查暴露现有规则不支持隐式 `.js` → `.tsx` 的源码映射；
已改为明确 `.tsx` 引用和 TypeScript 5.9 `rewriteRelativeImportExtensions`，
产物仍引用 `.js`。现有 monorepo pilot 定向 2/2 通过，随后全仓完整重跑通过；
没有修改通用检查规则或用豁免掩盖问题。

实际 browser entry 仍覆盖 HTTP/SSE 两种取消交错、时钟回拨、清理后的原参数、
真实 HTTP 收藏 GET 反序与取消星标、Endpoint 隔离、写入/恢复读取双失败、
原冻结 Execution 查询翻页（忽略未应用的非法输入）、停止流后历史可分页。
Schema `$ref`/siblings、own-property、false/数组/局部 JSON 和未知提交身份测试均保留。

新增 `presentation.test.ts` 验证实际组件 data-slot、XSS 文本、分离描述不篡改活 DOM、
详情计数变化的焦点/展开、单模态层与延迟焦点恢复、原字段节点跨卸载保持、
忙状态及 300ms 防重复在 React 键控更新后仍有效。
入口测试改用兼容项目 Node 下限的 jsdom 26.1.0；纯 Schema 保留 linkedom。
模拟 DOM 不承担几何或原生 CSP 的证明。

## 独立原生 Chrome

通过 `fixture/browser-smoke.ts` 启动独立 Task Server、UI 与全新 headless Chrome
profile，全部使用自己拥有的随机端口/目录。没有连接用户 Chrome9223，
没有操作用户 UI64319/Backend61123、旧 UI62952/Backend61109 或历史61144服务。
每次脚本结束均关闭自己的 Backend/UI/Chrome，删除自己的 profile 与临时收藏。

已完成的原生复核：真实组件、宽屏单层顶栏、Popup Esc/焦点/输入保持；
持续 SSE 下 summary 与任务入口焦点稳定、事件计数变化不折叠；
关闭抽屉不取消 Task；终结与回收后 1600ms 状态文案不再变化；
14 条真实目录记录分页后抽屉不改列表宽度、100px 滚动、过滤文本或冻结摘要；
Task → Execution → Task 仅保留正确一个 Sheet；其他客户端执行目录；
390 CSS px 列表/主按钮/内部滚动抽屉不溢出；合法 nonce 样式生效，
正常操作零 CSP violation，反向探针的任意 inline script/style 被真正拒绝。

最终原生方向键、Tab 焦点循环与遮罩关闭也已通过。Chrome
`156.0.8078.79` 的截图及 [checks.json](evidence/v06/checks.json)
保存在 `evidence/v06/`，其中记录实际浏览器版本与所测 JS/CSS SHA-256。
宽屏列表宽度实测 1383 → 1383px，滚动 100 → 100px；
正常操作零 CSP violation，另有明确失败的 inline 负向探针。
失败的中间脚本只写入实现 worktree 的 `.cache`，随后清理，
不混入通过证据；早期失败包括测试对入场动画未等待和异步关闭抢焦点，
后者已修复并有自动化回归。

## 复现与限制

```powershell
pnpm --filter @potential-guide/task-engine-web-ui build
pnpm --filter @potential-guide/task-engine-web-ui exec tsx fixture\browser-smoke.ts `
  'C:\Program Files\Google\Chrome\Application\chrome.exe' `
  'D:\path\to\new-owned-evidence-directory' '9223,64319,61123,61144,62952,61109'
```

构建、隔离 fixture、UI-only 更新现有环境及 selectors 见
[工作台指南](../../../../../docs/task-engine-web-ui.md)。
关键抽屉选择器是 `#task-detail-sheet` / `#execution-detail-sheet`，
内容为 `#task-detail` / `#execution-detail`；关闭后不存在，需按
`[role="dialog"][data-state="open"]` 判断而非原生 `dialog.open`。

本轮未变更公共 API、授权或存储；沿用既有执行目录与收藏文件，无迁移。
仅验证本机安装的 Chrome 与 390 CSS px，不声称已覆盖其他浏览器、辅助技术，
或用户现有 profile 的缩放设置。父 Agent 独立 review/acceptance 仍待进行；
不改 Review、Ideal、events、Outer 或 D-*，不推送 primary，不发布 npm。

## v0.6.1：行内单 Glyph（2026-10-31）

基线 `535aadc6af78838d5debbe3f16fb19881579c6e7`，Ideal 未改。
仅在 `inlineButton` 与 `presentation.tsx` 集中标记/映射 13 类次级动作：
详情、重做、编辑重做、重新观察、暂停观察、原参数直接重做、编辑后重做、
重新读取事件历史、上移、下移、编辑保存参数、编辑后新建、查看来源/模板。
主要新建/提交、实体名称、取消和未知身份重试保持文字；实体名字恰好叫“重做”
也不会被错误图标化。原 `data-action`、稳定 key、回调、禁用/忙状态和 300ms 防重复保留。

使用既有 Lucide 和 shadcn Button ghost/icon。每个按钮只有一个装饰性 SVG，
原文字保留在 sr-only，另有准确中文 aria-label。启用的按钮由同版本官方
shadcn Tooltip 提供悬停/键盘提示和 aria-describedby；禁用时仍有名称及鼠标 title。
Tooltip 源码同样固定到 `96da9cc7f1aa10580a3741664e2a77c721206c00` 并沿用 MIT 许可。
没有修改依赖版本、业务模型、API、后端或 CSP。

实际检查：UI build/typecheck 通过，UI **48/48** 通过，`pnpm check` 完整通过。
新增单 Glyph/名称/稳定 key/原回调、主要与高风险文字不消失、实体名碰撞回归；
已有忙状态与快速双击测试同时覆盖 glyph 包装，真实入口仍验证暂停/重新观察。
Chrome 156 独立 profile 验证悬停提示、Tab 聚焦及描述关联、Esc 提示关闭、
Enter 原详情动作、原参数编辑/新身份重做、两条草稿图标排序及快捷提交不发送草稿。
全部既有抽屉/SSE/390 CSS px 检查继续通过；正常操作零 CSP violation，
inline script/style 负向探针仍被拒绝。

通过证据与所测 JS/CSS SHA-256 见 [checks.json](evidence/v061/checks.json)，
另存悬停提示、队列、详情与窄屏截图。仅使用自有 fixture/profile/随机端口，
均已关闭并清理；未连接用户 Chrome9223 或改动用户服务/星标文件。
Silvermoon worktree/staged 检查均通过（exit 0）；本记录不代表独立审阅或接受。
