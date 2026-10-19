# 干净 Docker 环境中的独立自查验证

主会话于 2026-10-19 执行并独立核验。子会话实现 harness，主会话负责构建、运行、读取原始 probe 和批准本次容器验证结果。这里证明 Linux 安装产物与受控 ACP 的集成行为，不替代真实模型认证和真实设备验收。

## 首轮可复用环境（历史）

- 镜像：`pguide-self-check:7dd2b7ee`。
- 镜像 ID：`sha256:e0dac12378718ef7fdc3f5b8f46c14bd6a58e80c2743d6cdc60ed3d585997abd`。
- 已保留运行中的容器：`pguide-self-check-7dd2b7ee`，ID 前缀 `a17f68d22595`。
- Linux x64、Node.js v22.23.3，UID 1000，HOME `/work/home`。
- 无网络、无挂载、无 Docker socket；丢弃全部 capabilities，启用 no-new-privileges。
- 限制为 2 CPU、1 GiB 内存及总内存交换上限、128 个进程；未修改其他容器。
- 环境变量名称检查没有发现认证、token、密码、Copilot/GitHub、代理或 registry 配置；没有向容器转交宿主 HOME、用户配置或凭据。
- 运行层没有 `/source`、`/toolchain`、`/packs` 或 pnpm 入口；pguide 来自隔离 consumer 中安装的包，不依赖宿主源码目录。

每次验证在 `/work/runs` 下建立独立目录。镜像是可重新创建干净实例的基线；当前容器保留三次验证证据，不声称其工作目录从未运行过任务。

构建、检查、复用和定向清理命令见 [harness 使用说明](../../../../../scripts/self-check-docker/README.md)。准备脚本只接受显式完整 commit，使用 Git archive 和明确的 harness 文件白名单；不将整个工作区作为 Docker context。

## 构建来源与可复现边界

| 项目 | 已记录值 |
| --- | --- |
| 原始源码 commit | `d35db7554cfbcf25ed675fad1aa07dd4e8d906df` |
| 源码 archive SHA-256 | `deaba6d3bc9802d5a280311d5664832e303727a466df9029ffb73cf12bc00be2` |
| 容器内 Objective Git revision | `dd160277e099edd749d320613403590ec528697f` |
| 已安装 pguide | `0.4.0-rc.0` |
| consumer npm lock SHA-256 | `61ee9cbe1b799af692a554a49d0684b50a801c1b07b297adb546a266e6ebcd72` |
| 隔离编译工具链 lock SHA-256 | `dc4951b6b2fa4f3e230b177e39784ab31c6ba5bc6e3544d87ff232f23349b2f8` |

Node 基础镜像固定为 `node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392`。

构建先尝试常规 frozen workspace 安装，但容器到公开 npm 的 TLS 连接失败；改用宿主已配置、无需认证的 HTTPS registry 后，锁定的 Turbo 2.11.8 tarball 返回 404。没有关闭 TLS、换成未批准镜像源、修改版本或锁文件。

最终构建方式为 `frozen-prod-plus-tsc-project-references`：pnpm 11.22.0 使用原始 frozen lockfile 安装生产依赖并禁用生命周期脚本；另外安装固定的 TypeScript 5.9.3、@types/node 22.20.5、@types/cross-spawn 6.0.6 和 undici-types 6.21.0，通过原有 TypeScript project references 构建八个包。前三项版本必须与所选源码 catalog 一致，否则构建失败。工具链有单独 npm lock，不冒称由仓库 frozen install 覆盖。

所有发布包在构建阶段打包，通过现有 deployment consumer helper 验证内部依赖图。运行阶段只复制安装后的 consumer、已提交的 Objective 快照和验证工具。没有发布 npm 包，也没有以公开版本替换本地 pguide 或内部包。消费者第三方依赖及 Debian 仓库没有完全固定，因此不承诺镜像逐字节可复现；各 harness 文件哈希和两个 lock 哈希均记录在容器 `/harness/provenance.json`。

## 完整 probe 结果

主会话依次执行一次正例和两个反例，均使用容器内已安装 pguide 加载上述已提交 Objective 快照，没有发送真实模型请求，也没有增加 allowSanity 或 target。

| 模式 | 实际行为 | 实际 level | 实际 problems | session/prompt 次数 |
| --- | --- | --- | --- | --- |
| `fix` | 写入请求的随机精确内容 | `terminal` | 空 | 1 |
| `wrong` | 写入错误内容 | `configured` | `sanity-failed` | 1 |
| `summary-only` | 声称成功但未修改文件 | `configured` | `sanity-failed` | 1 |

两个反例的安全诊断均为 `stage=recheck`、`reason=nonce-mismatch`，没有把 Agent 完成摘要当作成功。三次原始 Envelope 均为 status 200，说明仅检查命令退出码或 Envelope 状态不能判定自查通过。

主会话还直接读取原始 probe、prompt 日志和 scratch，使用独立断言确认：

