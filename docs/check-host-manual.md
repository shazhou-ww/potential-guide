# Check Host

Not run — documentation only; bindings and test results are not validated.

Generated from YAML. Commands are text, never executed by the renderer.

<a id="ready.idle"></a>
## ready.idle: 活动列表为空

### Enter (root → state)

#### transition_isolated: 独立场景目录

所有命令均在仓库根目录执行，先执行 pnpm build。
使用 Node >=22.13 和 pnpm >=11.22；不要使用用户默认 Host。
以下单行命令不依赖 shell 变量、管道、重定向或续行，可用于 PowerShell、cmd、bash 和 zsh。
打开终端 A，执行：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts prepare
```
记录输出的绝对目录；后续每条命令中的 SCENARIO_DIRECTORY 都必须手动替换为这个完整目录，
保留外层双引号，不要原样输入占位符。它位于仓库缓存的 tree-host 子目录。
命令中的脚本相对路径由 Node 在各平台解析，无需按操作系统改写分隔符。
文档命令采用 shell 中立写法；实际已验证平台以消费证据为准，不等于已经在所有平台实跑。
prepare 复制真正的 worker.cjs，建立 artifact 与 controls 子目录并记录所有权。
若准备失败，它删除自己部分创建的目录并明确报错，不进入下一步。


#### transition_ready: 鉴权 HTTP Host 已就绪

在终端 A 保持前台运行：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts serve "SCENARIO_DIRECTORY"
```
等待 Ready 消息；该消息只在鉴权 GET /checks 返回 200 后出现。
这是独立真实 CheckKernel、HTTP server 和 worker，不连接默认 discovery。
打开仓库根目录的终端 B，继续把每条命令中的 SCENARIO_DIRECTORY 替换为 prepare 输出的绝对目录。
后续命令在 B 执行。凭据保存在受保护的 manual-host.json；不要打印或复制其内容。
若启动在返回 Ready 前失败，serve 会关闭部分创建的 Host/kernel；失败时保留诊断。


### Check ready.idle

```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts inspect "SCENARIO_DIRECTORY" idle
```
读取鉴权 GET /checks，预期 200 与 []，输出 OK；非 200 或非空则命令失败。


### Cleanup (reverse order)

#### after ready

若启动过 held 任务，先按 running 的 after 释放屏障。
然后在 A 输入 stop 并回车，等待 “Owned Host and workers stopped.”。
stop 是运行中的 serve 接受的输入，不是另开 shell 执行的命令，也不依赖平台特有的进程信号。
server 停止接收请求，kernel 确认 worker 退出；不使用按名称结束进程。
若启动失败且清理未确认，不执行目录删除，保留错误。


#### after isolated

在 A 中停止本场景 Host，看到 “Owned Host and workers stopped.” 后才删除目录：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts clean "SCENARIO_DIRECTORY"
```
若尚未启动 Host，也可以直接 clean。若停止失败，保留目录及错误供诊断，不删除资源。
clean 只接受 prepare 创建的目录，拒绝删除仍有活动 Host PID 的目录；不停止其他进程。


<a id="running.input"></a>
## running.input: 输入标记、调用次数及活动列表正确

### Enter (root → state)

#### transition_isolated: 独立场景目录

所有命令均在仓库根目录执行，先执行 pnpm build。
使用 Node >=22.13 和 pnpm >=11.22；不要使用用户默认 Host。
以下单行命令不依赖 shell 变量、管道、重定向或续行，可用于 PowerShell、cmd、bash 和 zsh。
打开终端 A，执行：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts prepare
```
记录输出的绝对目录；后续每条命令中的 SCENARIO_DIRECTORY 都必须手动替换为这个完整目录，
保留外层双引号，不要原样输入占位符。它位于仓库缓存的 tree-host 子目录。
命令中的脚本相对路径由 Node 在各平台解析，无需按操作系统改写分隔符。
文档命令采用 shell 中立写法；实际已验证平台以消费证据为准，不等于已经在所有平台实跑。
prepare 复制真正的 worker.cjs，建立 artifact 与 controls 子目录并记录所有权。
若准备失败，它删除自己部分创建的目录并明确报错，不进入下一步。


#### transition_ready: 鉴权 HTTP Host 已就绪

