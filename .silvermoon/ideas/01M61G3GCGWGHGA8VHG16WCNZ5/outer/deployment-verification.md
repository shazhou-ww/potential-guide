# 仓库外本地部署候选验证

## 范围与门限

2026-10-29 在操作自有目录 `D:\Code\artifact-deploy-01M61-20261029` 实际运行，
对应 [Deployment.md](./Deployment.md) 的 D-S01、D-S02、D-AC01、D-AC02。
这是 **未通过 Inner 生命周期门限的本地部署候选验证**，不是部署验收、正式发布或外部生产部署。
候选为独立 worktree 的 HEAD `342de2e120a4` 加既有 14 文件未提交修复；
本次没有再改生产或测试。准确交付物以以下归档字节摘要为准，不能仅凭 HEAD 重建。

子 agent 的验证没有提交、合并、推送、修改 upstream 或追加生命周期事件。
原工作区 `D:\Code\potential-guide` 未触及。同步 primary 和准确 revision 的生命周期门限
仍须按用户授权处理，本页不能代替 submitInner、人工验收或 submitOuter。

父 agent 随后审阅了独立验证脚本的实际断言和机器报告，核对两个附件的 SHA-256，
重新确认 PID 10424 不存在、60589/60590/60591 三端口均拒绝连接，且 9 组场景通过、
五类 worker start/defer-cleanup 数逐项相等。本地 D-* 工作据此勾选；
这只记录 Agent 已执行并核查的工作，不接受任何世界 revision，也不解除同步前置条件。
允许保存在 WIP 的本地候选提交；不自动合并或推送。

## 工具交付与运行方式

实际执行：

```powershell
pnpm --filter @potential-guide/objective-host... build
# 在当前独立 worktree，对 objective-host、check-host、check-artifacts、
# check-runtime-files、effects 依次执行：
pnpm --dir (Join-Path 'packages' $dir) pack --pack-destination 'D:\Code\artifact-deploy-01M61-20261029\packs' --json
Set-Location 'D:\Code\artifact-deploy-01M61-20261029'
pnpm install --offline --ignore-scripts --no-frozen-lockfile --reporter=append-only
# 使用 Git for Windows 的 openssl，只生成本操作一日有效的 loopback 证书：
& 'C:\Program Files\Git\usr\bin\openssl.exe' req -x509 -newkey rsa:2048 -nodes -days 1 -keyout key.pem -out cert.pem -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'
$env:NODE_EXTRA_CA_CERTS = Join-Path (Get-Location) 'cert.pem'
$env:NODE_OPTIONS = ''
node verify.mjs
```

上述最终运行全部 exit 0，验证脚本 9 组场景通过。Node `v24.11.1`、
pnpm `11.22.0`、Windows `win32/x64`。安装清单和 overrides 全部指向这五个本地 tarball，
无 workspace 依赖、源码导入、安装 hooks、npm 发布或 GitHub Release。
离线安装复用已有第三方缓存，不向第三方传输源码；证书信任仅限本次子进程环境，
没有关闭 TLS 校验或修改用户/全局配置。

五包准确传输摘要（SHA-256，不是制品内容树 digest）：

| tarball | 字节 | SHA-256 |
|---|---:|---|
| potential-guide-check-artifacts-0.1.0.tgz | 41654 | `2513412e5183512c7e00a8f89b3b9db2545a8fd55f726293397be63c197ee93f` |
| potential-guide-check-runtime-files-0.1.0.tgz | 18065 | `58f1fe5345c37084c0b77ce4ba458634d7cb9853e7371af6017b594d0bc48d0e` |
| potential-guide-checker-host-0.1.0.tgz | 87581 | `36303c0e3abfea257f98067dbaa765cad4aae1e59619052bac93f6c8b379bcf4` |
| potential-guide-effects-0.1.0-rc.0.tgz | 5813 | `0fe03517fa0d74ee2e6f6d45fa1b9716fd3de939c80654ed3283478b5b6c7c00` |
| potential-guide-objective-host-0.1.0.tgz | 14215 | `fd210df48fe32d277179fe6c3fb32557f02adf255873025c5660f90b57612d72` |