- 精确匹配 Objective revision、level 和 problem ID，不只相信 harness 的 verified 字段。
- 每次日志只有一个 session/prompt，模式与本次验证一致；没有记录 prompt 正文或 nonce。
- 三次独占任务目录都已删除；scratch 中只留下预先放置的无关 `keep.txt`。
- 已安装 pguide 自报身份、版本正确，容器实际 user/network/capabilities/mount/resource 配置与预期一致。

原始证据保留在：

```text
/work/runs/fix-6BeXM9
/work/runs/wrong-h15MpN
/work/runs/summary-only-YGMbYh
```

每个目录包含 probe.json、prompts.jsonl、verification.json、配置和 subject。主会话另将这三组原始证据与 provenance 复制到会话持久文件目录的 `docker-self-check-a17f68d22595`，不提交运行缓存或临时 build context。

## 首轮仓库验证与门线（历史）

主会话对本次 harness 候选两次执行 pnpm check，退出码均为 0；其中部分 workspace 任务命中已有 Turbo 缓存。新增 context 测试纳入现有根脚本默认测试路径，常规检查不会启动 Docker。Docker 构建中的 TypeScript 编译不是容器内完整 pnpm check，二者分别记录，不混为同一证据。

随后整合并发 primary 的 monorepo 和设备健康 Objective，Windows 上新的全量复跑退出码为 1：pguide 出现 8 项失败，涉及进程终止、旧 setup、自查及 supervise。对这 8 项使用同一 runner 串行定向复跑，3 项恢复通过，仍有 5 项失败：

- 旧 setup 的远程 nonce、noop 拒绝及 Git 快照三项返回 deadline 超时。
- 自查有界超时用例未生成预期 ACP 日志，读取 acp.jsonl 时 ENOENT。
- 强制终止用例报告 Windows taskkill 无法终止部分子进程，原因是 operation attempted is not supported。

因此不能把旧缓存绿色或 Linux 正例当作当前 Windows 全量已通过。没有放宽生产预算、跳过失败断言，或修改本次 harness 范围以外的实现。完整失败日志保留在会话证据副本的 post-sync-pnpm-check.log；未确认这些 Windows 失败的根因。新增 context 测试与并发 monorepo 根脚本合计 5 项通过，新整合的设备健康 Objective 定向测试 15 项通过。主会话另对最终整合候选复跑格式、lint、类型和 pack 检查，均退出 0；不以这些成功替代上述测试失败。

首轮容器集成验证通过；当时真实独立 ACP 认证及上述宿主回归失败均阻塞验收。后续宿主回归结论以下节为准，不将历史失败删除或继续列为当前未解决问题。

## 后续独立复验：源码 811f28d

2026-10-19，主会话同步上游 Windows 修复后，重新从精确提交 `811f28d802028b8c5a82337a47f9b111d83cedb6` 构建、安装并验证。没有复用旧镜像冒充新源码，也没有修改预算、跳过断言或替换锁定 Turbo 版本。

| 项目 | 已记录值 |
| --- | --- |
| 镜像 | `pguide-self-check:811f28d-7dd2` |
| 镜像 ID | `sha256:00b963a7b9b57901605c67cfabbcf79997b4c202977928a267ef424a6a67f44a` |
| 保留的容器 | `pguide-self-check-811f28d-7dd2` |
| 容器 ID | `6c8721566dc04ed904df3de59070113439c6ecc8df7dcd35e2067e248b013b02` |
| 源码 archive SHA-256 | `4d75513d4e259475ca133a4b834d05ae7d23dd6138baa3d842653ec9a6dcb447` |
| 容器内 Objective Git revision | `c228e65e39c5eb3ae8e9d3fe52e9834b4819e899` |
| consumer npm lock SHA-256 | `6c36a2e35e22de9a47f995c8a33d7b1e7302c2a7accac70d074f23accab03205` |
| 隔离工具链 lock SHA-256 | `dc4951b6b2fa4f3e230b177e39784ab31c6ba5bc6e3544d87ff232f23349b2f8` |

基础镜像、固定工具链及 `frozen-prod-plus-tsc-project-references` 构建方式与首轮一致。主会话重新检查 Node v22.23.3、UID 1000、HOME、无网络/挂载/socket、全部 capabilities 丢弃、no-new-privileges 及 2 CPU / 1 GiB / 128 PIDs 限制；没有凭据、代理或 registry 环境变量，运行层没有源码、工具链或 tarball 目录。旧容器保持不动；新临时构建 context 已定向删除。

| 模式 | 原始证据目录 | 实际 level | problems | prompt 次数 |
| --- | --- | --- | --- | --- |
| `fix` | `/work/runs/fix-fYG7jD` | `terminal` | 空 | 1 |
| `wrong` | `/work/runs/wrong-eTamf9` | `configured` | `sanity-failed` | 1 |
| `summary-only` | `/work/runs/summary-only-tKF2jx` | `configured` | `sanity-failed` | 1 |