在终端 A 保持前台运行：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts serve "SCENARIO_DIRECTORY"
```
等待 Ready 消息；该消息只在鉴权 GET /checks 返回 200 后出现。
这是独立真实 CheckKernel、HTTP server 和 worker，不连接默认 discovery。
打开仓库根目录的终端 B，继续把每条命令中的 SCENARIO_DIRECTORY 替换为 prepare 输出的绝对目录。
后续命令在 B 执行。凭据保存在受保护的 manual-host.json；不要打印或复制其内容。
若启动在返回 Ready 前失败，serve 会关闭部分创建的 Host/kernel；失败时保留诊断。


#### transition_running: 可取消任务已进入执行

```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts run "SCENARIO_DIRECTORY"
```
POST /checks 提交 checkId=held，输入 marker=tree-manual、hold=true。
run 等待 GET /checks/held 返回 Running 且含 entered 进度；不能仅凭提交成功继续。
worker 等待取消；其 defer 在场景的 controls 子目录中出现 release 文件前保持清理屏障。
准备/等待失败时自动测试转移自行释放和取消部分任务；人工执行失败也应执行下述 finish。
本次人工路径应在两分钟执行期限内推进；若超时，重新建立独立场景，不把超时视为成功。


### Check running.input

```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts inspect "SCENARIO_DIRECTORY" running
```
预期 Running，progress={entered:true,marker:"tree-manual",calls:1}，
活动列表恰有一项。inspect 只读取 HTTP/文件，不建立状态。


### Cleanup (reverse order)

#### after running

无论进入 run 或后续检查是否成功，在 B 执行：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts finish "SCENARIO_DIRECTORY"
```
写 controls 子目录的 release 文件释放自有屏障；任务仍活跃时发送 cancel 并等待终态。
尚未创建 held 时无需取消；其他错误明确失败。完成后才能停止 Host。
这是释放任务资源，不是恢复父状态；不要复用该目录重新跑另一条路径。


#### after ready

若启动过 held 任务，先按 running 的 after 释放屏障。
然后在 A 输入 stop 并回车，等待 “Owned Host and workers stopped.”。
stop 是运行中的 serve 接受的输入，不是另开 shell 执行的命令，也不依赖平台特有的进程信号。
server 停止接收请求，kernel 确认 worker 退出；不使用按名称结束进程。
若启动失败且清理未确认，不执行目录删除，保留错误。


#### after isolated

在 A 中停止本场景 Host，看到 “Owned Host and workers stopped.” 后才删除目录：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts clean "SCENARIO_DIRECTORY"
```
若尚未启动 Host，也可以直接 clean。若停止失败，保留目录及错误供诊断，不删除资源。
clean 只接受 prepare 创建的目录，拒绝删除仍有活动 Host PID 的目录；不停止其他进程。


<a id="cancelling.waiting"></a>
## cancelling.waiting: 清理完成前没有终态

### Enter (root → state)

#### transition_isolated: 独立场景目录

所有命令均在仓库根目录执行，先执行 pnpm build。
使用 Node >=22.13 和 pnpm >=11.22；不要使用用户默认 Host。
以下单行命令不依赖 shell 变量、管道、重定向或续行，可用于 PowerShell、cmd、bash 和 zsh。
打开终端 A，执行：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts prepare
```
记录输出的绝对目录；后续每条命令中的 SCENARIO_DIRECTORY 都必须手动替换为这个完整目录，
保留外层双引号，不要原样输入占位符。它位于仓库缓存的 tree-host 子目录。
命令中的脚本相对路径由 Node 在各平台解析，无需按操作系统改写分隔符。
文档命令采用 shell 中立写法；实际已验证平台以消费证据为准，不等于已经在所有平台实跑。
prepare 复制真正的 worker.cjs，建立 artifact 与 controls 子目录并记录所有权。
若准备失败，它删除自己部分创建的目录并明确报错，不进入下一步。


#### transition_ready: 鉴权 HTTP Host 已就绪

