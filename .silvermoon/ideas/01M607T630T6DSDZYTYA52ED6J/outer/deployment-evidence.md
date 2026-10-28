# 独立消费者部署验证

## 契约和执行基线

本次只交付 check-artifacts 的 Outer 验证，不推进另两项 idea，不发布 npm 或 GitHub Release。
已 accepted Ideal `f5cbcb916f677ecbed19c1a763671eb3d96748da` 和 Inner
`3687d470ca0c7b7930400ef553029a1e18df7fae` 没有修改，实现源码也没有修改。

Deployment 契约与复验脚本先同步到 primary，fresh `whats-next` 确认部署阶段后才执行：

| 项目 | 准确值 |
| --- | --- |
| 实际成功执行的 primary | `dc44d5019710214e6f77f612eed257ae3e2d7ff2` |
| 执行前 deploymentRevision | `ea2333647896cffc2911a64c36679410bcee9b7f` |
| Deployment.md blob | `7f830c1ac166bf2c5f5f3ca80667a3fc418fe82c` |
| 实际环境 | Windows、Node `v24.11.1`、pnpm `11.22.0` |
| 操作 ID | `0d6a3832-9b70-4319-bfba-1058942eb0f7` |
| 独立消费者目录 | `D:\Code\potential-guide-check-consumer-0d6a3832-9b70-4319-bfba-1058942eb0f7` |

该目录是源码仓库 `D:\Code\potential-guide` 的操作拥有兄弟目录，不是其子目录。
完整原始结果见 [consumer-evidence.json](./consumer-evidence.json)，执行逻辑见
[verify-consumer.mjs](./verify-consumer.mjs)。本次运行输出 `scenarios=13`、
`executions=5`、`passed=true`；证据写入前已完成外部目录和证书清理。
结果追加到 Outer 会改变最终 deploymentRevision，但没有改写上述稳定契约 blob。

## 工具安装与 Check 交付边界

作者侧使用已 accepted 实现的现成工具构建输出执行 `pnpm pack`，将三个真实工具
tarball 放入外部目录的 `delivery/tools/`。消费者 package.json 和 overrides 仅引用
这些外部本地 tarball，不引用 checkout、workspace 或作者 dist 的绝对模块入口。

| 工具 pack | 版本 | 文件数 | SHA-256 |
| --- | --- | ---: | --- |
| `@potential-guide/effects` | `0.1.0-rc.0` | 7 | `0fe03517fa0d74ee2e6f6d45fa1b9716fd3de939c80654ed3283478b5b6c7c00` |
| `@potential-guide/check-host` | `0.1.0` | 49 | `6184a13b7447b1535d16c9f49f4773e6d22ef8d4657c7dcadb1ce94df8d1c2f9` |
| `@potential-guide/check-artifacts` | `0.1.0` | 25 | `3aa6237ca9fb6d3de8f054e573b11a04420bfa0f216b125c6b7454aea6f870e9` |

外部消费者实际运行：

```powershell
pnpm install --offline --ignore-scripts --reporter=append-only
node consumer.mjs
```

安装成功，17 个包（3 个本地工具包及正常工具依赖），使用现有
`D:\.pnpm-store\v11` 缓存，没有生命周期脚本或在线 registry 访问。
pnpm 输出的 `downloaded 3` 是三个 `file:` tarball 的本地获取计数，不代表远程下载；
命令的 `--offline` 是实际生效的安装边界。

消费者通过公开包名导入三个工具。记录的 module realpath 全部位于上述外部目录的
`node_modules\.pnpm\...\node_modules\@potential-guide\...\dist\index.js`，
且程序断言它们不在源码仓库中。标准 pnpm 包链接不指向 checkout。
`NODE_PATH=""`、`NODE_OPTIONS=""`，没有 loader、测试 hook 或源码链接。

Check 在作者侧从 Git 原始源码显式构建一次，消费者只收到生成目录、gzip tar、
准确摘要和交付字节清单，没有安装 Check、运行其 build 或复制其 node_modules。
虽然工具本身正常依赖 Ajv，Host 仍禁止 worker 向任何 node_modules 回退；
执行的是包含 Ajv 的自包含 worker。

## 准确内容与真实 HTTPS

| 边界 | 准确值 |
| --- | --- |
| Check | `file-content` |
| 逻辑 digest | `sha256-pguide-check-v1:3d0dddd74456804b7ab70ce04309081577c86b685bf938f66591b3995611bcb5` |
| gzip tar 传输 digest | `sha256:764ea01511fd2e37cc75fbb0a6237f3b7b2de34d69e9b91c560f9e4b73c4329c` |
| Windows Host revision | `52649b7eec962a60c2fd5564afdcea741fca7589df528a8f4798a832c0f08119` |
| 本地来源 | 外部消费者 `delivery\local-check` |
| 实际 HTTPS 来源 | `https://127.0.0.1:49477/check.tgz` |

本操作启动真实 Node HTTPS 服务，使用 Git for Windows 的 OpenSSL 生成一天期
localhost/127.0.0.1 证书。仅消费者子进程设置 `NODE_EXTRA_CA_CERTS` 指向该证书，
并显式设置 `NODE_TLS_REJECT_UNAUTHORIZED=1`；结果断言 TLS 校验没有关闭。
服务收到 `/check.tgz` 三次真实 GET，以及替换内容、404 和停止端点的真实 GET。
成功准备的传输 digest 和交付字节验证证明实际响应不是测试替身或内存 fetch hook。
停止端点的操作 token 已从持久证据中遮蔽。