主会话另直接读取三组原始 probe、日志和 scratch，独立断言 status 200、精确 Objective revision、level/problem ID、单 prompt、独占任务清理及无关 sentinel 内容保留。原始证据和 provenance 已复制到会话持久目录 `self-check-811f28d-6c8721566dc0`。这些是父会话的安装产物验证，不是子会话测试报告的转述。

Windows 回归由专门子会话执行，源码同为 `811f28d802028b8c5a82337a47f9b111d83cedb6`：

- 八项历史失败在一个串行 tsx runner 中按精确名称选择，8/8 通过，退出 0，耗时 278.299 秒；该定向运行没有测试缓存。
- `pnpm run build` 退出 0，9/9 Turbo 任务命中缓存。
- `pnpm check` 退出 0；其中 pguide 测试实际执行，104 通过、0 失败、1 项已有平台跳过。其他任务可能命中 Turbo 缓存，不称为全仓无缓存复跑。
- 上游 deadline 协调、Windows 所有权快照及后代进程清理修复后，首轮剩余的五项失败已恢复；没有为此新增 skip、放宽期限或减少负例。

八项历史回归的精确复跑命令为：

```powershell
pnpm exec tsx --test --test-concurrency=1 --test-name-pattern='^(force termination stops a live process tree and cleans the owned run directory|remote payload uses target authentication and performs actual nonce sanity, not control evidence|real sanity rejects noop Agent completion|Git subdirectory snapshot coordinates long local budgets and existing file-auth ACP to terminal|self-check bounded timeout cleans owned task/state and preserves unrelated scratch|self-check wrong, summary-only, denied, incomplete and oversized Agent runs cannot pass|self-check committed Git subdirectory snapshot is dependency-free and reaches terminal with one prompt|supervise plans once without repairs, then continuously observes and executes a pinned goal once)$' packages\pguide\test\regulation-process.test.ts packages\pguide\test\setup-objective.test.ts packages\pguide\test\supervisor-cli.test.ts
```

这些容器证据固定在 811f28d，不自动覆盖之后的源码修订，也不将本容器描述为以下提交构建。

## 后续 Windows 整合检查：源码 6d3d635

随后同步 `6d3d6351536b77e22c70b73f8dbfe6725363cb8b` 的 Windows 快照输入关闭和安全阶段诊断修复。Windows 子会话在该源码上再次执行 `pnpm check`，退出 0：合计 351 项测试、350 通过、0 失败、1 项已有平台跳过。

- pguide、cli-core、config 测试及根目录 19 项脚本测试实际执行。
- 其余六包测试命中缓存；测试阶段含构建共 18 tasks、12 cached。
- lint 为 7/9 cached，typecheck 为 6/9 cached，pack 阶段 build 为 9/9 cached。
- 完整日志另复制到主会话持久文件 `self-check-6d3d635-pnpm-check.log`，不把缓存输出称作全部测试重新执行。

## 后续 Windows 整合检查：源码 9289935

再同步 `928993592df854cc3b6e7fa7a30b4bdb1233b523` 的原生 Toolhelp32 所有权快照修复后，Windows 子会话固定该源码执行 `pnpm check`，退出 0：合计 353 项测试、352 通过、0 失败、1 项已有平台跳过。

- 实际运行 cli-core 77 项、config 6 项、pguide 105 项及根脚本 19 项；其余六包测试命中缓存。
- lint 为 7/9 cached，typecheck 为 6/9 cached，测试含构建为 12/18 cached，pack build 为 9/9 cached。
- 完整日志另复制到主会话持久文件 `self-check-9289935-pnpm-check.log`。
- 本机自查使用指引按此实现更新：需要系统 Windows PowerShell、允许 Add-Type 内存编译及原生 Toolhelp32 调用，不再将 CIM/WMI 列为必要前提；编译与查询共用 10 秒 watchdog，不放宽原执行预算。

## 主会话最终整合检查：源码 fbccc9d

主会话检查并整合后续可信 Windows 命令加载修复，在 `fbccc9de7e9ba909771d21aff1a0410d1d96ccbe` 独立执行 `pnpm check`，退出 0：合计 354 项测试、353 通过、0 失败、1 项已有平台跳过。

- pguide 105 项测试实际执行，104 通过、1 项已有跳过；根脚本 19 项实际执行且通过。
- 其余八包测试命中 Turbo 缓存，其中 cli-core 78 项、config 6 项。测试含构建为 16/18 cached；lint 与 typecheck 均为 8/9 cached，pack build 为 9/9 cached。
- 完整日志保留为主会话持久文件 `self-check-final-integrated-pnpm-check.log`。不把缓存测试算作主会话无缓存复跑，也不把先前子会话结果称作父会话执行。
- 随后整合到 primary 的 26c2c27 仅更新另一 Idea 的事件、ledger 和交付证据，没有再次改变已验证的运行源码；本轮自己的最终变更也仅为文档。
- 主会话确认保留容器 `pguide-self-check-811f28d-7dd2` 仍运行且响应 Node v22.23.3，镜像 ID、无网络和无挂载状态与记录相符；没有重复执行已有三个 probe。

