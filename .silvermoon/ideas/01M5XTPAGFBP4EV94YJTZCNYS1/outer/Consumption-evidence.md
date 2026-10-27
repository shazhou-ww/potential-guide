# 现实消费验证证据

## 候选身份与执行边界

- Idea：`01M5XTPAGFBP4EV94YJTZCNYS1`（`test-tree-manual`）。
- 已接受实施：`da3482c0b57bb8426a0a8acc34854234a991ab9e`，
  `acceptInner#9` 已同步于 `09065847d614871b7abd36862beab0cc3a716466`。
- 外部验证开始前，已将细化后的 Deployment 契约同步至 primary
  `327fcc635d4f1acde55303420893f8071e667da3`，重新观测到稳定
  `deploymentRevision=d752db2560ef7ceca45fcb4d96f26ce178e5a82f`。
  以下验证针对该契约；之后仅添加本世界消费证据、派生产物和执行清单完成项。
- 环境：Windows，Node `v24.12.0`，pnpm `11.22.0`；
  实际操作日期为 2026-10-27，时间均为 UTC+08:00。
- 未修改已接受的 ideal/inner、工具、测试、原 YAML 或仓库 docs；
  未执行 `manual.test.ts` 或任何实施测试来代替消费操作，
  未发布 npm、未部署公共站点、未记录任何 acceptance。

## D-S01 / D-AC01：实际生成与离线浏览

### 三种产物

在仓库根执行 `pnpm build`，退出码 0；随后以同一份 YAML 实际执行下列命令，
生成时间为 14:14:49：

```powershell
$outer = 'D:\Code\potential-guide.worktrees\test-tree-manual-idea\.silvermoon\ideas\01M5XTPAGFBP4EV94YJTZCNYS1\outer\consumption'
pnpm --filter @potential-guide/test-tree manual test\check-host\host.states.yaml tree "$outer\host-tree.txt"
pnpm --filter @potential-guide/test-tree manual test\check-host\host.states.yaml markdown "$outer\host-manual.md"
pnpm --filter @potential-guide/test-tree manual test\check-host\host.states.yaml html "$outer\host-manual.html"
```

三个命令均退出 0。终端树实际输出六个稳定检查：
`ready.idle`、`running.input`、`cancelling.waiting`、`cancelled.released`、
`faulted.failure`、`recovered.result`；Markdown 和浏览器中的六个 article ID 一致。
所有产物仍明确标记 `Not run`，没有将文档生成宣称为测试通过。

| 文件 | 实际 SHA-256 |
| --- | --- |
| `packages/test-tree/test/check-host/host.states.yaml` | `1CDC26184B075CAC17F297D2460EA210FEB39F7D3164C141495BD852389283E3` |
| [终端树](./consumption/host-tree.txt) | `714B2EB3636B5412ADA69CDADE6F151FB91B6138E17D269E7E4F51C2AE2A5D4A` |
| [Markdown](./consumption/host-manual.md) | `71EFE85981E4AA7649D8AD72A8E8917A6962D9EA574BEF94CC73D8770CE47EA3` |
| [离线 HTML](./consumption/host-manual.html) | `699CD0D6839A3769E9559AA10643DC0BC849601DC6857871A4307A7E746D4A43` |

### 真实浏览器操作

使用集成浏览器工具打开，而不是用字符串断言模拟：

```text
file:///D:/Code/potential-guide.worktrees/test-tree-manual-idea/.silvermoon/ideas/01M5XTPAGFBP4EV94YJTZCNYS1/outer/consumption/host-manual.html
```

实际页面标题 `Check Host`；浏览器为 Windows 上的
Code `1.144.0` / Chromium `150.0.7871.250` / Electron `43.8.3`。
没有为展示启动 HTTP 服务。随后仅对本验证页面阻断全部 `http:` / `https:` 请求并重载，
页面仍可读取和交互，实际资源列表为 `[]`，`document.scripts.length=0`。

实际交互与观察：

