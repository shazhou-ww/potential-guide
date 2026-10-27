# Check Host

Not run — documentation only; bindings and test results are not validated.

Generated from YAML. Commands are text, never executed by the renderer.

<a id="ready.idle"></a>
## ready.idle: 活动列表为空

### Enter (root → state)

#### transition_isolated: 独立场景目录

所有命令均在仓库 packages\test-tree 目录执行，先在仓库根执行 pnpm build。
使用 Node >=22.13 和 pnpm >=11.22；不要使用用户默认 Host。
打开 PowerShell A，执行：
```powershell
$case = pnpm exec tsx test\check-host\manual.ts prepare
$case
```
记录输出的绝对目录；它位于仓库 .cache\tree-host\case-<随机标识>。
prepare 复制真正的 worker.cjs，建立 artifact 与 controls 子目录并记录所有权。
若准备失败，它删除自己部分创建的目录并明确报错，不进入下一步。


#### transition_ready: 鉴权 HTTP Host 已就绪

在 PowerShell A 保持前台运行：
```powershell
pnpm exec tsx test\check-host\manual.ts serve "$case"
```
等待 Ready 消息；该消息只在鉴权 GET /checks 返回 200 后出现。
这是独立真实 CheckKernel、HTTP server 和 worker，不连接默认 discovery。
打开同目录的 PowerShell B，把 A 输出的绝对目录赋给 $case：
```powershell
$case = '替换成 prepare 输出的绝对目录'
```
后续命令在 B 执行。凭据保存在受保护的 manual-host.json；不要打印或复制其内容。
若启动在返回 Ready 前失败，serve 会关闭部分创建的 Host/kernel；失败时保留诊断。


### Check ready.idle

```powershell
pnpm exec tsx test\check-host\manual.ts inspect "$case" idle
```
读取鉴权 GET /checks，预期 200 与 []，输出 OK；非 200 或非空则命令失败。


### Cleanup (reverse order)

#### after ready

若启动过 held 任务，先按 running 的 after 释放屏障。
然后在 A 按 Ctrl+C（或输入 stop 并回车），等待 “Owned Host and workers stopped.”。
server 停止接收请求，kernel 确认 worker 退出；不使用按名称结束进程。
若启动失败且清理未确认，不执行目录删除，保留错误。


#### after isolated

在 A 中停止本场景 Host，看到 “Owned Host and workers stopped.” 后才删除目录：
```powershell
pnpm exec tsx test\check-host\manual.ts clean "$case"
```
若尚未启动 Host，也可以直接 clean。若停止失败，保留目录及错误供诊断，不删除资源。
clean 只接受 prepare 创建的目录，拒绝删除仍有活动 Host PID 的目录；不停止其他进程。


<a id="running.input"></a>
## running.input: 输入标记、调用次数及活动列表正确

### Enter (root → state)

#### transition_isolated: 独立场景目录

所有命令均在仓库 packages\test-tree 目录执行，先在仓库根执行 pnpm build。
使用 Node >=22.13 和 pnpm >=11.22；不要使用用户默认 Host。
打开 PowerShell A，执行：
```powershell
$case = pnpm exec tsx test\check-host\manual.ts prepare
$case
```
记录输出的绝对目录；它位于仓库 .cache\tree-host\case-<随机标识>。
prepare 复制真正的 worker.cjs，建立 artifact 与 controls 子目录并记录所有权。
若准备失败，它删除自己部分创建的目录并明确报错，不进入下一步。


#### transition_ready: 鉴权 HTTP Host 已就绪

在 PowerShell A 保持前台运行：
```powershell
pnpm exec tsx test\check-host\manual.ts serve "$case"
```
等待 Ready 消息；该消息只在鉴权 GET /checks 返回 200 后出现。
这是独立真实 CheckKernel、HTTP server 和 worker，不连接默认 discovery。
打开同目录的 PowerShell B，把 A 输出的绝对目录赋给 $case：
```powershell
$case = '替换成 prepare 输出的绝对目录'
```
后续命令在 B 执行。凭据保存在受保护的 manual-host.json；不要打印或复制其内容。
若启动在返回 Ready 前失败，serve 会关闭部分创建的 Host/kernel；失败时保留诊断。


#### transition_running: 可取消任务已进入执行