真实独立 ACP 仍缺正常用户认证，主会话固定 811f28d 的完整 probe 没有 terminal，见 [当前设备验证](./Local-device-validation.md)。I-S03 和 I-AC03 仍未完成，不提交 submitInner，不批准 acceptInner 或交付验收；fixture 的 terminal 不替代真实用户 Agent 的 terminal。

## 当前设备的首版真实 Agent 基线容器

用户要求先同步最新代码，再建立能够验证真实 Agent 的 Docker 环境，避免在未证明模型可用时重复自查。主会话已将本分支 fast-forward 到 `6fda06f20fc0c152485ee5bc7065f65813d30966`，确认与 origin/main ahead/behind 为 `0/0`，保留全部并发修改。当前 Docker 引擎最初未启动，通过 Docker Desktop 正常启动后确认 Linux Engine `29.3.0` 可用，没有修改其他容器。

默认 `runtime` target 仍是前文无网络、无凭据 fixture；新增显式 `real-agent` target 和 [真实基线 runner](../../../../../scripts/self-check-docker/real-agent.mjs)，不把旧 fixture terminal 当作模型成功。固定安装官方 Copilot CLI `1.0.98`，认证只允许在容器内通过官方登录建立，不向构建或运行层传入宿主 token、HOME、认证文件、源码 bind mount 或 Docker socket。

### 已构建并保留的环境

| 项目 | 实际值 |
| --- | --- |
| 镜像 | `pguide-real-agent:6fda06f-1ce0ed16-pinned` |
| 镜像 ID | `sha256:50c95b42a3534d34938c8ea38ba9d54e34f56460049a1f1510d5808d8223753a` |
| 容器 | `pguide-real-agent-6fda06f-1ce0ed16-pinned` |
| 容器 ID | `537162d1ce03a226f9abffcc4b81fd0be2aeea7a65f73a862041347d8e99ce34` |
| 基础镜像 | `node:24-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03` |
| 实测 Node / Copilot | `v24.19.0` / `1.0.98` |
| 运行用户 / HOME | `node`（UID 1000）/ `/work/home` |
| 源码 archive revision | `6fda06f20fc0c152485ee5bc7065f65813d30966` |
| 源码 archive SHA-256 | `7e1fe088ae640bfced986a31ec4b9f8197a39670d6da603a02eee9d49e6d6f10` |
| 容器内 Objective Git revision | `a90a62c9363b70993188f7deb5f23eaf0d2deeff` |
| 已安装 pguide | `0.4.0-rc.0` |
| Dockerfile / real-agent.mjs SHA-256 | `7072d5e2fcf5d4ff49aa52ba5dead70b66483f781ba73a16ae4bda7654f84454` / `a83c3ded73397030368e5097cdd52159ba96d7231fef98d3baa4a5de7c9c2583` |

源码通过 Git archive 固定；六个白名单 harness 文件来自构建时工作树，分别记录哈希，不声称它们属于旧源码 commit。仍采用 frozen 生产依赖安装和独立固定 TypeScript 工具链，不安装替代 Turbo 或改锁文件，不发布 npm。完整 provenance 在容器 `/harness/provenance.json`，另复制到会话的 `real-agent-pinned-provenance.json`。固定版本通过 `COPILOT_AUTO_UPDATE=false` 及 ACP 参数 `--no-auto-update` 禁用自动升级；主会话独立核验该环境开关与容器实际 runner 哈希。早期同名但不带 pinned 后缀的本次任务容器已定向停止，未删除其层或任何认证文件；后续只使用表中最终容器。

首次构建遇到 Debian HTTP 502；改为官方 HTTPS 后发现 slim 基础镜像尚无系统 CA。最终使用固定 Node 镜像自带的公开根证书引导 HTTPS，再正常安装系统 ca-certificates、git、procps，构建成功。没有关闭 TLS 校验、加入宿主或自签证书、替换未经批准的源或传递 npm 认证。该流程不承诺 apt/npm 依赖逐字节可复现，保留实际 lock 哈希与镜像 ID。

容器使用 init、bridge 网络、2 CPU、2 GiB 内存及相同 swap 总上限、256 进程上限，丢弃全部 capabilities 并启用 no-new-privileges。主会话独立检查确认运行中、非 root、mounts 为空、没有发布端口。真实登录及模型调用需要网络，这与 fixture 的 network none 有意区分；没有授予 shell 或 URL 工具网络权限。

### 严格基线与实际阻塞

`discover` 只建立会话并读取模型元数据，绝不返回 ready。`verify` 必须显式指定模型，核对它已被 Agent 列出且 session/new 返回模型匹配，再执行唯一一次真实随机 marker 修复。仅允许该 marker 的绝对路径写入，禁用 shell、URL 工具及默认系统临时目录访问，其余权限请求一律拒绝。必须 end_turn、没有拒绝、普通非链接单硬链接文件的字节数与随机内容独立匹配、进程和独占 task 清理成功，才返回 ready。失败使用固定分类并非零退出，不记录模型正文、prompt、nonce、token 或原始服务错误。

