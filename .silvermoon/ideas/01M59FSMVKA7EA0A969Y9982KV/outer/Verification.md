# Pilot packages 现实消费验证

本文件记录真实受控隔离验证，不是 npm 发布、生产部署、真实模型/账户或外部设备整备。
实施由父会话以 `acceptInner#5` 接受，准确树为
`96daad9564d6669bb2e44e1860a4276df0f2358d`；本会话未自行 accept 或豁免。

## 来源与消费环境

首次验证固定源码 `6c75d927aaefe361cb85746c055cb1a01114ad1c`。
随后 primary 的 `7f1487ad93741f9fafd8c73560d2acf6b871101a` 改进 self-check 的 ACP
readiness/repair session 复用，本会话普通快进完整接收，未手工替换生成物。
setup/self-check 因此重新构建隔离镜像，重新执行六个正反例，不能把旧证据算作新源码验证。
monorepo、health 源码在这两个版本间没有变化，其证据保留各自实际 source commit。

镜像构建使用 [已提交的隔离构建器](../../../../scripts/self-check-docker/README.md)，
`git archive` 只提取固定 commit；最小 build context 不含宿主配置、环境、node_modules、
秘密或 Docker socket。Node 基础镜像固定为：

```text
node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
```

构建仅使用已有批准的 HTTPS registry `https://packagefeedproxy.microsoft.io/npm/`，
未切官方 registry、关闭 TLS 或传认证。生产 workspace 安装使用 frozen lock、
ignore-scripts；固定工具链从独立目录通过根 TypeScript references 构建现有公开包，
再真实 pack、仅入口安装并检查传递版本闭包。没有发布任何包，也不安装替代的已发布 pguide。

运行容器是本次唯一名称，非 root `node` 用户、network none、cap-drop ALL、
no-new-privileges、2 CPU、1 GiB 内存、128 PID、无 mounts。运行镜像只有打包安装的消费端、
独立提交的 Pilot 仓库和受控 fixture，不包含源码构建依赖或宿主工作树。
完整来源/工具链/安装锁 hash 见 [首次来源](./verification/consumer-provenance.json)、
[当前来源](./verification/current-consumer-provenance.json)；
具体限制见 [首次隔离记录](./verification/consumer-isolation.json)、
[当前隔离记录](./verification/current-consumer-isolation.json)。

## Monorepo：真实 dispatcher / Git snapshot

不是测试中的 fixtureSpec resolver：

1. [宿主真实 CLI 验证](./verification/monorepo-git.json) 调用真实 `pguide probe`，
   固定源 commit，由现有 Git loader 创建不带 node_modules、不 install/build 的 snapshot。
2. [容器内安装消费端验证](./verification/monorepo-installed.json) 使用
   `/opt/consumer/node_modules/.bin/pguide`，目标和 Pilot 来源均与开发工作树隔离。
   Pilot 由准确源码 `git archive` 构造独立 Git 仓库，实际版本另行记录；
   复现脚本为 [monorepo-installed.mjs](./verification/monorepo-installed.mjs)。

两者均有五个成功验证场景：正常目标 terminal、缺失导入停 structured、
修复后 terminal、无效 contract 停 initial、修复后 terminal。
subject 不提供 `checkerModule`；目标 build script 是 `MUST_NOT_EXECUTE`，
未安装目标依赖、未执行目标代码。standalone runtime 与 manifest/References 来自相同
固定源码。临时目标最终删除，报告中明确 `cleaned:true`。

## Setup / self-check：真实受控修复及反例

当前固定源版本 `7f1487ad93741f9fafd8c73560d2acf6b871101a`，构建后的独立 Pilot 仓库
版本 `a90a62c9363b70993188f7deb5f23eaf0d2deeff`，安装的 pguide 为 `0.4.0-rc.0`。
来源 commit 与运行时 Objective commit 不混同。实际安装锁、源码 archive 和 harness
hash 均见每项 verification.json 与 provenance。

每次通过真实已安装 pguide dispatcher 加载提交的 Git 子目录，完成 installation、
configuration、ACP readiness 和适用 sanity。受控 ACP fixture 不使用真实模型或认证，
但真实发送协议、真实修改独占 marker 并由独立检查读取内容，不相信 fixture 摘要。

| Pilot | fixture 模式 | 实际结果 | prompt/清理 |
| --- | --- | --- | --- |
| self-check | fix | terminal，无 problems | 1 次，独占 scratch 清除，keep.txt 保留 |
| self-check | wrong | configured，sanity-failed | 1 次，同上 |
| self-check | summary-only | configured，sanity-failed | 1 次，同上 |
| setup | fix | terminal，无 problems | 1 次，独占 scratch 清除，keep.txt 保留 |
| setup | wrong | configured，sanity-failed | 1 次，同上 |
| setup | summary-only | configured，sanity-failed | 1 次，同上 |