在终端 A 保持前台运行：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts serve "SCENARIO_DIRECTORY"
```
等待 Ready 消息；该消息只在鉴权 GET /checks 返回 200 后出现。
这是独立真实 CheckKernel、HTTP server 和 worker，不连接默认 discovery。
打开仓库根目录的终端 B，继续把每条命令中的 SCENARIO_DIRECTORY 替换为 prepare 输出的绝对目录。
后续命令在 B 执行。凭据保存在受保护的 manual-host.json；不要打印或复制其内容。
若启动在返回 Ready 前失败，serve 会关闭部分创建的 Host/kernel；失败时保留诊断。


#### transition_running: 可取消任务已进入执行

```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts run "SCENARIO_DIRECTORY"
```
POST /checks 提交 checkId=held，输入 marker=tree-manual、hold=true。
run 等待 GET /checks/held 返回 Running 且含 entered 进度；不能仅凭提交成功继续。
worker 等待取消；其 defer 在场景的 controls 子目录中出现 release 文件前保持清理屏障。
准备/等待失败时自动测试转移自行释放和取消部分任务；人工执行失败也应执行下述 finish。
本次人工路径应在两分钟执行期限内推进；若超时，重新建立独立场景，不把超时视为成功。


#### transition_cancelling: 取消已请求、清理仍被屏障保持

```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts cancel "SCENARIO_DIRECTORY"
```
发送 POST /checks/held/cancel，等待 Cancelling 及 controls 子目录的 cleaning 文件。
不创建 release 文件，保持清理屏障。取消请求不等于任务资源已经退出。


### Check cancelling.waiting

```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts inspect "SCENARIO_DIRECTORY" cancelling
```
预期 HTTP 快照为 Cancelling，controls 子目录中 cleaning 已存在、cleaned 尚不存在。


### Cleanup (reverse order)

#### after cancelling

本步没有新增资源，显式空收尾；held 的清理由 running 的 after 负责。

#### after running

无论进入 run 或后续检查是否成功，在 B 执行：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts finish "SCENARIO_DIRECTORY"
```
写 controls 子目录的 release 文件释放自有屏障；任务仍活跃时发送 cancel 并等待终态。
尚未创建 held 时无需取消；其他错误明确失败。完成后才能停止 Host。
这是释放任务资源，不是恢复父状态；不要复用该目录重新跑另一条路径。


#### after ready

若启动过 held 任务，先按 running 的 after 释放屏障。
然后在 A 输入 stop 并回车，等待 “Owned Host and workers stopped.”。
stop 是运行中的 serve 接受的输入，不是另开 shell 执行的命令，也不依赖平台特有的进程信号。
server 停止接收请求，kernel 确认 worker 退出；不使用按名称结束进程。
若启动失败且清理未确认，不执行目录删除，保留错误。


#### after isolated

在 A 中停止本场景 Host，看到 “Owned Host and workers stopped.” 后才删除目录：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts clean "SCENARIO_DIRECTORY"
```
若尚未启动 Host，也可以直接 clean。若停止失败，保留目录及错误供诊断，不删除资源。
clean 只接受 prepare 创建的目录，拒绝删除仍有活动 Host PID 的目录；不停止其他进程。


<a id="cancelled.released"></a>
## cancelled.released: 终态、清理标记与空活动列表一致

### Enter (root → state)

#### transition_isolated: 独立场景目录

所有命令均在仓库根目录执行，先执行 pnpm build。
使用 Node >=22.13 和 pnpm >=11.22；不要使用用户默认 Host。
以下单行命令不依赖 shell 变量、管道、重定向或续行，可用于 PowerShell、cmd、bash 和 zsh。
打开终端 A，执行：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts prepare
```
记录输出的绝对目录；后续每条命令中的 SCENARIO_DIRECTORY 都必须手动替换为这个完整目录，
保留外层双引号，不要原样输入占位符。它位于仓库缓存的 tree-host 子目录。
命令中的脚本相对路径由 Node 在各平台解析，无需按操作系统改写分隔符。
文档命令采用 shell 中立写法；实际已验证平台以消费证据为准，不等于已经在所有平台实跑。
prepare 复制真正的 worker.cjs，建立 artifact 与 controls 子目录并记录所有权。
若准备失败，它删除自己部分创建的目录并明确报错，不进入下一步。


#### transition_ready: 鉴权 HTTP Host 已就绪