120 秒是独立基线诊断上限，不修改正式 Pilot 24 秒上限；即使此基线将来通过，也不替代 I-AC03 的完整自查 terminal。后续验证必须先取得同一容器、所选真实 Agent/model 的 ready；版本命令、镜像构建、登录和模型目录均不能单独开门。

首次容器执行一次 `--mode discover --timeout-ms 15000`，约 `511 ms` 明确返回 authentication-required；加入禁用自动升级的固定运行设置后，最终容器独立执行同一无 prompt 探测：initialize 约 `499 ms`，session/new 明确失败，最终报告 `status: failed`、`reason: authentication-required`、`promptCount: 0`、`markerVerified: false`，总计约 `536 ms`，退出码 `1`。独立读取最终 `/work/runs/real-agent-53jHtO/baseline.json` 并检查 task 已删除。最终安全报告复制到会话的 `real-agent-pinned-baseline.json`；首轮报告和 provenance 保留为历史。本轮没有发送任何真实模型提示，也没有因为构建成功而继续 pguide probe。

当前需要设备用户在自己的交互终端中执行：

```powershell
docker exec -it pguide-real-agent-6fda06f-1ce0ed16-pinned copilot login --device-code
```

只在官方页面完成授权，不向会话发送 token 或认证文件。容器内 CLI 帮助已确认此参数；无系统凭据存储时，登录可能以明文保存在容器 HOME，故不得 docker commit/export 该认证容器、复制 HOME 或收集凭据。登录状态真正保存后，再由主会话发现可选模型、选择模型并运行一次真实基线；只有 ready 才继续自查。

用户随后明确要求由主会话在容器中启动流程，并提供链接供其浏览器授权。主会话通过官方 `copilot login --device-code` 执行；设备链接和临时代码只用于本次交互，不写入仓库。流程最终退出 `1`，安全结果为“Login succeeded, but the token was not saved. Install a system keychain or rerun login and accept plaintext storage.” 这说明浏览器授权成功，但容器没有系统 keychain，且非交互流程未确认明文存储；不能据此宣称容器已登录或真实模型可用。

已通过结构化询问请求用户选择“仅此私有容器内允许官方明文存储并重新授权”或“先配置系统 keychain”，未获得答复。没有默认同意明文存储，没有读取、提取或转移 token，也没有发起第二轮 OAuth 或真实 prompt。下一步等待明确的认证存储选择，再采用对应的官方交互登录流程；保留最终容器运行，停止对未改变的认证状态重复探测。

### 自动验证与门线

定向五项测试通过，覆盖构建上下文白名单，以及 ready 必须真实完成并独立核验、discovery 不能 ready、认证/模型不匹配/假修复/拒绝/超时/清理失败不能 ready、marker 链接与内容复查。测试替身仅用于这些单元回归，不是容器真实 Agent 通过证据。

三次完整 pnpm check 均退出 `0`，报告合计 369 项、367 通过、2 项已有跳过、0 失败；根脚本 20 项和 monorepo 34 项实际执行，其余十一 workspace 测试使用 Turbo 缓存。最后一次包含最终 HTTPS/公开 CA Dockerfile、禁用自动升级的断言与 context 测试。I-S03、I-AC03 仍未完成，不 submitInner、不请求实现或交付验收。当时外部阻塞为容器内认证的存储选择及完成登录；后续用户选择和配置以下节为准。

## 容器内加密 keychain 配置

用户明确选择先配置容器内 keychain，不批准明文回退。本轮为 real-agent target 增加标准 D-Bus、GNOME Keyring 和 libsecret-tools，在构建阶段安装，不为运行中的 cap-drop ALL 容器恢复 root capabilities。未复制、读取或导出宿主 token、既有认证文件或用户 keyring；未把空口令或与加密文件放在一起的明文口令当作受保护存储。

### 当前可复用环境

| 项目 | 实际值 |
| --- | --- |
| 镜像 | `pguide-real-agent:e4e84fd-1ce0ed16-keychain-final` |
| 镜像 ID | `sha256:d962dae39583bae46115c383dcea8c31decd505b3693f5aa6122be5c4650548f` |
| 当前容器 | `pguide-agent-keychain-1ce0ed16` |
| 容器 ID | `6e7bfd245d885f314a13eb892733754c4612c9969edc34962922064a333bf938` |
| 固定源码 / archive SHA-256 | `e4e84fd9b09d95bfd9e652dd432c1342bc7c79da` / `4e1bd24fcdfd6d3342a4410c72cd43e2aeae43ce10a0223d9c96d9610a87cd57` |
| 私有用户总线 | `unix:path=/work/runtime/bus` |
| runtime 权限 | `node` 所有，`0700` |
| 基线 | Node 24 的已记录 digest，Copilot `1.0.98`、禁用自动升级 |

