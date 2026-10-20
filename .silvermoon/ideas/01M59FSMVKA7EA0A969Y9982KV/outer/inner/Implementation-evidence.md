# Pilot package 迁移实施证据

本文件属于本阶段实施证据，不是验收决定，也不代表外部验证已完成。
最终候选源码版本以包含本文件的 primary commit 及对应 submitInner 为准。
已接受的理想树保持 `1a31e4faf930bfcc5360c8e9e2af53d9f5219f67`。

## 入口审查索引

| 范围 | 源码与接线 |
| --- | --- |
| 长期契约及历史 URI | [架构与消费规范](../../../../../docs/pilot-packages.md)、[真实仓库需求](../../../../../config/monorepo-requirements.json) |
| monorepo | [package](../../../../../packages/monorepo-objective/package.json)、[协议入口](../../../../../packages/monorepo-objective/check.mjs)、[structure](../../../../../packages/monorepo-objective/src/structure.ts)、[package rules](../../../../../packages/monorepo-objective/src/packages.ts)、[delivery](../../../../../packages/monorepo-objective/src/delivery.ts)、[task graph](../../../../../packages/monorepo-objective/src/task-graph.ts) |
| monorepo 事实与独立能力 | [事实读取](../../../../../packages/monorepo-objective/src/repository-observation.ts)、[配置规则](../../../../../packages/monorepo-objective/src/repository-configuration.ts)、[layout](../../../../../packages/monorepo-objective/src/workspace-layout.ts)、[placement/classification](../../../../../packages/monorepo-objective/src/file-placement.ts)、[browser](../../../../../packages/monorepo-objective/src/delivery-browser.ts)、[Worker](../../../../../packages/monorepo-objective/src/delivery-worker.ts)、[bindings/variables](../../../../../packages/monorepo-objective/src/delivery-worker-bindings.ts)、[service](../../../../../packages/monorepo-objective/src/delivery-services.ts)、[identity](../../../../../packages/monorepo-objective/src/delivery-identity.ts)、[migration](../../../../../packages/monorepo-objective/src/delivery-migrations.ts)、[source fact](../../../../../packages/monorepo-objective/src/source-observation.ts)、[独立能力测试](../../../../../packages/monorepo-objective/test/capabilities.test.ts) |
| setup | [package](../../../../../packages/pguide-setup-pilot/package.json)、[runner](../../../../../packages/pguide-setup-pilot/src/runner.mjs)、[installation](../../../../../packages/pguide-setup-pilot/src/installation.mjs)、[configuration](../../../../../packages/pguide-setup-pilot/src/configuration.mjs)、[sanity](../../../../../packages/pguide-setup-pilot/src/sanity.mjs)、[SSH](../../../../../packages/pguide-setup-pilot/ssh-target.mjs)、[内嵌 fixture](../../../../../packages/pguide-setup-pilot/sanity-fixture/pilot.yaml) |
| self-check | [package](../../../../../packages/pguide-self-check-pilot/package.json)、[入口](../../../../../packages/pguide-self-check-pilot/self-check.mjs)、[共享源码生成器](../../../../../scripts/build-self-check-runtime.mjs) |
| health | [package](../../../../../packages/development-machine-health-pilot/package.json)、[runner](../../../../../packages/development-machine-health-pilot/src/runner.mjs)、[独立职责模块](../../../../../packages/development-machine-health-pilot/src)、[Docker runtime 生成器](../../../../../scripts/build-health-runtime.mjs) |
| 同版本生成资源 | [monorepo bundle + licenses](../../../../../scripts/build-monorepo-runtime.mjs)、[setup SSH bundle](../../../../../scripts/build-setup-runtime.mjs)、[Turbo 接线](../../../../../turbo.json) |
| 迁移回归与打包 | [monorepo](../../../../../packages/monorepo-objective/test/pilot.test.mjs)、[setup/self-check 集成](../../../../../packages/pguide-setup-pilot/test/setup-objective.test.ts)、[health](../../../../../packages/development-machine-health-pilot/test/development-health-objective.test.ts)、[真实 tarball 测试](../../../../../scripts/pilot-packages.test.mjs) |
| 后续真实消费验证工具（尚非结果） | [monorepo Git CLI](../../../../../scripts/verify-monorepo-pilot.mjs)、[无凭据 setup/self-check 容器](../../../../../scripts/self-check-docker/README.md)、[health 容器](../../../../../scripts/verify-development-health.mjs) |

## 已验证的结构与交付边界

实施开始时正式清单仍为四个 Pilot；内嵌 sanity-fixture 不单独建包。
monorepo 保留原 workspace 身份，其余各有独立私有 workspace；旧 objectives 主体删除，
不保留第二套规则。原检查 ID、problem ID、检查先后、预算、秘密、目标及清理边界不变。