在终端 A 保持前台运行：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts serve "SCENARIO_DIRECTORY"
```
等待 Ready 消息；该消息只在鉴权 GET /checks 返回 200 后出现。
这是独立真实 CheckKernel、HTTP server 和 worker，不连接默认 discovery。
打开仓库根目录的终端 B，继续把每条命令中的 SCENARIO_DIRECTORY 替换为 prepare 输出的绝对目录。
后续命令在 B 执行。凭据保存在受保护的 manual-host.json；不要打印或复制其内容。
若启动在返回 Ready 前失败，serve 会关闭部分创建的 Host/kernel；失败时保留诊断。


#### transition_running: 可取消任务已进入执行

```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts run "SCENARIO_DIRECTORY"
```
POST /checks 提交 checkId=held，输入 marker=tree-manual、hold=true。
run 等待 GET /checks/held 返回 Running 且含 entered 进度；不能仅凭提交成功继续。
worker 等待取消；其 defer 在场景的 controls 子目录中出现 release 文件前保持清理屏障。
准备/等待失败时自动测试转移自行释放和取消部分任务；人工执行失败也应执行下述 finish。
本次人工路径应在两分钟执行期限内推进；若超时，重新建立独立场景，不把超时视为成功。


#### transition_cancelling: 取消已请求、清理仍被屏障保持

```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts cancel "SCENARIO_DIRECTORY"
```
发送 POST /checks/held/cancel，等待 Cancelling 及 controls 子目录的 cleaning 文件。
不创建 release 文件，保持清理屏障。取消请求不等于任务资源已经退出。


#### transition_cancelled: 已取消且资源已释放

```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts release "SCENARIO_DIRECTORY"
```
创建 controls 子目录的 release 文件，等待 HTTP 观察流终态 Cancelled；命令超时或其他终态都失败。


### Check cancelled.released

```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts inspect "SCENARIO_DIRECTORY" cancelled
```
预期 Cancelled、controls 子目录的 cleaned 已存在、GET /checks 返回 []。


### Cleanup (reverse order)

#### after cancelled

本步没有新增资源，显式空收尾；不虚构反向恢复操作。

#### after cancelling

本步没有新增资源，显式空收尾；held 的清理由 running 的 after 负责。

#### after running

无论进入 run 或后续检查是否成功，在 B 执行：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts finish "SCENARIO_DIRECTORY"
```
写 controls 子目录的 release 文件释放自有屏障；任务仍活跃时发送 cancel 并等待终态。
尚未创建 held 时无需取消；其他错误明确失败。完成后才能停止 Host。
这是释放任务资源，不是恢复父状态；不要复用该目录重新跑另一条路径。


#### after ready

若启动过 held 任务，先按 running 的 after 释放屏障。
然后在 A 输入 stop 并回车，等待 “Owned Host and workers stopped.”。
stop 是运行中的 serve 接受的输入，不是另开 shell 执行的命令，也不依赖平台特有的进程信号。
server 停止接收请求，kernel 确认 worker 退出；不使用按名称结束进程。
若启动失败且清理未确认，不执行目录删除，保留错误。


#### after isolated

在 A 中停止本场景 Host，看到 “Owned Host and workers stopped.” 后才删除目录：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts clean "SCENARIO_DIRECTORY"
```
若尚未启动 Host，也可以直接 clean。若停止失败，保留目录及错误供诊断，不删除资源。
clean 只接受 prepare 创建的目录，拒绝删除仍有活动 Host PID 的目录；不停止其他进程。


<a id="faulted.failure"></a>
## faulted.failure: 故障原因可见、活动列表已释放

### Enter (root → state)

#### transition_isolated: 独立场景目录

所有命令均在仓库根目录执行，先执行 pnpm build。
使用 Node >=22.13 和 pnpm >=11.22；不要使用用户默认 Host。
以下单行命令不依赖 shell 变量、管道、重定向或续行，可用于 PowerShell、cmd、bash 和 zsh。
打开终端 A，执行：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts prepare
```
记录输出的绝对目录；后续每条命令中的 SCENARIO_DIRECTORY 都必须手动替换为这个完整目录，
保留外层双引号，不要原样输入占位符。它位于仓库缓存的 tree-host 子目录。
命令中的脚本相对路径由 Node 在各平台解析，无需按操作系统改写分隔符。
文档命令采用 shell 中立写法；实际已验证平台以消费证据为准，不等于已经在所有平台实跑。
prepare 复制真正的 worker.cjs，建立 artifact 与 controls 子目录并记录所有权。
若准备失败，它删除自己部分创建的目录并明确报错，不进入下一步。


#### transition_ready: 鉴权 HTTP Host 已就绪

在终端 A 保持前台运行：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts serve "SCENARIO_DIRECTORY"
```
等待 Ready 消息；该消息只在鉴权 GET /checks 返回 200 后出现。
这是独立真实 CheckKernel、HTTP server 和 worker，不连接默认 discovery。
打开仓库根目录的终端 B，继续把每条命令中的 SCENARIO_DIRECTORY 替换为 prepare 输出的绝对目录。
后续命令在 B 执行。凭据保存在受保护的 manual-host.json；不要打印或复制其内容。
若启动在返回 Ready 前失败，serve 会关闭部分创建的 Host/kernel；失败时保留诊断。


#### transition_faulted: 注入执行异常的预期故障状态

从全新 isolated → ready 路径开始，不执行 running 分支。
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts fault "SCENARIO_DIRECTORY"
```
提交 checkId=fault、fail=true；等待 Failed。这是执行异常，不是业务结果不通过。
成功进入预期故障状态不等于测试框架执行失败。