容器保持非 root、init、bridge、2 CPU、2 GiB、256 进程上限、cap-drop ALL、no-new-privileges，无宿主挂载和发布端口。上一轮 pinned 容器已定向停止，保留其层而不复制任何认证；后续使用表中简短名称的新容器。Docker Desktop 在本轮期间重启并升级到 Engine `29.8.2`，待引擎恢复后才继续验证，没有更改其他用户容器。

[私有总线入口](../../../../../scripts/self-check-docker/keychain-entrypoint.sh)监督 D-Bus 和主命令；[交互解锁入口](../../../../../scripts/self-check-docker/keychain-unlock.sh)通过隐藏终端输入接收非空口令，确认两次，只通过 stdin 交给 GNOME Keyring，不写入参数、环境、文件、日志或源码。解锁有意替换本容器的 Keyring daemon，必须在 Agent 工作前执行，不在运行请求中替换。master password 不被保留，容器重启后需用户重新解锁。

首次口令初始化之前，[状态检查](../../../../../scripts/self-check-docker/keychain.mjs)只检查总线名称，不提前激活一个未初始化的 Secret Service；解锁后最多等待 5 秒完成服务注册。真实 Agent 子进程显式继承容器内 HOME、DBUS_SESSION_BUS_ADDRESS、XDG_RUNTIME_DIR，不继承宿主环境或 token。集合缺失或锁定时，baseline 明确失败且不启动 Agent。

构建 context 白名单扩为九个文件，shell 输入规范化为 LF 并对规范化后的实际字节记录哈希，避免 Windows CRLF 破坏 shebang。容器实际 runner、状态、解锁和入口脚本哈希均已与 `/harness/provenance.json` 独立核对；安全 provenance 副本在会话的 `keychain-container-provenance.json`。失败的无凭据测试实例和临时 context 定向清理，不保留或导出测试 keyring。

### 独立实测

最终镜像在无网络、cap-drop ALL 的全新一次性容器中执行真实 Secret Service 自检；只生成内存中的测试口令和测试值，没有真实 token。最终结果退出 `0`，安全摘要保留为会话文件 `keychain-self-test.json`：

```json
{
  "status": "verified",
  "roundTrip": true,
  "encryptedFile": true,
  "lockAndUnlock": true,
  "wrongPasswordRejected": true
}
```

自检实际核验 secret-tool store/lookup/clear、GNOME 加密 keyring 文件和 0600 权限、文件中不存在测试值或 master password 明文、锁定后错误口令不能解锁、同一正确口令重启 daemon 后可读回原测试值。它拒绝已有集合，不能在真实已认证容器运行。测试实例随后删除，只复制上述无秘密摘要，不读取真实用户凭据。

配置结束时复用容器尚未初始化真实用户密码，状态为 `serviceAvailable: false`、`collectionExists: false`、`locked: true`，符合等待用户初始化的设计，不声称当时已解锁。已独立确认：

- 默认 CMD 能持续运行，重启后私有 D-Bus 恢复。
- 非交互调用 unlock 被拒绝，不接受管道中的口令。
- 集合未初始化时 baseline 被明确阻断，没有重新发起 OAuth 或模型请求。
- shell 语法与容器内脚本哈希匹配、runtime 私有目录权限正确，无明文凭据回退。

### 用户当前需要的操作

请设备用户在自己的交互终端中执行：

```powershell
docker exec -it pguide-agent-keychain-1ce0ed16 /harness/keychain-unlock.sh
```

自行选择并确认 keychain 口令，不把口令发给 Agent。该命令第一次初始化加密集合，以后用于解锁；忘记口令不能由 Agent 恢复。用户确认已解锁后，再在这个容器内重新启动官方设备授权，由用户浏览器授权，然后验证 Copilot 确实存入 keychain，最后运行真实 Agent baseline。此前浏览器授权但未保存的 token 不尝试提取或复用。

最终 pnpm check 退出 `0`：372 项报告、370 通过、2 项已有跳过、0 失败。根脚本 23 项和 monorepo 34 项实际执行，其余十一 workspace 测试使用 Turbo 缓存；keychain 解析、畸形/未知状态不能误报解锁、context LF 和 baseline 环境回归均覆盖。Secret Service 自检是额外容器实测，不是这些单元测试的替身，也不代表 Copilot 已保存认证或模型任务已完成。I-S03、I-AC03 继续未完成，下一外部步骤是用户在自己的终端初始化/解锁，不能自动代设或持久化 master password。

## 用户解锁后的终端生命周期修正

用户报告“已解锁”后，主会话先执行只读 require-unlocked 检查，没有直接启动 OAuth。实际发现总线中没有持续的 Secret Service；随后原生 ReadAlias 探测激活了一个读取既有 login 集合但处于 locked 的 daemon。这证明用户集合已初始化，不能据此认为用户没有执行解锁，也不能将其当作已持续可用的解锁状态。没有读取 keyring 内容、口令或 token，也没有重置集合。