运行时通过 `import.meta.resolve`、`realpath` 和逐层 `lstat` 验证模块定位。
共同前缀为操作目录的 `node_modules\.pnpm\`；以下均为真实安装文件，无祖先目录
symlink/junction，更不指向 worktree：

```text
@potential-guide+check-arti_bbde3fd4adb341184e6e29f5b8808d9a\node_modules\@potential-guide\check-artifacts\dist\index.js
@potential-guide+checker-ho_14ea6f48e71930b88faff1fdd6cd909b\node_modules\@potential-guide\checker-host\dist\index.js
@potential-guide+objective-_db0b84b427aaa642c0efa2a629364eae\node_modules\@potential-guide\objective-host\dist\index.js
@potential-guide+check-runt_37aad888476101eb1c456ba5b3ffa7e5\node_modules\@potential-guide\check-runtime-files\dist\index.js
@potential-guide+effects@fi_2f5d75c0ce9d8e8e3646012373311d32\node_modules\@potential-guide\effects\dist\index.js
```

作者侧仅用已安装的 build/write/pack API 交付自造 Checker/Objective 归档。
Host 使用默认 `ContractStore` 下载路径，从可信本地 HTTPS 实际获取、解包和校验，
没有注入内存 repository/download 替代网络。消费侧公开 SDK 仅提交 URL、subject、
语言、freshness、期限及已有绑定，不自己物化制品。

## 实际端点、事件与任务

最终运行 PID `10424`；制品源 `https://127.0.0.1:60589`，
统一 Host `http://127.0.0.1:60590`，断流代理 `http://127.0.0.1:60591`。
全部显式绑定 loopback。无 bearer 和错误 bearer 请求均返回 401；
正确鉴权通过 SDK 访问 `/objectives/v1` 和 `/checkers/v3`。
令牌、证书私钥不在报告中。

- **观察与动态依赖：** Task `693c548e-443d-4986-ae9e-489cd116d272`，
  Execution `38448993-028f-40f4-8a5b-4841f3feec00`，最终 revision 33、completed、ready。
  UTC accepted/start/completed 分别为 `01:43:25.343`、`01:43:25.390`、
  `01:43:26.380`。真实事件含子 Task/Execution；最终两个 observation、三个不同
  invocation，依赖 observation 有 parentInvocation。三个叶子均为
  `started-after-request`；根 Checker 依赖解析后二次调用没有覆盖首次证据。
- **语言、页面与业务状态：** 中文根 Task `a58ee860-7b92-40d0-9f22-1364c8d34114`
  最终 revision 16、completed、initial，根 `zh-CN`、子 Checker `en`，
  问题参数实际语言 `en`，level 为 blocked，未把 completed 当 attained。
  中文 `checkers/pass` 来自根制品
  `references/zh-CN/checkers/pass/checker.md`；英文 `pages/base-pass`
  保留 Checker owning digest 与 `references/en/checker.md`。
  不存在的中文 base 页和 `system/404` 均真实返回 404，而非 fallback。
- **共享与 freshness：** 首强 Task `d58aab4d-25b3-4944-80c6-a7c17572bbe5`
  与后弱 Task `56a6903f-f271-4c81-b5d7-be7f9760603b` 共用
  Execution `23abad80-8ce1-4e4f-adf2-4cd251fe2bf1`。运行后新强 Task
  `d933b81a-ed81-4096-9c7d-bdb970fb6217` 使用不同 Execution
  `5efc5818-5f7c-454c-9654-7c3eb9a6c8ce`。文件门闩确认两次真实 worker 调用后
  取消首强，弱 Task 仍 running；释放门闩后弱/新强分别 completed，首强保持
  cancelled revision 14。两次完成的子 Task 分别为
  `cfc5cca3-63b4-40f0-9a8b-9b27ae0a7ef4`、
  `1c20b22f-7282-4ccb-a735-2feabcc4880f`。
- **独立期限：** 弱 Task `6b47ed81-5e17-4d2a-b5df-0398b38ac021` 使用
  1000ms 期限加入 Execution `fdd8fd5f-a0c5-45f1-9373-2375276d0844`；
  最终 failed revision 5、`task_timeout/schedule`，同执行原 owner 仍 running，
  释放门闩后正常完成。没有延长或取消另一个 Task。
- **断流与本地关闭：** 代理实际销毁一次 SSE socket，SDK 自动重连；
  stream 场景观察到 running revision 13 和 completed revision 16。
  最终共 14 次事件连接、1 次强制断流，未通过重新创建 Task 恢复。
  另一客户端先 abort 本地 watch，再 `client.close()`；独立 SDK 仍看到原 Task
  running，释放门闩后同一 Task completed，未发生远端取消。
- **最后 owner：** Probe `9bf2fe1c-49d3-4b2c-90bf-95ae7ed21dcc` 取消后
  保持 cancelled revision 14；所拥有子 Task
  `6eba1d81-0f9e-45e7-9a39-f1770478573a` 真实返回 cancelled revision 6、
  `task_cancelled/schedule`。worker 的 defer 清理标记恰好一次，不只检查外层状态。

## 版本更新与准确恢复

本次制品准确内容树 digest 与传输摘要如下；均为 `sha256:` 后的完整值：