```powershell
pnpm exec tsx test\check-host\manual.ts run "$case"
```
POST /checks 提交 checkId=held，输入 marker=tree-manual、hold=true。
run 等待 GET /checks/held 返回 Running 且含 entered 进度；不能仅凭提交成功继续。
worker 等待取消；其 defer 在 controls\release 出现前保持清理屏障。
准备/等待失败时自动测试转移自行释放和取消部分任务；人工执行失败也应执行下述 finish。
本次人工路径应在两分钟执行期限内推进；若超时，重新建立独立场景，不把超时视为成功。


### Check running.input

```powershell
pnpm exec tsx test\check-host\manual.ts inspect "$case" running
```
预期 Running，progress={entered:true,marker:"tree-manual",calls:1}，
活动列表恰有一项。inspect 只读取 HTTP/文件，不建立状态。


### Cleanup (reverse order)

#### after running

无论进入 run 或后续检查是否成功，在 B 执行：
```powershell
pnpm exec tsx test\check-host\manual.ts finish "$case"
```
写 controls\release 释放自有屏障；任务仍活跃时发送 cancel 并等待终态。
尚未创建 held 时无需取消；其他错误明确失败。完成后才能停止 Host。
这是释放任务资源，不是恢复父状态；不要复用该目录重新跑另一条路径。


#### after ready

若启动过 held 任务，先按 running 的 after 释放屏障。
然后在 A 按 Ctrl+C（或输入 stop 并回车），等待 “Owned Host and workers stopped.”。
server 停止接收请求，kernel 确认 worker 退出；不使用按名称结束进程。
若启动失败且清理未确认，不执行目录删除，保留错误。


#### after isolated

在 A 中停止本场景 Host，看到 “Owned Host and workers stopped.” 后才删除目录：
```powershell
pnpm exec tsx test\check-host\manual.ts clean "$case"
```
若尚未启动 Host，也可以直接 clean。若停止失败，保留目录及错误供诊断，不删除资源。
clean 只接受 prepare 创建的目录，拒绝删除仍有活动 Host PID 的目录；不停止其他进程。


<a id="cancelling.waiting"></a>
## cancelling.waiting: 清理完成前没有终态

### Enter (root → state)

#### transition_isolated: 独立场景目录

所有命令均在仓库 packages\test-tree 目录执行，先在仓库根执行 pnpm build。
使用 Node >=22.13 和 pnpm >=11.22；不要使用用户默认 Host。
打开 PowerShell A，执行：
```powershell
$case = pnpm exec tsx test\check-host\manual.ts prepare
$case
```
记录输出的绝对目录；它位于仓库 .cache\tree-host\case-<随机标识>。
prepare 复制真正的 worker.cjs，建立 artifact 与 controls 子目录并记录所有权。
若准备失败，它删除自己部分创建的目录并明确报错，不进入下一步。


#### transition_ready: 鉴权 HTTP Host 已就绪

在 PowerShell A 保持前台运行：
```powershell
pnpm exec tsx test\check-host\manual.ts serve "$case"
```
等待 Ready 消息；该消息只在鉴权 GET /checks 返回 200 后出现。
这是独立真实 CheckKernel、HTTP server 和 worker，不连接默认 discovery。
打开同目录的 PowerShell B，把 A 输出的绝对目录赋给 $case：
```powershell
$case = '替换成 prepare 输出的绝对目录'
```
后续命令在 B 执行。凭据保存在受保护的 manual-host.json；不要打印或复制其内容。
若启动在返回 Ready 前失败，serve 会关闭部分创建的 Host/kernel；失败时保留诊断。


#### transition_running: 可取消任务已进入执行

```powershell
pnpm exec tsx test\check-host\manual.ts run "$case"
```
POST /checks 提交 checkId=held，输入 marker=tree-manual、hold=true。
run 等待 GET /checks/held 返回 Running 且含 entered 进度；不能仅凭提交成功继续。
worker 等待取消；其 defer 在 controls\release 出现前保持清理屏障。
准备/等待失败时自动测试转移自行释放和取消部分任务；人工执行失败也应执行下述 finish。
本次人工路径应在两分钟执行期限内推进；若超时，重新建立独立场景，不把超时视为成功。