此前自检没有覆盖真实交互终端和 docker-exec 父进程全部退出后的状态。本轮将公开 unlock helper 改为通过 setsid 启动独立会话中的 foreground daemon，关闭对原终端的描述符；口令仍只从隐藏交互输入经 stdin 传递。helper 记录旧 D-Bus owner，必须观察到新 owner 已解锁才成功，不能因旧 owner 尚未退出而误报成功。错误口令不会被接受，也没有空口令或明文回退。

新增实测用 script 创建真实伪终端、禁止输入回显，在一次性无网络容器中运行同一个交互 helper。加密存取、锁定/解锁、错误口令拒绝及关闭终端后继续可用均通过；在另一保持运行的一次性容器中，完整测试进程退出后等待 5 秒，再通过独立 docker exec 确认集合仍 unlocked，进程检查显示 GNOME daemon 独立 SID 且没有 TTY。所有测试只使用生成的测试材料，实例已定向删除；安全摘要在会话的 `keychain-tty-self-test.json`。

为保留用户已经初始化的加密集合，没有重新创建或重启当前 `pguide-agent-keychain-1ce0ed16`，更没有 docker commit/export。只把两个公开 helper 覆盖到原容器 `/harness` 并核验可执行权限与 SHA-256：

- `keychain.mjs`: `3ff72c777d5db670b870ab2272c1d1432006c20272cd1aabf257a190376fa998`
- `keychain-unlock.sh`: `22aab8ad2b19f194306ee7ad36c4e36f45f6c31084d9e2f3a3b541ef3a4346eb`

容器基础镜像和原 provenance 保持不变，不冒称重新构建；公开代码热修的独立记录在 `/harness/runtime-overlay.json`，会话中保留同名安全副本。未复制或修改 HOME/keyrings，后续重建使用仓库修正后的 helper。

该修复发布时，真实用户集合存在但 locked，需要用户用同一口令再次运行上一节相同的交互解锁命令，不需要重新设置或向 Agent 提供口令。确认持续 unlocked 后才重启官方设备授权；修复验证本身没有产生新设备码或模型请求。完整 pnpm check 退出 `0`：373 项报告，371 通过、2 项已有跳过、0 失败；根脚本 24 项和 monorepo 34 项实际执行，其余十一 workspace 测试使用缓存。后续登录和真实验证以下节为准。

## 已认证真实 Agent 基线通过与正式自查预算

用户再次完成交互解锁后，主会话独立确认同一容器、同一 Secret Service owner 下集合持续 unlocked，再启动官方设备授权。用户完成浏览器操作后，登录进程退出 `0`，明确返回 Signed in successfully，而非此前 token 未保存的失败。临时设备码不写入仓库。后续仅查询集合 Items 元数据确认存在条目，不读取任何 secret 值、token、认证文件、keyring 文件或用户口令。

### 真实模型可用性已实测成立

先执行一次零 prompt 的 discover，成功返回模型元数据；它仍只记为 discovered，不作为通过。随后使用本账号实际列出的 `gpt-5-mini`，在同一容器中执行唯一一次真实 baseline：

| 检查 | 实际结果 |
| --- | --- |
| baseline | `/work/runs/real-agent-lHBDqi/baseline.json` |
| 状态 / 退出码 | `ready` / `0` |
| requested / selected model | 均为 `gpt-5-mini` |
| prompt / deniedRequests | `1` / `0` |
| 独立随机 marker / task 清理 | 均为 `true` |
| initialize / session-new | 启动后 `4149 ms` / `9533 ms` |
| prompt 正常完成 / 总时长 | 启动后 `27435 ms` / `27482 ms` |
| prompt 发出至完成 | 约 `17902 ms` |
| marker SHA-256 | `08bdc0ff666b166ca5aa231ac6ff6c26aef972892dd9c1f5256f4331afa96e71` |

runner 使用真实官方 CLI，不是 ACP fixture；只有显式 end_turn、没有拒绝且独立读取随机文件准确匹配才能 ready。传给 ACP 的环境仅为容器自己的 HOME、私有 D-Bus 和 runtime 地址，没有转交宿主 SDK 或 GitHub token。原始安全报告副本为会话文件 `authenticated-agent-baseline.json`。这次证据确认 `gpt-5-mini` 在本次认证、用户和入口下确实可调用并完成修复；不把该结论推广为永久可用或所有设备可用，也不把此前超时归因为模型一定不存在。

### 真实 baseline 开门后的完整 pguide probe

后续验证先核对上述 ready、模型匹配、唯一 prompt、无拒绝、清理结果和容器源码一致，不因登录或模型列表成功就跳过门线。使用容器中已安装 `pguide 0.4.0-rc.0`、源码 `e4e84fd9b09d95bfd9e652dd432c1342bc7c79da` 对应的 Objective 精确 revision `a90a62c9363b70993188f7deb5f23eaf0d2deeff`，保持正式 `timeoutMs: 24000` 不变。

