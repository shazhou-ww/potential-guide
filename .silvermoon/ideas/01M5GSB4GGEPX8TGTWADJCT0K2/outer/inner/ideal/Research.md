# Check Host：调研依据与阅读入口

## 收敛结论

用户已选择统一 Node worker、单用户级共享 Check Host、外部本地 HTTP RPC、
内部 Worker Threads MessagePort；全部现有 check 及直接消费面全量迁移。
check 是最小并发任务，subject 和 regulation object 仅属于请求上下文。
同 Pilot ID 不允许不同执行版本并存；历史 schema/源码和固定证据保持不变。

worker 策略已确认采用有界复用、按任务数/时间/内存等条件退役及受控动态预热，
而非每请求重建或永久无限保留。清理完成才可回池，特殊不能安全复用的任务须显式声明。
阈值、路由和接口细节尚需审阅，不把方向确认当作生命周期验收或实现完成。

## 三个重点阅读入口

- [Design.md：调整范围](./Design.md#1-调整范围)：包边界、现有调用链以及全部内置检查器。
- [Design.md：worker 消息](./Design.md#3-worker-messageport-消息)：任务身份、消息方向、完成与清理顺序。
- [Design.md：HTTP 接口](./Design.md#4-对外-http-rpc)：异步任务资源、会话、注册、依赖事件和错误语义。

设计稿还集中定义模块生命周期、退役/预热和端到端时序；本文件不复制另一套接口。
已确认/待审阅状态统一见 [OpenQuestions.md](./OpenQuestions.md)。
仓库 workspace 仅使用 packages，Host 按独立可复用包规划于 `packages/check-host`，
启动装配复用现有 CLI 工具层，不另增应用目录或预先拆分 runtime 包；
复用现有协议层，本次仅调整 workspace 配置和文档，不创建产品包。

## 性能动机与证据边界

前一轮固定消费证据见
[probe-efficiency](../../../../01M5EY383YB0ZY4HMKB8BFT7HM/outer/Consumption.md)。
本会话在 `e2f0b1a6d0c761f4df8c1e3529c3f713d075c60e` 上复测：
默认预算三次超时；显式预算完整 CLI 两次约 50.5 / 48.5 秒，
均 standardized、0 problems，22 次实际观察、21 次复用、43 次逻辑观察。

后续插桩确认 44 个 check 进程；42 个包进程累计生命周期约 35.0 秒，
启动到首次读取视图约 29.5 秒，其中 bundle 加载和初始化约 18.0 秒。
这些是包含关系，不能相加。读取视图和解析大 JSON 累计约 1.25 秒。
bundle 约 4.3 MB，TypeScript 约 3.58 MB；体积比例不等于 CPU 比例。
两个包级 CPU 样本主要落在模块编译、CJS 导出分析和顶层初始化。

以上是问题依据，不是共享 Host 已获收益的证据。插桩观察约 59 秒、其中捕获约 19 秒，
不能与未插桩约 42 秒直接混比，也不承诺默认 30 秒 SLA。
后续固定环境/来源/输入比较必须同时统计线程初始化、内存、冷/热时延及资源清理，
不能靠把逐次进程启动换成逐次线程重建宣称提速。

## 现有代码与验证

调研起点为 `5055e96c2271035c641e9eb810c0768e6c7e991e`，当前文档更新未修改产品代码。
可复用的是既有类型、预算、来源固定及证据验证；需要改造的是进程通信和生命周期假设：

| 位置 | 与迁移相关的事实 |
| --- | --- |
| [types.ts](../../../../../../packages/pilot-protocol/src/types.ts) | CheckRef、Subject、Envelope、CheckResult 及准确 Git 来源可作为消息业务数据 |
| [probes.ts](../../../../../../packages/objective-pilot/src/probes.ts) | HTTP 结果解析/取消已有基础，但裸 subject POST 不是新 Host 契约 |
| [pilot-source.ts](../../../../../../packages/cli-runtime/src/pilot-source.ts) | 当前发现 run.*、逐次进程 probe，checkout 随作用域清理，需迁移到 Host 所有的准确注册来源 |
| [dependency.ts](../../../../../../packages/objective-pilot/src/dependency.ts) | 依赖证据绑定原观察作用域，不能被普通 HTTP 或线程返回值替代 |
| [regulation-worker.ts](../../../../../../packages/pguide-regulate/src/regulation-worker.ts) | 一次 runtime 已覆盖多轮观察；要替换的是 check 执行机制而非业务循环 |
| [check.mjs](../../../../../../packages/objective-monorepo-standard/check.mjs) | 业务函数可适配 worker，原 stdin/stdout/进程证据上下文不能继续作为任务边界 |
| [shared.ts](../../../../../../packages/objective-monorepo-standard/src/shared.ts) | 视图使用进程环境及 IPC 前提，多请求需要显式上下文 |
| [evidence.ts](../../../../../../packages/objective-pilot/src/evidence.ts) | checkRunId、attempt、脱敏和大小限制需按请求保留，不能共享成一份 Host 日志 |

先前独立执行已有测试：

```powershell
pnpm exec tsx --test --test-name-pattern='HTTP|already aborted|transport failures' packages\objective-pilot\test\probes.test.ts
```

4/4 通过，证明业务失败 envelope、传输故障、预取消不执行，以及客户端取消不保证服务端停止。
这不是新 Host、线程池或新消息协议的实现证据。
本次盘点为 6 个内置 Objective 目录、16 个 check 进程入口；详细清单集中在设计稿。

## 官方资料及结论

- [Node net](https://github.com/nodejs/node/blob/v24.11.1/doc/api/net.md)：
  端口 0 由 OS 分配，listening 后获取实际地址；省略 host 可能监听所有接口。
- [Node HTTP](https://github.com/nodejs/node/blob/v24.11.1/doc/api/http.md)：
  关闭连接不等于停止业务任务，仍需执行级取消与清理确认。
- [Node child_process](https://github.com/nodejs/node/blob/v24.11.1/doc/api/child_process.md)：
  detached/unref/stdio 影响退出关系，不自动提供服务发现、使用权与回收。
- [RFC 9110 §9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2)：
  非幂等请求在不能确认幂等或未执行时不应自动重放。

Worker Threads 不是恶意代码安全沙箱，模块缓存不自动跨线程共享，
线程退出不保证其外部工具/资源全部停止；这些约束进入设计和验证，不能靠协议名隐去。