#### transition_cancelling: 取消已请求、清理仍被屏障保持

```powershell
pnpm exec tsx test\check-host\manual.ts cancel "$case"
```
发送 POST /checks/held/cancel，等待 Cancelling 及 controls\cleaning 文件。
不创建 release 文件，保持清理屏障。取消请求不等于任务资源已经退出。


### Check cancelling.waiting

```powershell
pnpm exec tsx test\check-host\manual.ts inspect "$case" cancelling
```
预期 HTTP 快照为 Cancelling，cleaning 已存在，controls\cleaned 尚不存在。


### Cleanup (reverse order)

#### after cancelling

本步没有新增资源，显式空收尾；held 的清理由 running 的 after 负责。

#### after running

无论进入 run 或后续检查是否成功，在 B 执行：
```powershell
pnpm exec tsx test\check-host\manual.ts finish "$case"
```
写 controls\release 释放自有屏障；任务仍活跃时发送 cancel 并等待终态。
尚未创建 held 时无需取消；其他错误明确失败。完成后才能停止 Host。
这是释放任务资源，不是恢复父状态；不要复用该目录重新跑另一条路径。


#### after ready

若启动过 held 任务，先按 running 的 after 释放屏障。
然后在 A 按 Ctrl+C（或输入 stop 并回车），等待 “Owned Host and workers stopped.”。
server 停止接收请求，kernel 确认 worker 退出；不使用按名称结束进程。
若启动失败且清理未确认，不执行目录删除，保留错误。


#### after isolated

在 A 中停止本场景 Host，看到 “Owned Host and workers stopped.” 后才删除目录：
```powershell
pnpm exec tsx test\check-host\manual.ts clean "$case"
```
若尚未启动 Host，也可以直接 clean。若停止失败，保留目录及错误供诊断，不删除资源。
clean 只接受 prepare 创建的目录，拒绝删除仍有活动 Host PID 的目录；不停止其他进程。


<a id="cancelled.released"></a>
## cancelled.released: 终态、清理标记与空活动列表一致

### Enter (root → state)

#### transition_isolated: 独立场景目录

所有命令均在仓库 packages\test-tree 目录执行，先在仓库根执行 pnpm build。
使用 Node >=22.13 和 pnpm >=11.22；不要使用用户默认 Host。
打开 PowerShell A，执行：
```powershell
$case = pnpm exec tsx test\check-host\manual.ts prepare
$case
```
记录输出的绝对目录；它位于仓库 .cache\tree-host\case-<随机标识>。
prepare 复制真正的 worker.cjs，建立 artifact 与 controls 子目录并记录所有权。
若准备失败，它删除自己部分创建的目录并明确报错，不进入下一步。


#### transition_ready: 鉴权 HTTP Host 已就绪

在 PowerShell A 保持前台运行：
```powershell
pnpm exec tsx test\check-host\manual.ts serve "$case"
```
等待 Ready 消息；该消息只在鉴权 GET /checks 返回 200 后出现。
这是独立真实 CheckKernel、HTTP server 和 worker，不连接默认 discovery。
打开同目录的 PowerShell B，把 A 输出的绝对目录赋给 $case：
```powershell
$case = '替换成 prepare 输出的绝对目录'
```
后续命令在 B 执行。凭据保存在受保护的 manual-host.json；不要打印或复制其内容。
若启动在返回 Ready 前失败，serve 会关闭部分创建的 Host/kernel；失败时保留诊断。


#### transition_running: 可取消任务已进入执行

```powershell
pnpm exec tsx test\check-host\manual.ts run "$case"
```
POST /checks 提交 checkId=held，输入 marker=tree-manual、hold=true。
run 等待 GET /checks/held 返回 Running 且含 entered 进度；不能仅凭提交成功继续。
worker 等待取消；其 defer 在 controls\release 出现前保持清理屏障。
准备/等待失败时自动测试转移自行释放和取消部分任务；人工执行失败也应执行下述 finish。
本次人工路径应在两分钟执行期限内推进；若超时，重新建立独立场景，不把超时视为成功。


#### transition_cancelling: 取消已请求、清理仍被屏障保持

```powershell
pnpm exec tsx test\check-host\manual.ts cancel "$case"
```
发送 POST /checks/held/cancel，等待 Cancelling 及 controls\cleaning 文件。
不创建 release 文件，保持清理屏障。取消请求不等于任务资源已经退出。


