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