1. ready 初始 `open=true`。点击其原生 summary 后 `open=false`，
   running 后代的 `checkVisibility()` 为 false。
   再点击后 `open=true`，后代可见；不是直接修改 DOM 属性伪造结果。
2. 点击 cancelled 检查链接，浏览器地址真实变为 `#cancelled.released`，
   目标 article 可见。页面读取的标题顺序为：

   ```text
   Enter (root → state)
   transition_isolated
   transition_ready
   transition_running
   transition_cancelling
   transition_cancelled
   Check cancelled.released
   Cleanup (reverse order)
   after cancelled
   after cancelling
   after running
   after ready
   after isolated
   ```

3. 点击 recovered 检查链接，地址变为 `#recovered.result`，article 可见：

   ```text
   Enter (root → state)
   transition_isolated
   transition_ready
   transition_faulted
   transition_recovered
   Check recovered.result
   Cleanup (reverse order)
   after recovered
   after faulted
   after ready
   after isolated
   ```

4. 该检查的页面文本实际含原 fault 仍为 Failed、原始异常不变、
   新 recovery 为 Completed、calls=2、活动列表为空的说明；
   命令以可选择的文本展示，没有执行按钮或脚本。
5. 阻断 HTTP/HTTPS 并重载后，再次完成折叠/展开及两个锚点跳转，
   两条完整路径仍可读。

浏览器工具的普通 `clickElement` 两次在 actionability 等待中超时；
同一页面改用 Playwright 原生 `locator.click({force:true})` 后完成真实点击。
没有改页面实现、设置 open 属性或把失败静默标为通过。
截图由该真实浏览器保存：
[离线树](./consumption/offline-tree.png)、
[cancelled 路径](./consumption/cancelled-path.png)、
[recovered 路径](./consumption/recovered-path.png)。
截图显示路径首屏；完整顺序另由上述浏览器实际 DOM 读取结果记录。

## D-S02 / D-AC02：独立进程逐条消费手册

操作依据刚生成的手册，不从测试实现推断隐藏步骤。以下命令在
`D:\Code\potential-guide.worktrees\test-tree-manual-idea\packages\test-tree`
执行。A 是独立前台 Host 命令，B 是分别启动的操作命令。
由于执行工具没有交互 stdin，A 的进程包装器仅转发标准输入/输出，
结束时写入手册已列出的 `stop` 换行；没有运行测试、复制状态树或替代任何 Host 操作。

### 场景一：运行、取消屏障与释放

14:16:58 实际执行：

```powershell
$case = pnpm exec tsx test\check-host\manual.ts prepare
pnpm exec tsx test\check-host\manual.ts serve "$case"   # A，持续运行
```

本次自有目录：

```text
D:\Code\potential-guide.worktrees\test-tree-manual-idea\.cache\tree-host\case-9ed0caf2-bf24-4eb0-9d75-87a1781a0aa0
```

A 实际报告 Ready（仅在鉴权就绪后输出），端点 `http://127.0.0.1:58390`；
Host PID `43016`，命令包装 PID `51276`，均为本次新建实例。
B 逐条执行：

```powershell
pnpm exec tsx test\check-host\manual.ts inspect "$case" idle
pnpm exec tsx test\check-host\manual.ts run "$case"
pnpm exec tsx test\check-host\manual.ts inspect "$case" running
pnpm exec tsx test\check-host\manual.ts cancel "$case"
pnpm exec tsx test\check-host\manual.ts inspect "$case" cancelling
pnpm exec tsx test\check-host\manual.ts release "$case"
pnpm exec tsx test\check-host\manual.ts inspect "$case" cancelled
pnpm exec tsx test\check-host\manual.ts finish "$case"
```

每条命令退出 0，输出相应 `OK ... (no credentials displayed)`。
另通过鉴权 HTTP 读取非敏感字段，实际结果：

| 时点 | 观察 |
| --- | --- |
| 14:17:33，run 后 | `held` 为 Running，progress=`{entered:true,marker:"tree-manual",calls:1}` |
| cancel 后 | `held` 为 Cancelling，`cleaning=True`、`cleaned=False`；尚未报告终态 |
| 14:17:47，release 后 | `held` 为 Cancelled，`cleaned=True`，活动列表条数 0 |

