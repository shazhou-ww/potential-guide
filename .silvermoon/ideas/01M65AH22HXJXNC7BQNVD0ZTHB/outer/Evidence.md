# 独立 Probe 消费与资源验证

本文件服务 [Deployment.md](Deployment.md)，记录父执行者实际运行及独立核验的结果。
subagent 编写验证工具；父执行者审查并同步工具后执行，不以主体世界测试代替部署证据。

## 准确候选与执行

- 已接受 implementationRevision：`d874dd9608e4c17935b6d81e578d2dc509c0620a`。
- 被测 packages tree：`8c7910f64171b2392e4bf9c399382a552714bbef`。
- 测试前已同步的 deploymentRevision：`e6c1d5d8b5d76e47de4b77c1c74488d450ea83b9`。
- 对应 primary/harness 提交：`054d1d3f0e182028d37457ff4f940b83fd11de7a`。
- 运行时间：2026-10-30 **10:24:41.349Z–10:25:39.141Z**。
- 环境：Windows x64、Node **24.11.1**、pnpm **11.22.0**。

实际命令退出码 **0**，七个必需场景全部通过：

```powershell
node .silvermoon\ideas\01M65AH22HXJXNC7BQNVD0ZTHB\outer\verification\verify.mjs --external-root D:\Code\probe-deployment-20261030-a1 --revision e6c1d5d8b5d76e47de4b77c1c74488d450ea83b9
```

完整原始证据为 [verification/results.json](verification/results.json)，包括命令退出码、
耗时、制品摘要、实际安装图、HTTP 原始响应、分页历史、SSE 帧、执行 journal、
Worker 事件及清理结果。最终 Outer revision 会包含该结果与本报告，
不冒充测试前自包含的 revision。测试后没有改动协议、harness、Inner 或生产源码。
父执行者在外部验证后再次运行完整 `pnpm check`，退出码 **0**；
包含全部生产包消费者、Probe、Engine、Server 和保留旧入口回归。

## D-S01 / D-AC01：真实独立消费

九个内部生产包均由准确工作树打包，使用 tarball overrides 在源码仓库外安装。
递归核验实际 **23 个安装包**的依赖和 realpath，内部包恰为九个；
没有旧 Checker Host、Objective Host、Objective Pilot、修复 Agent 或 Regulate。
安装 runtime 文件哈希与打包前逐项一致，锁文件及所有 tarball SHA-256 均保存在原始记录。
现有制品包仍安装 `esbuild`、`tar` 等依赖，不声称安装层面隔离。

`@potential-guide/probe-task` 本次实际 tarball SHA-256：
`d50b915c066776c1c29d171ebf38c3b3acdcfa55643cfb21062f1f2dad4095e6`。
这标识实际消费的 bytes，不以相同 SemVer 代替以后重打包的摘要。

- 同一通用 Server 注册 Check 与 Probe，进程内 IPC 和真实 HTTP 均观察到累计等级
  **basic**，严格等级的正常业务问题以 **completed** 返回，四个子 Check 参与解释。
- 动态结果包含 `check → resolve → check → check` 完整 transcript；
  实际选定 dependency digest 为
  `sha256:9d92f1684a4dc69b13b03d9ececa401bbcda71defde67b26a3e65477a91f536c`。
  重解析准确文件、二次 Check 的 resolutions context 和最终 dependency problem 一致。
- 子 Check 的 Task/Execution、准确制品、References 来源和授权历史均可关联。
  未认证读取 **401**，其他 scope 的父读取、子历史、SSE 均 **403**。
- 从同一 SSE checkpoint 实际重连两次，取得重复事件并按 sequence 去重为 **30** 条；
  同幂等键重提仍为同一 Task，实际四次业务调用没有增加。
- 来源为授权 HTTPS 身份到本次 archive 的受信任 fixture 下载器映射，
  不宣称实测远端 HTTPS 制品服务或本地 `file:` API。

## D-S02 / D-AC02：容量、取消、物理退出与恢复

- **两个 Probe worker、一个 Check worker、maxConcurrent=1** 下，
  五个不同父请求在 **7353 ms** 完成，低于约定 **45000 ms**。
  真实 Worker 事件峰值为 Probe **2**、Check **1**，并非仅观察 pool 计数。
- 取消父 Probe 撤销其子 Task，但独立 owner 共享的同一 Check Execution 仍存活；
  释放夹具后独立 owner 正常完成，实际 Check 调用仍为一次。
- 独占取消和活动 SSE 下关闭均确认根 Probe、Check 的真实 Worker exit；
  Checker 生成的受管子进程 **35240、16924** 均消失。
  后续 Check 实际创建点检查 owned child 已退出，才证明物理容量复用。
- 记录 **40 次 Worker 创建、37 次 exit**。三个缺失 exit 属于故意 crash 的服务进程：
  两个 Probe 和一个 Check 被整个进程终止，不伪称线程优雅结束。
  其余正常关闭通过 IPC 调用 `server.close()` 后自然退出码 **0**，没有强制成功退出。
- SQLite crash/restart 保留已完成结果及身份；两个已启动 Probe 和一个已启动 Check
  均为 **execution_interrupted**，原 Task/Execution/Series、deadline 保留，journal 无重跑。
- 重启前将根 archive 从
  `sha256:1923c3fb8a967309f8fa69aba5859b1087a83e415c1cfaf743032a1cae0aebc8`
  换为 `sha256:4e818b9f1c721333f4ca9037622c6e20fbd6733648b6f4a594d2641ccdfb51bc`。
  queued Probe 恢复原根及 References，下载次数 **15→15**。
  该案例使用 `targetLevel=initial`，不扩大为所有新子 Check 离线可用性的证明。
  已准备但未启动的独立子 Check 按引擎契约恢复执行一次，不是重跑其父 Probe。

全部服务 PID **13224、25024、21236、1904** 和上述两个 owned child PID
均由 harness 确认消失，父执行者随后再次通过 OS 查询核验，六个 PID 全部不存在。
正常服务的 worker 目录为空；故意 crash 留在外部标记目录内的本次文件，
在确认拥有进程全部消失后随唯一 ownership 目录一同删除。
`D:\Code\probe-deployment-20261030-a1` 已删除，父执行者再次确认不存在；
原始清理结果 `allAbsent=true`、`externalRootRemoved=true`、`errors=[]`。

## 验收边界

本次证明本机独立安装消费者，不是生产部署、npm 发布或任意不可信代码沙箱。
Windows crash 使用明确拥有的进程 handle；不以其结果声称 POSIX 优雅 signal 已验证。
没有修改已接受实现、运行修复 Agent、实施 Regulate 或动其他工作树/进程。
生命周期验收由父执行者依据上述准确证据和用户明确委托单独记录，不从勾选清单推定。