monorepo 不再执行 subject 指定的任意 checker；正常输入只需 root/contract。
旧 checkerModule 仅接受当前 package 自身的 dist/index.js 路径，并且不会加载该路径。
约 3.85 MB 的提交版 standalone bundle 包含锁定依赖，并附保留的第三方许可。
此资源是现有 Git loader 无 install/build 的交付要求，不是新增 npm loader 或发布。

setup SSH 传输单文件 helper、薄入口和原 fixture 共 11 个文件，不含控制机配置或认证。
self-check 运行时由既有 ACP/权限/direct-agent 与 setup 模块源码生成；本机版本通过
TypeScript AST 明确移除两个 SSH 分派分支，并校验提取契约，保留 local-only 校验。
health 五个 stage 独立执行，Docker 单文件 runtime 从这些实际模块生成。

`scripts/pilot-packages.test.mjs` 对四个私有 package 实际 pnpm pack、解包到系统临时目录，
不安装任何依赖；逐一严格加载 manifest/References、调用真实 run.cjs 检查协议，
验证无效输入、适用的安装/结构正例及 fixture/bundle 的打包可达性。
这证明打包资源完整，不把 Windows 上 health 的平台前提拒绝记成健康终态。

## 整合前的历史检查与基线

整合并发上游修复之前，`pnpm check` 已实际运行，format、lint、typecheck 通过，
test 阶段失败。此处仅记录当时结果，不把它沿用为新 primary 的基线结论。
默认 Turbo 在失败后中断剩余并行任务，另外补跑其他 suites、根 scripts 测试和 pack:check：
其余 11 个 workspace 共 303 通过、1 个既有平台 skip（real-path case sensitivity），
根 scripts 16/16 通过，8 个公开包 pack:check 通过；4 个私有 Pilot 的实际打包测试亦通过。

四个 Pilot 定向回归中，monorepo 26/26、health 15/15、self-check 本包 1/1 通过。
setup 新包的源码快照最初误拷开发 node_modules，已修复为明确排除开发目录；
完整 setup 与 self-check 的 Git snapshot 正例随后通过。SSH golden 文件数已按实际
单文件 runtime 更新，不跳过检查。整合前完整 pnpm check 的 setup 结果为 32 项中
26 通过、6 失败。

不是沿用旧结论：从 **811f28d802028b8c5a82337a47f9b111d83cedb6** 的原始源码
用 git archive 提取不带 Git 的短路径基线，在同设备、同 Node/pnpm、未修改的基础包
构建产物与现有依赖下，重新运行以下六个原始测试，实际结果为 **0 通过、6 失败**。
它们与迁移后的失败测试名称及可观察失败路径对应：

| 原始与当前共同失败用例 | 当前可观察结果 |
| --- | --- |
| remote payload uses target authentication and performs actual nonce sanity, not control evidence | 独立 sanity probe 502，而非预期 200 |
| real sanity rejects noop Agent completion | 独立 sanity probe 502，未进入预期业务失败路径 |
| real sanity rejects wrong Agent completion | 独立 sanity probe 502，未进入预期业务失败路径 |
| real sanity verifies a finite repair | 独立 sanity probe 502，而非预期 200 |
| sanity invocation diagnostics expose fixed classifications, not arbitrary CLI error data | 提前在独立 probe 失败，未到预期 regulate 诊断断言 |
| sanity timeout during an actual ACP prompt cleans isolated config, state and descendants | 独立 sanity probe 502，而非预期 prompt timeout 504 |

基线命令使用相同 Node/tsx runner 和以下 name pattern：

```text
remote payload uses|real sanity|sanity invocation diagnostics|sanity timeout during
```

原始源码短路径 TAP 结果见 [baseline-setup.tap](./verification/baseline-setup.tap)。
最初在长 session 路径下的基线另有更早的 JSON 输出错误，不作为等价回归证据。
没有扩大范围修复既有 Windows nested-probe 故障，也没有豁免、跳过测试或把失败写成通过；
后续 Linux 无凭据隔离消费验证仍须真实执行，不能用这些失败或单元测试代替。

## 并发上游修复整合

在同步候选前刷新 primary，发现其已前进到
`345027e47f4b530e66539bae822b51b2728e3427`，包含 `6d3d635`、`9289935`、
`345027e` 的 Windows owned-process snapshot 修复。通过普通 merge 保留双方历史：

- cli-core 的 native Toolhelp snapshot、可信模块显式加载、测试与文档原样整合。
- 上游 setup 的固定 lifecycle phase/nativeCode 诊断完整移入本 package 的 sanity 模块，
  保留本次打包必须的 gitignore template materialization。
- 上游 setup 测试合并到其新 package；self-check 和 setup 的运行资源均从整合后源码重新生成。
- 仅删除已被新 package 接管的两个旧路径冲突副本，没有撤销上游修复或重复维护主体。

