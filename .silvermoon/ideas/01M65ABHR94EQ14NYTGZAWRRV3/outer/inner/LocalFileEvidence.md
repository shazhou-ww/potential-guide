# 本地主机 Checker archive 扩展证据

本文件记录同一 Check + Server 方向下本地 archive 扩展的实现验证，不代表门禁验收。
历史 HTTPS MVP 证据保留在 Evidence.md，不用其通过结果代替本地来源验证。

API 为 `createArtifactSource({allowedOrigins, allowedFileRoots?, authorize, ...})`。
file URL 指向 endpoint 主机；浏览器上传由会话组装负责，不是通用 Server 路由。
本次不变更 Probe/Regulate、Objective 可移植 HTTPS 绑定或原 worker/Engine 生命周期。

## 实现与边界

- `check-artifacts/src/file-url.ts` 提供唯一的纯 file URL 语法入口，
  同时由 `validateArtifactReference`、Typed codec 和 prepare 调用。
  仅 `kind:checker` 的直接引用扩展；Objective manifest 内嵌 Checker 另保留 HTTPS 检查，
  Objective dependency reference 仍不能使用 file。manifest schema 本身不变。
- `check-task/src/prepare.ts` 在 IO/缓存前执行根策略和注入的 scope 授权；
  根目录拼写大小写严格匹配（Windows 只规范化盘符），使无需访问原文件的缓存/恢复授权
  也不会混淆大小写敏感目录；不会依赖当前文件存在性来撤销或恢复授权。
  file 单独路由至 `readConfinedFile`，不进入 download/fetch。整个 archive 继续使用
  既有 unpack/inspectContractFiles/digest/References 规则。
- `check-runtime-files/src/confined-file.ts` 的 POSIX 路径通过 pinned fd 逐段 no-follow 打开，
  并核对原目录 entry、handle identity、单硬链接和纳秒 mtime/ctime。缺少原生 flags
  或 descriptor filesystem 时明确 unsupported，没有普通 open fallback。
- Windows 后端采用既有私有编译方式的独立只读 helper，使用 literal native path、
  no-reparse handles、无 write/delete sharing 的祖先/文件锁、实际 final path、
  configured-root volume/file identity 和读取前后 metadata。编译固定宿主代码，不编译制品；
  byte[] 由 C# 直接输出二进制，避免 PowerShell 数组展开或文本转码。
  helper 退出及其唯一 compiler scratch 清理完成后才返回；abort 只终止本次 owned PID/tree。
- Windows 只支持实际 local fixed/RAM 路径；工作目录必须可信且可写，
  helper 的 scratch 位于该目录 `.cache/check-archive-*`。目录/链接/设备别名、
  网络/UNC host、ADS、credential/query/fragment、非规范编码/NFC 均不授予读取权限。
- `allowedFileRoots` 是来源获取权限，不是已执行 Checker 的 filesystem sandbox；
  制品仍是受信任代码。浏览器 picker/upload 由父代理会话组装负责，仓库没有新增上传路由。

## 不可变与恢复

新 unpinned Task 重新读取当前文件，使用同一 eligibleAt 的测试证明不同 bytes 不复用旧完成结果。
exact cache entry 绑定 source/scope/digest 且每次重授权；文件删除后可以继续使用已授权的原字节。
Prepared 保持既有格式并持久化原全量文件，恢复不重新读取原来源。
撤销 scope 或移除 root grant 后不能分配。真实 file + SQLite 独立进程重启测试删除原 archive，
验证 queued 恢复原字节、身份/期限保留、unknown started work interrupted 且没有重跑。
旧 Host 仍显式拒绝 file 来源；不因共享 codec 的能力扩展而默默迁移旧协议。

## 验证结果

2026-10-30，Windows x64、Node **24.11.1**、pnpm **11.22.0**，
最终完整 `pnpm check` **退出码 0**，包括 layers/build、format、lint、
全仓 typecheck/test 和所有 packed consumers。命令：

```powershell
pnpm --filter @potential-guide/check-task... --filter @potential-guide/checker-host build
pnpm exec tsc -p tsconfig.test.json --pretty false
pnpm --filter @potential-guide/check-artifacts exec tsx --test test\file-reference.test.ts test\pure.test.ts
pnpm --filter @potential-guide/check-runtime-files exec tsx --test test\confined-file.test.ts test\store-lock-gc.test.ts
pnpm --filter @potential-guide/check-task exec tsx --test test\file-source.test.ts test\restart.test.ts
pnpm --filter @potential-guide/checker-host exec tsx --test test\file-source-boundary.test.ts test\store-lock.test.ts
$env:PGUIDE_MVP_EVIDENCE_DIRECTORY='.silvermoon\ideas\01M65ABHR94EQ14NYTGZAWRRV3\outer\inner\local-file-dependencies'
pnpm check
```

完整运行统计：

| workspace | tests / pass / fail / skip |
| --- | --- |
| check-artifacts | 25 / 25 / 0 / 0 |
| check-task | 19 / 19 / 0 / 0 |
| task-engine-server | 10 / 10 / 0 / 0 |
| check-runtime-files | 12 / 9 / 0 / 3 |

其中新 file-source 7 项和 HTTPS/file 真实进程恢复两项全部通过；
新 confined-reader 7 项为 5 pass、2 capability/platform skip；
forced-GC mutex 回归 1 pass，原 legacy mutex 两项也通过。
纯契约 file URL/Typed reference、Objective HTTPS 限定 3 项通过，
legacy Host 不被隐式迁移的独立边界测试通过。