本地、HTTPS 和离线缓存所得执行树都只有 `worker.cjs` 与 `resources/`，
Host revision 一致。两个 Reference 均逐字节摘要校对：

| Reference | 字节数 | SHA-256 |
| --- | ---: | --- |
| `references/check.md` | 519 | `f4e2110784ac332506cc5e0c572e87ba15fe6e27894f0e272b5df790d0540fca` |
| `references/content-mismatch.md` | 438 | `e38dc4d39da9adf69ae986ea2f5251ca1c50b3f84cf62962ed13822fbdf0ae8b` |

manifest、worker、资源的长度和 SHA-256 也在原始 JSON 中，所有逻辑制品文件均校对；
没有把 References 混入 Host 执行 revision。

## 实际场景和结果

| 场景 | 实际结果 |
| --- | --- |
| 本地正确目标 | `Completed`，`ok:true`，无 problem |
| 本地错误目标 | `Completed`，`ok:false`，`content-mismatch` |
| HTTPS 正确目标 | `Completed`，`ok:true`，与本地相同 revision |
| HTTPS 错误目标 | `Completed`，`ok:false`，`content-mismatch` |
| 错误逻辑 digest | 明确拒绝，缓存无 capsule，Host 执行计数不变 |
| 错误传输 digest | 明确拒绝，缓存无 capsule，Host 执行计数不变 |
| HTTPS 响应被替换 | 明确拒绝，缓存无 capsule，Host 执行计数不变 |
| HTTPS 404 | 明确拒绝，缓存无 capsule，Host 执行计数不变 |
| 本地源不存在 | 明确拒绝，缓存无 capsule，Host 执行计数不变 |
| 缓存 Reference 被篡改 | 逻辑摘要不符，拒绝且不修复，Host 执行计数不变 |
| 缓存 worker 被删除 | 拒绝且不修复，Host 执行计数不变 |
| 服务停止后新缓存获取源 | 网络实际不可达，明确拒绝，Host 执行计数不变 |
| 服务停止后已有 HTTPS 缓存 | 离线复用并真实执行，`Completed / ok:true` |

合计 13 个场景、5 次真实 Host 执行，其中 3 次业务通过、2 次明确业务未通过。
8 个拒绝场景没有启动错误内容或形成成功业务证据。全程实际使用公开 prepare 和
CheckKernel API，失败场景前后执行计数由消费者自身断言。

## 清理与复验

完成后 `kernel.close()` 和 `closePrivateFileBackend()` 均被 await；
Host `ownedProcesses=0`。HTTPS 服务停止后，真实 fetch 失败；
整个外部目录仅在核对 `.operation-owner` 与本次 UUID 标记一致后删除。
原始结果记载 server、kernel、权限 helper 已关闭，外部目录/证书/私钥已删除；
脚本在写结果前以 `lstat` 的 `ENOENT` 再次核对目录消失。
没有删除共享 pnpm store、其他用户文件或源码仓库根。

在本证据对应不可变 commit 的干净 checkout，使用相同 Windows、Node、pnpm 和
Git for Windows OpenSSL，作者侧已有 build 输出及离线工具依赖缓存时，可运行：

```powershell
node --check .silvermoon\ideas\01M607T630T6DSDZYTYA52ED6J\outer\verify-consumer.mjs
node .silvermoon\ideas\01M607T630T6DSDZYTYA52ED6J\outer\verify-consumer.mjs
```

当前复验脚本默认把新结果写入忽略的 `.cache\check-artifacts-consumer-<UUID>.json`，
不覆盖本次不可变证据；可传入新的仓库内 `.cache/` 或该 Outer 的 JSON 相对路径。
除输出文件选择的这个后续改良外，成功执行版本由上表执行基线精确固定。
每次生成新的仓库外目录、证书与随机监听端口，并在完成或失败时清理操作拥有路径。
如作者侧 build 输出缺失，可先在作者 checkout 明确运行
`pnpm exec tsc -b packages\check-artifacts`；它不是消费者安装或 Check 隐式构建。

首次验证尝试在消费者执行前因 PowerShell 数组参数转发错误而失败；
该操作 `803208d4-1a75-46ea-8a0c-c702dd79ae95` 的外部目录已清理。
只修正了 Outer 验证脚本并重新同步 primary，未触及实现源码；随后上表完整运行成功。
没有把首次失败当作成功证据。

## 范围限制与最终检查

现场仅验证 Windows/Node 24，不声称 Linux 或最低 Node 22 已现场通过。
工具安装允许其正常 npm 依赖，但 Check 本身没有安装/构建步骤。
localhost TLS 与准确 digest 不等于发布者认证或签名，也不把 worker 视为沙箱。
本项没有正式托管、发布、上传代码或迁移 Objective/内置制品。

本阶段实际再次运行 `pnpm check`，退出 `0`：layers、format、lint、typecheck、
test、pack:check 全部通过。测试 Turbo 48/48 tasks 成功，其中 47 个按现有规则命中缓存；
未缓存的 monorepo suite 54/54，根 scripts 35/35；既有 22 个发布包的 pack 和
10 组隔离消费者全部通过。本页的仓库外 13 个场景是本阶段重新真实执行，不是缓存测试结果。
复验脚本的 `node --check` 也通过。