第一轮完整 probe 返回 Envelope 200、停在 installed/configuration、problem 为 environment-unavailable；prompt 数为 `0`。原因是 Git probe 隔离环境未继承 D-Bus/runtime 变量，不能把外层会话成功沿用为内层可用。

本轮未扩大 Git probe 的全局环境白名单。仅调整这个容器操作员控制的本地 ACP 启动器：profile 只引用 HOME，启动器对固定 `/work/runtime` 校验 canonical 路径、当前 UID、0700 权限，以及 bus 为同一 UID 所有的 Unix socket，再显式为真实 Copilot 设置该私有地址。没有复制认证文件、注入 token、改 keychain 或扩展文件/shell/URL 权限；marker 仍只授权本次绝对文件路径。该配置条件变化前没有发送模型请求，不是在同一条件下自动重试。

调整后只执行一次完整真实 probe，证据目录 `/work/runs/real-self-check-jtuR17`：

- configuration 的真实 session/new 成功，sanity 的唯一修复会话也确认模型匹配。
- sanity initialize 在启动后 `8822 ms` 完成，session/new 在 `13421 ms` 完成，唯一 prompt 于 `13422 ms` 发出。
- `19898 ms` 因剩余预算发送 cancel，prompt 实际等待约 `6476 ms`；没有 end_turn 或独立文件修复成功证据，没有权限请求。
- 命令退出码 `6`，Envelope 为 `504`、空 payload、`timeout: direct Agent exceeded its deadline.`，不能称为 terminal，也没有成功版本投影。
- 独占 scratch 全部删除，只保留预先放置的无关 keep.txt；没有额外模型重试、换模型、扩权或延长 Pilot 预算。

原始 verification 与无秘密方法审计保留在容器对应 run，安全副本分别为会话文件 `authenticated-self-check-report.json`、`authenticated-self-check-audit.jsonl`；环境阻断的零 prompt 报告为 `authenticated-self-check-environment.json`。验证器只透传真正的 ACP 消息，不合成完成响应；公开源文件留在会话的 `validate-real-container-self-check.mjs`，临时容器入口随后定向清理，不触碰 HOME 或认证存储。

### 当前结论与下一决策

认证和真实模型修复能力现已成立；当前正式自查仍受 24 秒总预算限制，不能以 120 秒 baseline 的 ready 冒充原标准通过。基线完整运行约 27.5 秒，正式 sanity 的本次 startup 又消耗约 13.4 秒，明确说明预算需要与真实启动和清理成本一起评估；尚不承诺固定延长值能覆盖所有时延。

已提出仅增加显式可配置的较长预算、保留现有默认值并强制协调内外期限及清理余量的选择，未获得用户答复。因此保持当前行为，不修改 manifest、默认预算或正式通过条件。下一步等待这项行为决策，再按被接受的契约实现与复验。I-S03、I-AC03 继续未完成，不 submitInner、不请求实现或交付验收；已经通过的真实 Agent baseline 作为可复用环境证据保留。

本轮发布前 pnpm check 再次退出 `0`（373 项报告、371 通过、2 项已有跳过）；实际执行根脚本 24 项与 monorepo 34 项，其余十一 workspace 测试复用缓存。主会话另直接读取容器 baseline 和正式 probe 报告，核对真实 ready、模型、一次 prompt、独立 marker 结果，以及正式 probe 的 504、非 terminal、scratch sentinel 保留。没有重复模型请求来确认已有结果。

## 显式协调预算的实现候选

用户随后同意继续推进 Implementation 验收，本轮按此前提出的显式可配置预算方向实施；这不是 acceptInner。默认 subject 20000 ms 和默认外层 probe 30000 ms 均不变，默认外层下仍至多允许 24000 ms。显式 subject 上限沿用已有 helper 的 300000 ms，但必须满足 subject.timeoutMs + 6000 <= 实际外层 probe timeoutMs；重用旧本地 setup 的元数据格式校验与清理余量，SSH 原上限不变，已有更短 Agent deadline 仍生效。

Pilot manifest、共享 runner、local-only runtime 提取器和生成参考页已同步。提取器在删除远程分支时保留 else 中的本地期限校验，避免为本机快照误删保护；回归同时针对原 setup helper 与生成的 self-check runtime 验证默认值、恰好 6000 ms 余量、少 1 ms、上限 300 秒和非法元数据。提交过的 Git 快照测试覆盖默认 probe 与显式 subject 60000 / probe 90000 两种完整 terminal，均只有一个 fixture prompt；这些是自动回归，不是真实模型证据。

定向十项测试全部通过，完整 pnpm check 退出 `0`（373 项报告，371 通过、2 项已有跳过）。setup 33 项、self-check package 1 项、monorepo 34 项和根脚本 24 项实际执行，其余九个 workspace 的测试复用缓存；格式、lint、类型、新鲜度、build 和 pack 通过。此时 I-S03、I-AC03 仍等待新精确源码的真实完整 probe，不因为预算候选已通过测试就提交实现验收。