### Check faulted.failure

```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts inspect "SCENARIO_DIRECTORY" faulted
```
预期 Failed，error 包含 manual injected failure，GET /checks 返回 []。


### Cleanup (reverse order)

#### after faulted

本步没有新增资源，任务已终结；显式空收尾，Host 资源仍由 ready 负责。

#### after ready

若启动过 held 任务，先按 running 的 after 释放屏障。
然后在 A 输入 stop 并回车，等待 “Owned Host and workers stopped.”。
stop 是运行中的 serve 接受的输入，不是另开 shell 执行的命令，也不依赖平台特有的进程信号。
server 停止接收请求，kernel 确认 worker 退出；不使用按名称结束进程。
若启动失败且清理未确认，不执行目录删除，保留错误。


#### after isolated

在 A 中停止本场景 Host，看到 “Owned Host and workers stopped.” 后才删除目录：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts clean "SCENARIO_DIRECTORY"
```
若尚未启动 Host，也可以直接 clean。若停止失败，保留目录及错误供诊断，不删除资源。
clean 只接受 prepare 创建的目录，拒绝删除仍有活动 Host PID 的目录；不停止其他进程。


<a id="recovered.result"></a>
## recovered.result: 真实业务结果与 worker 复用正确

### Enter (root → state)

#### transition_isolated: 独立场景目录

所有命令均在仓库根目录执行，先执行 pnpm build。
使用 Node >=22.13 和 pnpm >=11.22；不要使用用户默认 Host。
以下单行命令不依赖 shell 变量、管道、重定向或续行，可用于 PowerShell、cmd、bash 和 zsh。
打开终端 A，执行：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts prepare
```
记录输出的绝对目录；后续每条命令中的 SCENARIO_DIRECTORY 都必须手动替换为这个完整目录，
保留外层双引号，不要原样输入占位符。它位于仓库缓存的 tree-host 子目录。
命令中的脚本相对路径由 Node 在各平台解析，无需按操作系统改写分隔符。
文档命令采用 shell 中立写法；实际已验证平台以消费证据为准，不等于已经在所有平台实跑。
prepare 复制真正的 worker.cjs，建立 artifact 与 controls 子目录并记录所有权。
若准备失败，它删除自己部分创建的目录并明确报错，不进入下一步。


#### transition_ready: 鉴权 HTTP Host 已就绪

在终端 A 保持前台运行：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts serve "SCENARIO_DIRECTORY"
```
等待 Ready 消息；该消息只在鉴权 GET /checks 返回 200 后出现。
这是独立真实 CheckKernel、HTTP server 和 worker，不连接默认 discovery。
打开仓库根目录的终端 B，继续把每条命令中的 SCENARIO_DIRECTORY 替换为 prepare 输出的绝对目录。
后续命令在 B 执行。凭据保存在受保护的 manual-host.json；不要打印或复制其内容。
若启动在返回 Ready 前失败，serve 会关闭部分创建的 Host/kernel；失败时保留诊断。


#### transition_faulted: 注入执行异常的预期故障状态

从全新 isolated → ready 路径开始，不执行 running 分支。
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts fault "SCENARIO_DIRECTORY"
```
提交 checkId=fault、fail=true；等待 Failed。这是执行异常，不是业务结果不通过。
成功进入预期故障状态不等于测试框架执行失败。


#### transition_recovered: 同一 Host 可再次正常执行

```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts recover "SCENARIO_DIRECTORY"
```
提交同一 artifact 的 checkId=recovery，等待 Completed，确认不是仅 HTTP 可连接。


### Check recovered.result

```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts inspect "SCENARIO_DIRECTORY" recovered
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
然后在 A 输入 stop 并回车，等待 “Owned Host and workers stopped.”。
stop 是运行中的 serve 接受的输入，不是另开 shell 执行的命令，也不依赖平台特有的进程信号。
server 停止接收请求，kernel 确认 worker 退出；不使用按名称结束进程。
若启动失败且清理未确认，不执行目录删除，保留错误。


#### after isolated

在 A 中停止本场景 Host，看到 “Owned Host and workers stopped.” 后才删除目录：
```text
pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts clean "SCENARIO_DIRECTORY"
```
若尚未启动 Host，也可以直接 clean。若停止失败，保留目录及错误供诊断，不删除资源。
clean 只接受 prepare 创建的目录，拒绝删除仍有活动 Host PID 的目录；不停止其他进程。