六项当前原始报告及安全 prompt count 见 [current-setup-self-runs](./verification/current-setup-self-runs)；
首次 `6c75d927` 的六项结果保留在 [setup-self-runs](./verification/setup-self-runs)，
仅作为该准确旧版本的成功记录，不代替重跑。setup fixture 的 allowSanity 只为本次
无费用受控测试显式设 true；self-check 不提供 allowSanity/target，未放松产品边界。

### gitignore 不止验证“文件存在”

[fixture-behavior.mjs](./verification/fixture-behavior.mjs) 在隔离容器调用真实
`sanity` 准备逻辑，且不发送模型 prompt。实际复制 runtime fixture、生成 `.gitignore`、
初始化/提交 Git 后：

- 对 marker.txt 和 `.cache/owned-cache.txt` 执行真实 `git check-ignore`，两项均被忽略；
  cache 写入后的 `git status --porcelain --untracked-files=all` 仍为空。
- 调用实际 marker run.cjs：错误 marker 失败，正确 nonce 成功；故意改普通
  gitignore 模板内容后仍成功，检查只根据 subject 中 marker 精确内容，不把模板当业务目标。
- 此测试的自有 scratch 在 finally 删除。六项完整 probe 另行验证产品本身的 scratch
  清理与无关 keep.txt 保留，未用测试自己的 finally 冒充产品清理。

结果见 [fixture-behavior.json](./verification/fixture-behavior.json)。

## Health：真实 Linux Docker 及四栈能力

执行 [既有验证器](../../../../scripts/verify-development-health.mjs)，固定
`6c75d927aaefe361cb85746c055cb1a01114ad1c` 的真实 Git Pilot；
实际 API observe 和 pguide CLI parity 都经 process probes，不用测试 resolver。
完整 [health-docker.json](./verification/health-docker.json) 记录 **33/33 场景通过**、
镜像/TypeScript 完整版本与完整性、场景前后观察、`passed:true`、`cleaned:true`。

覆盖五层 terminal 与 TypeScript/Python/C++/Rust 实际编译/运行，缺少四栈工具、
编译器存在但不可执行、身份/环境/sudo/目录权限、容量/inode、网络、package database、
版本、layout/task registry、过期/孤儿任务及进程遗留、历史/增长率/package index/update，
并覆盖修复后恢复、健康后回归、活跃工作与未提交数据保护、Docker 失败不回落本机。
只修改本次创建的受控容器；验证器逐个删除自有容器、镜像和 scratch，未触及宿主设备。

## 限制与检查结论

上述结果证明声明的私有 package / Git snapshot 受控消费方式，不证明真实模型、
SSH 远程身份/认证、原生 Linux/WSL、生产健康、npm 发布或永久可靠性。
Docker 构建的 apt/npm 解析不完全 hermetic：固定基础镜像和记录锁/hash，
但不宣称不同时间字节相同。没有费用、生产部署或外部真实设备变更。

实施阶段 Windows 的六个 nested sanity 失败仍以持久基线/当前原始结果说明，
不能用本次 Linux 通过倒推 Windows 全绿；并发 self-check 优化后的最终仓库检查结果
见 [final-validation.json](./verification/final-validation.json) 和
[final-windows-setup.log](./verification/final-windows-setup.log)：

- 再次实际运行 `pnpm check`，exit 1。format、lint、typecheck 通过，setup 为
  **33 项中 27 通过、6 失败**；新增 session 复用测试保留且通过，未机械沿用原来的
  32/26 数量。六项名称与已接受实施的 fresh 基线逐一匹配。
- 四项期望业务/成功结果的 sanity 用例仍在 independent sanity probe 返回 502、
  期望 200；诊断项仍提前失败而未到预期 regulation 诊断；
  timeout 项仍为 502 而非 504。脚本逐项核验原始错误，不只比较失败数量。
- 单独补跑 `pnpm pack:check`：8 个公开包通过；
  `node --test scripts/*.test.mjs`：16/16 通过，含 4 个私有 Pilot 真正打包、
  无依赖安装解包消费和完整 SSH payload 测试。
- 本阶段未改动产品源码、实现契约或已接受的理想/实现树。只普通接收其他会话的
  上游源码进展并按准确版本补验，没有把生成链绕行或本地 fixture 当成真实账户证明。

机器可复核入口为 [validate-evidence.mjs](./verification/validate-evidence.mjs)，
重新读取持久报告并验证 10 个 monorepo 观察、12 个两版本 setup/self-check 完整 probe、
33 个 health 场景、ignore 实际行为和清理；复核不产生模型调用或启动容器。

## 清理与历史资源保护

health 验证器已确认其所有自有容器/镜像/scratch 清理成功。
本次两组消费容器 `pguide-pilot-migration-6c75d927-3b5eadc7`、
`pguide-pilot-migration-7f1487a-3b5eadc7` 均在结果导出并复核后停止、删除，
对应唯一 image tag 已删除。没有操作父会话保留的 811/7dd 历史容器或其他用户资源。
两份最小 build context 和 monorepo archive 只按本次确切名称清理；
先检查为普通文件/目录，再逐文件删除，没有递归跟随 junction。
证据中的 scratch/keep.txt 是导出的无关数据保留证明，不是仍在运行的测试服务。