#### transition_cancelled: 已取消且资源已释放

```powershell
pnpm exec tsx test\check-host\manual.ts release "$case"
```
创建 controls\release，等待 HTTP 观察流终态 Cancelled；命令超时或其他终态都失败。


### Check cancelled.released

```powershell
pnpm exec tsx test\check-host\manual.ts inspect "$case" cancelled
```
预期 Cancelled、controls\cleaned 已存在、GET /checks 返回 []。


### Cleanup (reverse order)

#### after cancelled

本步没有新增资源，显式空收尾；不虚构反向恢复操作。

#### after cancelling

本步没有新增资源，显式空收尾；held 的清理由 running 的 after 负责。

#### after running

无论进入 run 或后续检查是否成功，在 B 执行：
```powershell
pnpm exec tsx test\check-host\manual.ts finish "$case"
```
写 controls\release 释放自有屏障；任务仍活跃时发送 cancel 并等待终态。
尚未创建 held 时无需取消；其他错误明确失败。完成后才能停止 Host。
这是释放任务资源，不是恢复父状态；不要复用该目录重新跑另一条路径。


#### after ready

若启动过 held 任务，先按 running 的 after 释放屏障。
然后在 A 按 Ctrl+C（或输入 stop 并回车），等待 “Owned Host and workers stopped.”。
server 停止接收请求，kernel 确认 worker 退出；不使用按名称结束进程。
若启动失败且清理未确认，不执行目录删除，保留错误。


#### after isolated

在 A 中停止本场景 Host，看到 “Owned Host and workers stopped.” 后才删除目录：
```powershell
pnpm exec tsx test\check-host\manual.ts clean "$case"
```
若尚未启动 Host，也可以直接 clean。若停止失败，保留目录及错误供诊断，不删除资源。
clean 只接受 prepare 创建的目录，拒绝删除仍有活动 Host PID 的目录；不停止其他进程。


<a id="faulted.failure"></a>
## faulted.failure: 故障原因可见、活动列表已释放

### Enter (root → state)

#### transition_isolated: 独立场景目录

所有命令均在仓库 packages\test-tree 目录执行，先在仓库根执行 pnpm build。
使用 Node >=22.13 和 pnpm >=11.22；不要使用用户默认 Host。
打开 PowerShell A，执行：
```powershell
$case = pnpm exec tsx test\check-host\manual.ts prepare
$case
```
记录输出的绝对目录；它位于仓库 .cache\tree-host\case-<随机标识>。
prepare 复制真正的 worker.cjs，建立 artifact 与 controls 子目录并记录所有权。
若准备失败，它删除自己部分创建的目录并明确报错，不进入下一步。


#### transition_ready: 鉴权 HTTP Host 已就绪

在 PowerShell A 保持前台运行：
```powershell
pnpm exec tsx test\check-host\manual.ts serve "$case"
```
等待 Ready 消息；该消息只在鉴权 GET /checks 返回 200 后出现。
这是独立真实 CheckKernel、HTTP server 和 worker，不连接默认 discovery。
打开同目录的 PowerShell B，把 A 输出的绝对目录赋给 $case：
```powershell
$case = '替换成 prepare 输出的绝对目录'
```
后续命令在 B 执行。凭据保存在受保护的 manual-host.json；不要打印或复制其内容。
若启动在返回 Ready 前失败，serve 会关闭部分创建的 Host/kernel；失败时保留诊断。


#### transition_faulted: 注入执行异常的预期故障状态

从全新 isolated → ready 路径开始，不执行 running 分支。
```powershell
pnpm exec tsx test\check-host\manual.ts fault "$case"
```
提交 checkId=fault、fail=true；等待 Failed。这是执行异常，不是业务结果不通过。
成功进入预期故障状态不等于测试框架执行失败。


### Check faulted.failure

```powershell
pnpm exec tsx test\check-host\manual.ts inspect "$case" faulted
```
预期 Failed，error 包含 manual injected failure，GET /checks 返回 []。


### Cleanup (reverse order)

#### after faulted

本步没有新增资源，任务已终结；显式空收尾，Host 资源仍由 ready 负责。

#### after ready

