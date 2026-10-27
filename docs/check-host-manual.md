# Check Host 状态操作手册

Not run — 操作说明，未执行验证。

从初始状态开始，沿状态树执行进入操作并核对观察结果。不同分支从独立环境开始。
命令由人执行；本页面不会运行命令。资源退出说明只用于结束操作，不是逆向状态转移。

## 状态树

- [独立操作环境已准备](#state-isolated)
  - [Host 已就绪，尚无任务](#state-ready)
    - [任务 Running，等待取消](#state-running)
      - [任务 Cancelling，清理尚未完成](#state-cancelling)
        - [任务 Cancelled，资源已释放](#state-cancelled)
    - [任务 Failed，Host 仍可用](#state-faulted)
      - [新任务 Completed，原失败保持不变](#state-recovered)

<a id="state-isolated"></a>
## 状态：独立操作环境已准备

到达路径：独立操作环境已准备

### 如何进入

本手册使用 Check Host 包的公开 API 与 HTTP 接口，不运行 Test Tree、测试绑定或测试 helper。
Check Host 守护进程入口需要 discovery 的启动预约，并没有通用的 start/run/cancel 命令；
这里直接用公开的 CheckKernel、serve、CheckClient 建立同等真实服务，明确不覆盖 discovery。
准备 Node >=22.13、pnpm >=11.22，在仓库根执行 pnpm build，再执行 node 打开交互控制台。
后面的 JavaScript 块都在这个 Node 控制台中执行，不使用 shell 变量：
每块先输入 .editor 并回车，粘贴代码（不含代码块围栏），按 Ctrl+D 执行，
等待它完成并重新出现 > 提示符后再进行下一块。不要把全部含 await 的行一次管道送进 node -i。
每条分支从新的 node 控制台和新的场景开始；按块执行，不要重复声明同名 const。
以下操作创建独立目录及一段透明的演示 worker；worker 只是业务输入，不含测试框架。
```js
const fs = await import("node:fs/promises");
const path = await import("node:path");
const api = await import("./packages/check-host/dist/index.js");
const scratch = path.resolve(".cache", "manual-check-host");
await fs.mkdir(scratch, { recursive: true });
const directory = await api.createPrivateDirectory(scratch, "case-");
const artifactDirectory = path.join(directory, "artifact");
const controls = path.join(directory, "controls");
await fs.mkdir(artifactDirectory);
await fs.mkdir(controls);
let kernel;
let host;
let client;
let headers;
let closed = false;
await fs.writeFile(path.join(artifactDirectory, "worker.cjs"), String.raw`
const fs = require("node:fs/promises");
const path = require("node:path");
let calls = 0;
exports.execute = async (subject, context) => {
  const count = ++calls;
  if (subject.fail) throw new Error("manual injected failure");
  if (subject.hold) {
    context.defer(async () => {
      await fs.writeFile(path.join(subject.controls, "cleaning"), "entered");
      for (;;) {
        try { await fs.access(path.join(subject.controls, "release")); break; }
        catch (error) {
          if (error.code !== "ENOENT") throw error;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }
      await fs.writeFile(path.join(subject.controls, "cleaned"), "done");
    });
    context.progress({ entered: true, marker: subject.marker, calls: count });
    await new Promise(resolve => {
      if (context.signal.aborted) resolve();
      else context.signal.addEventListener("abort", resolve, { once: true });
    });
  }
  return { marker: subject.marker, calls: count };
};
`);
console.log("准备目录", directory, await fs.readdir(artifactDirectory));
```
应看到唯一的 case 目录和 worker.cjs。记录 directory；不要使用用户默认 Host 目录。
若准备阶段报错，先看错误，确认 directory 已获得后再按本状态的退出说明删除自有目录。


### 在此状态观察

核对上面的准备结果，再选择下一状态。

### 可以转向的状态

- [Host 已就绪，尚无任务](#state-ready)

### 结束操作时

若服务已经启动，先按“Host 已就绪”的退出说明确认关闭；不要在运行时删除目录。
在同一个 Node 控制台执行以下命令，之后输入 .exit 退出控制台。
```js
if (host && !closed) throw new Error("先关闭本次 Host，再删除目录");
if (path.dirname(directory) !== scratch || !path.basename(directory).startsWith("case-")) throw new Error("不是本次自有场景目录");
await fs.rm(directory, { recursive: true, force: true });
await api.closePrivateFileBackend();
console.log("场景目录已删除");
```
只删除本次创建的 directory；任何关闭或删除错误都应保留诊断，不能清理未知目录。


完成本层资源收尾后，按到达路径向上处理各层拥有的资源；不要把退出当成业务回滚。

<a id="state-ready"></a>
## 状态：Host 已就绪，尚无任务

到达路径：独立操作环境已准备 → Host 已就绪，尚无任务

### 如何进入

在已准备的 Node 控制台启动真实内核与鉴权 HTTP 服务：
```js
kernel = await api.CheckKernel.create(path.join(directory, "snapshots"), { deadlineMs: 120000, cleanupMs: 30000 });
const token = (await import("node:crypto")).randomUUID();
host = await api.serve(kernel, token);
void (client = new api.CheckClient({ endpoint: host.endpoint, token, pid: process.pid, instance: (await import("node:crypto")).randomUUID() }));
const artifact = await api.readArtifact(artifactDirectory);
void (headers = { authorization: `Bearer ${token}` });
console.log("HTTP 地址", host.endpoint);
```
应得到 127.0.0.1 的随机端口。不要打印 token、headers 或完整 client。
这是本控制台拥有的服务，不启动第二个 daemon，也不会连接默认 discovery。
若 serve 在返回 host 前失败，执行 await kernel.close() 释放已创建的内核，再处理场景目录。


### 在此状态观察

<a id="ready.idle"></a>
#### 查看地址和活动任务列表

直接查询原始 GET /checks，而不是调用测试断言：
```js
const idleResponse = await fetch(`${host.endpoint}/checks`, { headers });
console.log("HTTP", idleResponse.status, "活动任务", await idleResponse.json());
```
预期 HTTP 200、活动任务 []。非 200 或非空时不能认为本状态已成立。


### 可以转向的状态

- [任务 Running，等待取消](#state-running)
- [任务 Failed，Host 仍可用](#state-faulted)

### 结束操作时

有 held 任务时，先按“任务 Running”的退出说明释放屏障并等待任务结束。
再关闭本次服务；只收到关闭请求不等于已确认 worker 退出。
```js
await host.close();
await kernel.close();
closed = true;
console.log("Host 与 worker 已关闭");
```
任一步报错时不继续删除目录。正常关闭后再回到“独立操作环境”的目录删除步骤。


完成本层资源收尾后，按到达路径向上处理各层拥有的资源；不要把退出当成业务回滚。

<a id="state-running"></a>
## 状态：任务 Running，等待取消

到达路径：独立操作环境已准备 → Host 已就绪，尚无任务 → 任务 Running，等待取消

### 如何进入

提交本次演示 worker。只发送请求不代表已经开始执行，必须继续观察快照：
```js
const heldId = await client.start({ checkId: "held", directory: artifact.directory, revision: artifact.revision, subject: { hold: true, marker: "tree-manual", controls } });
```
进入本状态后在下面的观察区查询。若仍是 Queued 或尚无 progress，重复快照查询，
不要重复提交。worker 将等待取消，并在清理时等待 controls 内的 release 文件。
为方便手动操作，本次 Host 的执行期限为两分钟、清理期限为三十秒；超时请退出并重新开始。


### 在此状态观察

<a id="running.input"></a>
#### 查看任务状态、输入标记与活动列表

```js
console.log("任务快照", await client.sample("held"));
console.log("活动列表", await (await fetch(`${host.endpoint}/checks`, { headers })).json());
```
预期 state=Running，progress={entered:true,marker:"tree-manual",calls:1}，
活动列表恰有 held 一项。Queued 或 progress 尚未到达时再次观察，不凭固定等待判定成功。


### 可以转向的状态

- [任务 Cancelling，清理尚未完成](#state-cancelling)

### 结束操作时

无论提交或观察是否成功，先释放本次清理屏障，再取消仍活动的 held 并等待终态：
```js
await fs.writeFile(path.join(controls, "release"), "released");
const heldResponse = await fetch(`${host.endpoint}/checks/held`, { headers });
if (heldResponse.status === 200) {
  const remaining = await heldResponse.json();
  if (!api.terminal(remaining)) await client.cancel("held");
  console.log("任务收尾", await client.wait("held", AbortSignal.timeout(10000)));
} else if (heldResponse.status !== 404) throw new Error(`查询失败 HTTP ${heldResponse.status}`);
```
404 表示没有接受此任务；其他错误不能忽略。任务确认结束后才能关闭 Host。


完成本层资源收尾后，按到达路径向上处理各层拥有的资源；不要把退出当成业务回滚。

<a id="state-cancelling"></a>
## 状态：任务 Cancelling，清理尚未完成

到达路径：独立操作环境已准备 → Host 已就绪，尚无任务 → 任务 Running，等待取消 → 任务 Cancelling，清理尚未完成

### 如何进入

直接调用取消接口；不要提前创建 release 文件：
```js
console.log("取消响应", await client.cancel("held"));
```
取消响应可能先于 worker 清理动作，按下面的观察区确认 cleaning 文件已出现。
若一直未出现或任务提前 Failed，保留错误，不将其当成成功取消。


### 在此状态观察

<a id="cancelling.waiting"></a>
#### 查看取消快照与清理标记

```js
console.log("取消快照", await client.sample("held"));
console.log("清理文件", await fs.readdir(controls));
```
预期仍为 Cancelling，文件列表中有 cleaning、没有 cleaned。
尚无 cleaning 时重复观察；不要创建 release 来“修好”这个观察状态。


### 可以转向的状态

- [任务 Cancelled，资源已释放](#state-cancelled)

### 结束操作时

本操作没有创建新的资源；结束时按“任务 Running”的退出说明释放屏障并收尾 held。

完成本层资源收尾后，按到达路径向上处理各层拥有的资源；不要把退出当成业务回滚。

<a id="state-cancelled"></a>
## 状态：任务 Cancelled，资源已释放

到达路径：独立操作环境已准备 → Host 已就绪，尚无任务 → 任务 Running，等待取消 → 任务 Cancelling，清理尚未完成 → 任务 Cancelled，资源已释放

### 如何进入

人工创建本次清理屏障的释放文件，再观察服务的终态：
```js
await fs.writeFile(path.join(controls, "release"), "released");
console.log("释放后终态", await client.wait("held", AbortSignal.timeout(10000)));
```
预期 Cancelled。超时、Failed 或其他终态都不满足本状态。


### 在此状态观察

<a id="cancelled.released"></a>
#### 查看终态、清理结果与活动列表

```js
console.log("最终快照", await client.sample("held"));
console.log("最终清理文件", await fs.readdir(controls));
console.log("最终活动列表", await (await fetch(`${host.endpoint}/checks`, { headers })).json());
```
预期 Cancelled，controls 中存在 cleaned，GET /checks 返回 []。
发出终止请求本身不是资源退出的证据。


### 可以转向的状态

此分支已结束，可按下面的说明退出并释放资源。


### 结束操作时

本操作未获得新资源。结束时收尾 held、关闭本次 Host，最后删除独立场景目录。

完成本层资源收尾后，按到达路径向上处理各层拥有的资源；不要把退出当成业务回滚。

<a id="state-faulted"></a>
## 状态：任务 Failed，Host 仍可用

到达路径：独立操作环境已准备 → Host 已就绪，尚无任务 → 任务 Failed，Host 仍可用

### 如何进入

此分支从全新的“独立操作环境 → Host 已就绪”开始，不执行 Running 分支。
通过正常任务输入要求演示业务抛错，不通过测试故障注入函数：
```js
await client.start({ checkId: "fault", directory: artifact.directory, revision: artifact.revision, subject: { fail: true, marker: "tree-manual" } });
console.log("异常任务终态", await client.wait("fault", AbortSignal.timeout(10000)));
```
预期任务 Failed，原因 manual injected failure。这是执行异常，不是业务结果不通过。


### 在此状态观察

<a id="faulted.failure"></a>
#### 查看原始错误与 Host 活动列表

```js
const originalFault = await client.sample("fault");
console.log("原始故障", originalFault);
console.log("故障后活动列表", await (await fetch(`${host.endpoint}/checks`, { headers })).json());
```
预期 Failed，error 为 Error: manual injected failure，活动列表为空。
记录错误用于之后比较；错误状态不是阻止下一步恢复的理由。


### 可以转向的状态

- [新任务 Completed，原失败保持不变](#state-recovered)

### 结束操作时

异常任务已终结，没有新增资源。结束时关闭本次 Host，再删除场景目录，不改写失败历史。

完成本层资源收尾后，按到达路径向上处理各层拥有的资源；不要把退出当成业务回滚。

<a id="state-recovered"></a>
## 状态：新任务 Completed，原失败保持不变

到达路径：独立操作环境已准备 → Host 已就绪，尚无任务 → 任务 Failed，Host 仍可用 → 新任务 Completed，原失败保持不变

### 如何进入

使用同一 Host、同一 artifact，正常提交一个新任务：
```js
await client.start({ checkId: "recovery", directory: artifact.directory, revision: artifact.revision, subject: { marker: "tree-manual" } });
console.log("恢复任务终态", await client.wait("recovery", AbortSignal.timeout(10000)));
```
预期 Completed，不把端口可连接当成恢复成功。


### 在此状态观察

<a id="recovered.result"></a>
#### 比较新结果和原失败记录

```js
console.log("原故障仍在", await client.sample("fault"));
console.log("新任务结果", await client.sample("recovery"));
console.log("恢复后活动列表", await (await fetch(`${host.endpoint}/checks`, { headers })).json());
```
预期 fault 仍为 Failed 且原始错误不变；recovery 为 Completed，
result={marker:"tree-manual",calls:2}，活动列表为空。
calls=2 表明处理过原请求的业务模块仍可处理新请求；没有重放旧任务。


### 可以转向的状态

此分支已结束，可按下面的说明退出并释放资源。


### 结束操作时

新旧任务均已终结；结束时关闭 Host，再删除场景目录，不重放原失败任务。

完成本层资源收尾后，按到达路径向上处理各层拥有的资源；不要把退出当成业务回滚。