整合提交为 `5ff1c5105681379d910703a6d66ec66d5b336e7a`。整合后的完整
`pnpm check` 重新运行后仍在相同六个 setup 用例失败。再次从准确
`345027e47f4b530e66539bae822b51b2728e3427` 原始源码提取短路径基线，串行独立重跑
同六项，得到 **0 通过、6 失败**，约 59 秒；五项仍在独立 sanity probe 返回 502，
诊断项提前失败，timeout 项仍为 502 而非 504。
原始新 primary TAP 见 [baseline-345027e-setup.tap](./verification/baseline-345027e-setup.tap)。
这不是推断 native 修复已经恢复所有路径，也不是沿用 811 的历史结论。

整合后的其余 11 个 workspace 再次全通过（pguide 57 通过、1 个既有平台 skip）；
根 scripts 16/16 和 8 个公开包 pack:check 再次通过。scope 内未新增跳过或豁免。

## 门禁前架构审查处理

父会话指出初版 structure/packages/delivery 仍可能只是大函数搬文件。已进一步拆为
实际可单独调用和测试的职责，不以 index 变薄或行数阈值作为验收代理：

- `observeRepository` 读取/解析事实，保留显式失败及部分观察，领域配置规则单独消费事实；
  必需文件、workspace mapping/layout、delivery mapping、assignment/classification 分开。
- package 编排仅委派依赖规则/环、任务、发布内容、CLI、source boundary；
  `observeSourceImports` 产生 AST 事实，`checkSourceImport` 可独立评估单个导入。
- delivery 编排分别调用 browser、Worker metadata、variables/bindings、service environment、
  identity supply、migration mapping、resource boundary、entry graph 和 output 规则。
  两个公开 check ID 保持不变，没有先执行完整检查再过滤 findings。
- 新增 8 项直接调用能力的测试，证明事实可重复消费而不触发 layout/tasks，
  layout 不依赖完整仓库配置、placement 保留碰撞证据，browser 不执行 Worker/service，
  service/identity/migration 分别调用，单个导入不评估同文件其他导入。
  提取引入的 output 参数 shadowing 被既有 browser/Worker 正例捕获，已修正并新增
  独立 output coverage 回归。此后 **34/34 monorepo 测试通过，typecheck 通过**。

setup 必需的 `.gitignore` 曾被真实 pnpm pack 丢弃，已改成可打包的普通 `gitignore`
资源，仅在独占 sanity fixture 中恢复 `.gitignore`；实际 tarball SSH payload 验证
11 个文件及模板内容可达，没有以源码工作树存在该文件冒充交付验证。

## 最终门禁检查

环境为 Windows x64、Node v24.11.1、pnpm 11.22.0。能力细分及生成资源完成后重新运行：

| 命令/范围 | 实际结果 |
| --- | --- |
| `pnpm check` | exit 1：format、lint、typecheck 通过；test 仅上述 6 个 current-primary setup 用例失败，未到该命令的 pack 阶段 |
| monorepo 全部测试 | 34/34 通过，含 8 个直接调用独立能力的新增测试和全部既有场景 |
| setup 全部测试 | 32 项，26 通过、6 个当前 primary 原始源码同名同路径失败；没有新增 skip |
| 其余 workspace | 全部通过；pguide 57 通过、1 个既有 platform case-sensitivity skip |
| `node --test scripts/*.test.mjs` | 16/16 通过，含四个私有 Pilot 实际 tarball 消费与 SSH payload |
| `pnpm pack:check` 单独补跑 | exit 0，12 个 workspace 构建成功、8 个公开包打包内容通过 |

结构化结果见 [validation-summary.json](./verification/validation-summary.json)，其中由工具
逐名比较当前失败与 fresh `345027e` 原始基线，强制相同六项且其他 workspace 无失败；
当前完整 setup 输出见 [current-setup.log](./verification/current-setup.log)。
TAP/日志已按原始输出转为 UTF-8，便于审查，不改变测试结果。

实施 ledger 的勾选记录已完成迁移、回归、基线分离与证据整理，不声称 pnpm check 全绿，
不代表父会话接受或豁免任何失败。现实消费验证的所有条目仍未勾选，须等 acceptInner。

同步前又普通整合了 primary `99a9be928e1b4dc6aefc9928fe2201b0394b9a2e` 的文档与其他
IDEA 事件进展；没有产品源码变化。其原 setup 源码 blob 仍为
`32ba67b31b4ec5a9bfa1d0426b4850dbda573c63`，Windows process-tree 源码 blob 仍为
`b118d1731633bd9187037d29350552e28538135c`，与 fresh `345027e` 基线逐一相同。
保留上游已留存容器的事实和证据索引，新迁移示例改用唯一新名称，不复用或改动他人容器。

依赖安装使用现有代理和 TLS。常规 pnpm install 因代理元数据缺少已锁定
turbo@^2.11.8 而失败；仅加入 workspace links 与已存在锁版本 esbuild@0.28.2，
经 pnpm install --frozen-lockfile --offline 验证并恢复，无第三方版本升级、
registry 切换、TLS 绕过或全局设备修改。