当前 Windows 实测 symlink/junction、并发目录替换、已有 writable handle、abort/helper 清理；
POSIX fd 替换测试在本机按平台 skip。
Windows case-sensitive directory 测试尝试启用后，本机 filesystem/API 仍不能创建
仅大小写不同的两个目录，因此显式 capability skip，不能宣称该分支已在本机实测。
根拼写授权本身的大小写拒绝测试仍在 Windows 实际执行并通过。
workspace 统计中的另一个 skip 是既有 POSIX private-file reopen 测试；
完整仓库保留其他已有平台/fixture 条件 skip，没有取消条件或假称 POSIX 已实测。

### 独立 packed consumer

既有 HTTPS 程序化/CLI 回归保留，并额外在两个入口都提交真实本地 archive：
配置 `allowedFileRoots:[resolve("imports")]`，
实际 URL 为
`file:///D:/Code/potential-guide.worktrees/check-server-mvp-implementation/.cache/potential-guide-packs-JSrLc0/mvp-check/imports/checker.tgz`。
没有调用下载 hook 来伪造 file 来源；使用当前包导出和真实 Node worker。
相同 artifact digest 为
`sha256:dbe39692854004f151773facc26f6a6a41712da4a3e8f755b8a13f4c8ebfc1bf`。

| 入口 | Task | Execution | 结果 |
| --- | --- | --- | --- |
| 程序化 Server | `01M666XVXFHDNF949D60KBMJJD` | `01M666XWPJEDQ9SH6Y0GRHKF4N` | completed，业务 ok:false |
| 实际 CLI | `01M666XZT56ZX585D6CM1V50ZB` | `01M666Y0HY6QWT59FC8GVTZ4D8` | completed，业务 ok:false |

独立安装图另存，未覆盖旧 revision 的 dependencies：
[纯契约](local-file-dependencies/artifact-contracts.json)、
[无业务 Server](local-file-dependencies/mvp-server.json)、
[Check + Server](local-file-dependencies/mvp-check.json)。
依旧分别为 16、5、22 个真实安装包；esbuild 与本机 binary 仍实际安装，
不以 file transport 或 pure subpath 宣称安装依赖减少。安装图验证 realpath 不逃逸 consumer，
不存在源码/旧 Host 回退。该 fixture 是实现阶段的 packed 检查，并不冒充新 D 阶段的仓库外验证。

完整回归暴露两个与新增读取负载/导入相关的既有验证与原生资源问题：
迟到 worker 测试原先固定睡眠 300 ms，在并发负载下不足；现改为有界等待真实完成，
仍冻结相同逻辑时间并保留 deadline/late-completion 全部断言。
此外，原 `withFileMutex` 的 DatabaseSync 仅存在于 pending async continuation，
强制 GC 可在 live owner 尚未结束时回收 native guard。独立真实进程对照：
无强引用时第二进程取得锁；加入强引用时正确 SQLITE_BUSY。
因此仅在 filesystem mutex primitive 中强持有 guard 至确认 close，
增加 `store-lock-gc.test.ts` 的真实 `--expose-gc` 回归，未修改 Worker/Engine 生命周期。
最后一次完整检查之前还遇到既有 pguide lazy-preparation deadline 定时断言失败；
未修改该测试或产品行为，原样隔离执行
`pnpm --filter pguide exec tsx --test --test-name-pattern="worker dependency source binding" test\pilot-source.test.ts`
通过，随后原样完整重跑也通过。

## 审阅重点与后续边界

完整集成检查通过后由待提交 index 提取的交付物指纹：

| Git tree | 完整 OID |
| --- | --- |
| packages | `fb74721446963a327991a621d88e1ff14a8adc39` |
| scripts | `5f24ff1a853223fc8a9791febe1f369ac0ead12e` |
| docs | `a5bcdd34fe2ddec48d6ff57eb7ba9b3d6067f7dd` |
| examples | `a1706759986a58a32f80b783f868777694715191` |

后续仅补充本证据和生命周期事件。原生 reader 测试会确认 owned compiler scratch
清空；完整 packed consumer 的 fixture 在结束时删除。没有按进程名称或宽泛目录清理，
没有触碰父代理会话文件或原始 checkout。

提交前 primary 并发推进至 `054d1d3f0e182028d37457ff4f940b83fd11de7a`，
包含其他 idea 与其已提交的共享 Check/Engine/Server 扩展。
本次用 operation-owned stash 保存候选后正常 fast-forward，再三方恢复并仅合并 README
重叠段，保留上游 optional Check context、allocation lane 等内容；
没有重写或移除其他 idea 历史，也没有自行实施 Probe 功能。
首次完整通过记录对应合并前的候选；随后对集成后的 34-workspace tree **再次完整执行
pnpm check 并退出 0**，包括上游带入的检查与 packed consumer，未跳过并发交付物回归。
本文统计与 packed file receipts 已更新为该次集成后运行。
业务 context 不能伪造 allowedFileRoots 授权的集成回归也通过。
最终再 fast-forward 至 `51ed6194802294367da6f576ebca2e8b11445cd0`，
仅整合其他 idea 的元数据/证据；packages/scripts/docs/examples 等运行时交付物与已测基线
`054d1d3f0e182028d37457ff4f940b83fd11de7a` 的差异为零。

审阅重点是纯 scheme 规则与 portable Objective 的隔离、两种 OS 的 handle-pinned
读取、根拼写与当前授权、缺失源文件后的 immutable snapshot 语义，
以及新导入负载暴露的原生 mutex guard 生命周期。
未改动 CommonJS worker 或 generic Engine 状态机；历史 Ideal/Inner/Outer 证据保留，
不追加 accept*、不发布 npm、不改会话 playground 文件。
浏览器上传验证由父代理负责，新的 D 项仍未勾选；在新实现验收后才能据新 revision
更新并执行独立部署证明。