| 制品 | Git SHA-256 tree | transport SHA-256 |
|---|---|---|
| root-checker | `39107bfd0511d0bc70436e741ca2043ee1c32e3ba9bc1b352470b737dec6cdd6` | `6b03dffa2c03b4a14b740140a4079895e751ed9848715b881379af86e6f40cb4` |
| leaf-checker-v1 | `b4bc5f1d1444af762f21bec5cd957f82b13b8b427d66f0c81e88c58a5d95549d` | `fbb40ebdbb92fdf54af5c46129ac995fe3e406c95d90c65ddf7760e4f7d0776f` |
| leaf-checker-v2 | `9f1cecf0640c53f479038ed804f6c3f01d4465d1fb2652c96a1e2d4d8182f15e` | `58707b46237ae76ffa2ae2136c8f2d91e55b51dac970c62e1efca7fa47ed4a37` |
| dependency-v1 | `94afbf68d946e89a3876753f1f6ec25b10bdedb2a85399e85c2416caacfd4078` | `4c3b622bb78f4a18d136dda9b7a89b4f5a75f77830cffcc9d0b440c8ca9d11bc` |
| dependency-v2 | `9816165042ce6aa3713010214b79cb8ec14fc32c24b3964d7d338c88e6c36a40` | `e59303c063e0c79b142a455f6846bbc70151dded34cd4c32b1d9a8c893af007d` |
| root-v1 | `10ff00c8979786213040422555b01af69b6c8b52200c99c7aa156aee34988f11` | `7de310c514e6725b46b4cc2594d678e855e1db582b2157e7a44d452429fda9ee` |
| root-v2 | `e04051b539aa0e9537065316f3df0a92beae717cb7c7413e936c66fce8d6a596` | `bf1149b6dba6f915fab9d8061771e29df6fac6a8322c1e214e94618726800337` |

原结果 bindings 将 `/objective/latest.tgz` 固定为 root-v1、
`/dependency/latest.tgz` 固定为 dependency-v1。随后两个 HTTPS 浮动路径均换为 v2；
新 Task `4496f650-58e9-4cd0-bb08-14861ba9640d` revision 33 得到 root-v2、
dependency-v2 和 leaf-v2 的真实执行证据。

恢复 Task `99b33542-4c5a-4111-a827-d0f1b25870ff` 显式提交原 root digest 与
完整原 bindings，最终 revision 33、ready，根与动态依赖全部回到 v1，
叶子 revision 也回到 leaf-v1，且此恢复没有新增下载。它是授权缓存保留期间的
**新准确观察**，不是跨重启透明恢复原 Execution，也不承诺浮动地址永久可重新获取旧内容。
另一个准确 `/objective/v1.tgz` 来源调用成功；拿原 digest 请求
`/objective/v2.tgz` 的 Task `c494d2a7-8994-40af-bec4-c63a7fc70904`
真实 failed revision 3、`digest_mismatch/verify`，没有追新或替换内容。

实际叶子 runtime 为 Node `24.11.1`、win32、x64、`node-commonjs-v1`，
记录的完整配置包括 workers 4、deadlineMs 30000、cleanupMs 5000、
messageBytes 8388608、directories/observers/queue 64、records 256、
retentionMs 60000、retireAfter 100。不是仅报告 manifest 最低版本 22.13.0。
用作者输出的准确入口字节独立计算历史胶囊 revision：
`SHA256(JSON.stringify(["worker.cjs", byteLength]) + NUL + entryBytes)`，
与真实 worker 证据逐条相等，不把 Git tree digest 换前缀冒充：

| Checker | 独立 worker revision |
|---|---|
| root-checker | `af1819cb3ddd1a6db7b8add02913f246d09438eec73c4ddb35da7f0c5927a0c4` |
| leaf-checker-v1 | `15878f67aee21d19a354dadb63431f749e1bf514708705b68d39d86d3f3cebcd` |
| leaf-checker-v2 | `8b724dd019734dddc3a986a53369e57bf83df1bea4cc367f351b4caa2659c574` |

## 清理与可复核边界

统一 Host、HTTPS source、断流代理全部关闭；kernel.close 已等待 worker_threads
终止。实际 worker 是 Host PID 10424 内线程 1、3，不是独立 OS 子进程。
五类门闩场景的 start/defer-cleanup 数分别为 1/1、1/1、1/1、2/2、1/1。
独立后验检查确认 PID 10424 已退出，三个端口均拒绝连接，无长期服务。

操作自有制品目录、门闩、执行胶囊、证书私钥、安装目录和打包归档完成后清理。
仅保留操作目录中的 `verify.mjs` 与不含令牌/私钥的 `report.json` 作为本地复核附件；
报告含原始事件及最终快照。仓库持久证据为本页，不依赖保留运行中的服务或作者目录。
清理后附件 SHA-256：`verify.mjs` 为
`cbec75365eaadf3fe09080e75a405ba3dd6475cee9a22aec642c688476b4d847`，
`report.json` 为 `433961122f11afff9e156820b6301090fe62f5df5ea5d8925be00b49d9a1d8c5`。
后续复跑须重新 build/pack/install、生成短期证书；端口及包含该端口的合成制品摘要会变化，
不应把新运行的摘要冒充本次准确字节。

早期失败不计入成功证据：一次 Windows 命令引号使 pack 目的路径无效；
一次合成 fixture 给仅支持 en 的动态依赖请求 zh-CN，服务正确拒绝；
另一次检查误把 worker_threads 的共享 PID 当独立子进程，导致清理后验超时。
均仅修正操作自有脚本，无生产修复或测试放宽。最终完整脚本及独立退出/端口检查均 exit 0。