finish 后向 A 输入 `stop`。A 报告
`Owned Host and workers stopped.`，serve 命令退出 0；
再次查询 PID `43016` 已不存在，才执行：

```powershell
pnpm exec tsx test\check-host\manual.ts clean "$case"
```

clean 退出 0，目录存在性为 false。

### 场景二：执行异常与同 Host 恢复

14:17:58 在全新目录执行 prepare，再独立运行同一 serve 命令：

```text
D:\Code\potential-guide.worktrees\test-tree-manual-idea\.cache\tree-host\case-954c1f25-f92b-4488-b6fc-675d978844cd
```

A 报告 Ready，端点 `http://127.0.0.1:64000`；
Host PID `51584`，命令包装 PID `50780`。
B 逐条执行：

```powershell
pnpm exec tsx test\check-host\manual.ts inspect "$case" idle
pnpm exec tsx test\check-host\manual.ts fault "$case"
pnpm exec tsx test\check-host\manual.ts inspect "$case" faulted
pnpm exec tsx test\check-host\manual.ts recover "$case"
pnpm exec tsx test\check-host\manual.ts inspect "$case" recovered
```

每条命令退出 0，输出相应 OK。没有把执行异常混称为业务结果不通过。
恢复前后，分别实际读取 `/checks/fault`，只保留 `checkId/state/error`：

```json
{
  "checkId": "fault",
  "state": "Failed",
  "error": "Error: manual injected failure"
}
```

[恢复前](./consumption/fault-before.json)、
[恢复后](./consumption/fault-after.json)的实际去敏 JSON 完全相同，
现场精确字符串比较为 True；不是只验证新任务成功后推断旧任务未变。
[新任务实际快照](./consumption/recovery.json)为：

```json
{
  "checkId": "recovery",
  "state": "Completed",
  "result": {"marker": "tree-manual", "calls": 2}
}
```

14:18:23 另读活动列表条数为 0。向 A 输入 stop 后，
A 报告 `Owned Host and workers stopped.`，serve 退出 0。
确认 PID `51584` 不存在，再执行手册 clean，退出 0。
14:18:34 该目录不存在，`.cache/tree-host` 场景目录数为 0。

### 所有权与凭据边界

- 两个场景均使用 prepare 输出的独立目录及显式 serve 参数，没有发现或连接用户默认 Host。
- 所有 HTTP 凭据仅从本场景受保护的 `manual-host.json` 读入内存请求头；
  未打印 descriptor、token 或请求头，提交的 JSON 仅含上述安全字段。
- 没有按进程名终止进程，没有触发包装器的紧急终止分支。
  仅在各自 serve 明确确认 worker 收尾、实际 PID 已退出后运行 clean。
- 为检测越界清理，在场景目录之外放置一个验证哨兵；
  取消场景清理后及全部清理后，其 SHA-256 均与初始值一致：
  `416D581C51CB51D83ED886ED8083A800C3DD9E6BA717A5DDA50D1EE8B6B819FE`。
  验证结束后仅移除本次创建的哨兵与进程协调文件，不删除未知资源。

## 结论与门禁边界

最终实际 hash 比较确认：本次 Markdown/HTML 与已接受交付中的对应派生产物完全一致，
fault 恢复前后文件字节一致。相对 `09065847d614871b7abd36862beab0cc3a716466`
的 `packages`、`docs`、本 Idea `inner` Git diff 为空；
inner 仍为 `da3482c0b57bb8426a0a8acc34854234a991ab9e`，
ideal 仍为 `3f01c34df2dd0473a2bb4e500ca9f56e5756c3ce`。
`git diff --check` 与 Silvermoon worktree 检查通过。

D-S01、D-S02、D-AC01、D-AC02 的现实消费证据均已取得。
这次验证包含真实浏览器与独立命令进程，不是实施测试的重复通过声明。
主体世界和仓库交付物仍保持已接受版本；仅将本世界证据与清单同步后提交 submitOuter，
最终 acceptance 保留给上游。