若启动过 held 任务，先按 running 的 after 释放屏障。
然后在 A 按 Ctrl+C（或输入 stop 并回车），等待 “Owned Host and workers stopped.”。
server 停止接收请求，kernel 确认 worker 退出；不使用按名称结束进程。
若启动失败且清理未确认，不执行目录删除，保留错误。


#### after isolated

在 A 中停止本场景 Host，看到 “Owned Host and workers stopped.” 后才删除目录：
```powershell
pnpm exec tsx test\check-host\manual.ts clean "$case"
```
若尚未启动 Host，也可以直接 clean。若停止失败，保留目录及错误供诊断，不删除资源。
clean 只接受 prepare 创建的目录，拒绝删除仍有活动 Host PID 的目录；不停止其他进程。


<a id="recovered.result"></a>
## recovered.result: 真实业务结果与 worker 复用正确

### Enter (root → state)

#### transition_isolated: 独立场景目录

所有命令均在仓库 packages\test-tree 目录执行，先在仓库根执行 pnpm build。
使用 Node >=22.13 和 pnpm >=11.22；不要使用用户默认 Host。
打开 PowerShell A，执行：
```powershell
$case = pnpm exec tsx test\check-host\manual.ts prepare
$case
```
记录输出的绝对目录；它位于仓库 .cache\tree-host\case-<随机标识>。
prepare 复制真正的 worker.cjs，建立 artifact 与 controls 子目录并记录所有权。
若准备失败，它删除自己部分创建的目录并明确报错，不进入下一步。


#### transition_ready: 鉴权 HTTP Host 已就绪

在 PowerShell A 保持前台运行：
```powershell
pnpm exec tsx test\check-host\manual.ts serve "$case"
```
等待 Ready 消息；该消息只在鉴权 GET /checks 返回 200 后出现。
这是独立真实 CheckKernel、HTTP server 和 worker，不连接默认 discovery。
打开同目录的 PowerShell B，把 A 输出的绝对目录赋给 $case：
```powershell
$case = '替换成 prepare 输出的绝对目录'
```
后续命令在 B 执行。凭据保存在受保护的 manual-host.json；不要打印或复制其内容。
若启动在返回 Ready 前失败，serve 会关闭部分创建的 Host/kernel；失败时保留诊断。


#### transition_faulted: 注入执行异常的预期故障状态

从全新 isolated → ready 路径开始，不执行 running 分支。
```powershell
pnpm exec tsx test\check-host\manual.ts fault "$case"
```
提交 checkId=fault、fail=true；等待 Failed。这是执行异常，不是业务结果不通过。
成功进入预期故障状态不等于测试框架执行失败。


#### transition_recovered: 同一 Host 可再次正常执行

```powershell
pnpm exec tsx test\check-host\manual.ts recover "$case"
```
提交同一 artifact 的 checkId=recovery，等待 Completed，确认不是仅 HTTP 可连接。


### Check recovered.result

```powershell
pnpm exec tsx test\check-host\manual.ts inspect "$case" recovered
```
预期原 checkId=fault 仍为 Failed，error 仍为 Error: manual injected failure，
没有被重放或改写；新 checkId=recovery 为 Completed，
result={marker:"tree-manual",calls:2}，活动列表 []。


### Cleanup (reverse order)

#### after recovered

本步没有新增资源，显式空收尾；不会把故障历史改写为成功。

#### after faulted

本步没有新增资源，任务已终结；显式空收尾，Host 资源仍由 ready 负责。

#### after ready

若启动过 held 任务，先按 running 的 after 释放屏障。
然后在 A 按 Ctrl+C（或输入 stop 并回车），等待 “Owned Host and workers stopped.”。
server 停止接收请求，kernel 确认 worker 退出；不使用按名称结束进程。
若启动失败且清理未确认，不执行目录删除，保留错误。


#### after isolated

在 A 中停止本场景 Host，看到 “Owned Host and workers stopped.” 后才删除目录：
```powershell
pnpm exec tsx test\check-host\manual.ts clean "$case"
```
若尚未启动 Host，也可以直接 clean。若停止失败，保留目录及错误供诊断，不删除资源。
clean 只接受 prepare 创建的目录，拒绝删除仍有活动 Host PID 的目录；不停止其他进程。
