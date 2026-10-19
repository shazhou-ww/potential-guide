# Pilot package 迁移实施证据

本文件属于本阶段实施证据，不是验收决定，也不代表外部验证已完成。
最终候选源码版本以包含本文件的 primary commit 及对应 submitInner 为准。
已接受的理想树保持 `1a31e4faf930bfcc5360c8e9e2af53d9f5219f67`。

## 入口审查索引

| 范围 | 源码与接线 |
| --- | --- |
| 长期契约及历史 URI | [架构与消费规范](../../../../../docs/pilot-packages.md)、[真实仓库需求](../../../../../config/monorepo-requirements.json) |
| monorepo | [package](../../../../../packages/monorepo-objective/package.json)、[协议入口](../../../../../packages/monorepo-objective/check.mjs)、[structure](../../../../../packages/monorepo-objective/src/structure.ts)、[package rules](../../../../../packages/monorepo-objective/src/packages.ts)、[delivery](../../../../../packages/monorepo-objective/src/delivery.ts)、[task graph](../../../../../packages/monorepo-objective/src/task-graph.ts) |
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

## 当前检查与基线

`pnpm check` 已实际运行，format、lint、typecheck 通过，test 阶段失败。
本次不能宣称仓库全绿；默认 Turbo 在失败后中断剩余并行任务，故另外补跑其他 suites、
根 scripts 测试和 pack:check，最终结果在本节后续记录。

四个 Pilot 定向回归中，monorepo 26/26、health 15/15、self-check 本包 1/1 通过。
setup 新包的源码快照最初误拷开发 node_modules，已修复为明确排除开发目录；
完整 setup 与 self-check 的 Git snapshot 正例随后通过。SSH golden 文件数已按实际
单文件 runtime 更新，不跳过检查。最终完整 pnpm check 的 setup 结果为 32 项中
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
是否接受该明确限制由父会话决定。后续 Linux 无凭据隔离消费验证仍须真实执行，
不能用这些失败或单元测试代替。

依赖安装使用现有代理和 TLS。常规 pnpm install 因代理元数据缺少已锁定
turbo@^2.11.8 而失败；仅加入 workspace links 与已存在锁版本 esbuild@0.28.2，
经 pnpm install --frozen-lockfile --offline 验证并恢复，无第三方版本升级、
registry 切换、TLS 绕过或全局设备修改。
