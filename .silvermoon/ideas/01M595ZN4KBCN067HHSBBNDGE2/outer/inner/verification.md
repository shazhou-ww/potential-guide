# 实施验证

## 范围与来源

- Idea：`01M595ZN4KBCN067HHSBBNDGE2`，alias `pnpm-monorepo-reasonableness`。
- 已验收 ideal：`1ac59ea394f4d349a36b693d8caf49ad1496a98c`，本次保持不变。
- 开始基线：primary `c10cb4958f7dd6412153c30468a8f4997663d2b2`。
- 实施期间普通 fast-forward 合入并发 primary
  `91f8dcfe990bf07a72127a7090c38cad48f5c595`；未重写历史或覆盖其他会话改动。
- 环境：Windows，Node `v24.11.1`，pnpm `11.22.0`。`nrm current` 为 microsoft。
  registry 解析及官方源 TLS 失败后，使用现有 catalog 的准确已锁版本，
  `pnpm install --frozen-lockfile --offline` 成功，不降低 TLS 或供应链策略。

## 交付入口

- [检查器](../../../../../packages/monorepo-objective/src/index.ts)、
  [需求 schema](../../../../../packages/monorepo-objective/src/contract.ts)、
  [语法树导入观察](../../../../../packages/monorepo-objective/src/imports.ts)。
- [Pilot manifest](../../../../../objectives/pnpm-monorepo/pilot.yaml)、
  [只观察 wrapper](../../../../../objectives/pnpm-monorepo/check.mjs)、
  [用户文档](../../../../../objectives/pnpm-monorepo/README.md)、
  [真实仓库需求示例](../../../../../objectives/pnpm-monorepo/examples/repository.json)。
- [正反例](../../../../../packages/monorepo-objective/test/checker.test.ts)、
  [导入语法测试](../../../../../packages/monorepo-objective/test/imports.test.ts)、
  [process probe 集成](../../../../../scripts/monorepo-objective.test.mjs)。

新 workspace 为 private 开发工具，使用已有 catalog 的 Ajv/YAML/TypeScript，
不增加公共 npm 发布目标、不引入 Silvermoon 项目依赖。root tsconfig 引用、workspace
lockfile、README 与 Objective References 同步接线。

## 门禁审查修正

父会话发现初版将范围外打包消费、命令执行、传递运行时执行和线上平台/身份验证无条件
作为阻断，导致所有有效目标永久未验证。已修正为：

- `scope:delivery-preparation`；`limitations` 独立列出未执行的范围外证明，
  不参与 findings 汇总；仍固定 `onlineVerified:false`。
- 内部包、纯 npm 库、npm+CLI、多角色合包、浏览器、Worker 与按需 OIDC/迁移准备
  的配置正例实际返回 `pass`，不需要线上执行或导入自声明证据。
- Pilot 对本仓库示例及隔离内部包均实际遍历 structure/deliveries 到 terminal。
- 实际无法解析的相对/计算/外部导入、必需 npm/CLI 产物缺失、未支持交付/配置格式仍
  为阻断性 `unverified`；配置违规为 fail；缺失相对导入的有效结构目标在 Pilot
  留在 structured，而非误到 terminal。

## 命令与结果

下列日志来自实际执行，不将测试中的虚构 Git fixture revision 当成真实交付来源。

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm --filter @potential-guide/monorepo-objective test` | 21/21 通过；覆盖全部类型真实 pass、失败、unsupported、缺失产物、归位冲突、合法例外、计算导入和只读边界 | [targeted.log](./verification/targeted.log) |
| `node --test scripts\monorepo-objective.test.mjs` | 4/4 通过；真实进程 probe、两层终态、第一层失败阻止后续、第二层缺失导入阻断及非法 subject 调用失败 | [pilot.log](./verification/pilot.log) |
| `pnpm typecheck` | 9/9 workspace tasks 通过，包含全仓库测试 TypeScript 检查 | [typecheck.log](./verification/typecheck.log) |
| `node --test scripts\*.test.mjs` | 18/18 通过 | [scripts.log](./verification/scripts.log) |
| `pnpm pack:check` | build 9/9；现有 8 个公共包实际打包检查通过；未发布包 | [pack.log](./verification/pack.log) |
| `pnpm format:check` | 通过 | [format.log](./verification/format.log) |
| `pnpm lint` | 通过；已有 warning 保留，未改写无关文件 | [lint.log](./verification/lint.log) |
| `pnpm check` | exit 1；17/18 Turbo tasks 成功，仅 pguide 的同一 6 项 setup/sanity 失败；并非全量通过 | [check.log](./verification/check.log) |

全量命令在 c10cb49 基线加本任务当时工作树上完成，pguide tests 耗时约 613 秒。
随后同步并发 primary、修正本 Objective 范围并执行表中的定向、类型/构建、根脚本、
打包与静态检查。第二次重复全量在父会话要求不重复后已停止，不作验证结果或成功证据。
父会话明确允许保留独立复现的先存限制提交候选，不要求本任务修改 setup；
这不是 acceptInner，本 subsession 不自行批准或 waiver。

## 先存失败与差异

父会话在未含本实施改动的干净
`c10cb4958f7dd6412153c30468a8f4997663d2b2` 独立运行：

```powershell
pnpm --filter pguide exec tsx --test --test-concurrency=1 --test-name-pattern="real sanity verifies a finite repair" test\setup-objective.test.ts
```

约 14 秒后 exit 1，`protocol: independent sanity probe failed`，
actual `502`、expected `200`。原日志来自父会话
`ef1777be-5e9e-4c7d-964f-34682a09da89`，
为便于仓库内审查将 UTF-16 文本转为 UTF-8 保存到 [baseline.log](./verification/baseline.log)；
不是本 subsession 再次运行所得。

本次全量恰好以下同 6 项失败：

1. remote payload uses target authentication and performs actual nonce sanity, not control evidence
2. real sanity rejects noop Agent completion
3. real sanity rejects wrong Agent completion
4. real sanity verifies a finite repair
5. sanity timeout during an actual ACP prompt cleans isolated config, state and descendants
6. Git subdirectory snapshot runs dependency-free checks and existing file-auth ACP to terminal

前四项为相同独立 probe `502` 对 `200`；timeout 项为 `502` 对 `504`；
Git 子目录项输出相同 probe 错误，CLI exit `6` 对 `0`。本任务没有编辑
`packages/pguide`、`objectives/pguide-setup` 或这些测试；新工具无被测模块的依赖边。
原 15/16 加新工具的 build/test 后为 17/18，没有增加失败 task；
根脚本与打包因 check 的短路独立补跑并通过。原模块的六项失败仍交父会话决定门禁。

## 本仓库观察与安全边界

[完整报告](./verification/repository-report.json)：结构已确认，第二层已检查，
93 项 finding，无 fail/unverified，整体 pass；有独立 limitations，
`onlineVerified:false`。该 pass 只表示明确交付需求的配置/既有文件准备，不声称
npm 已发布、CLI 已执行、外部 API 在线、OIDC 登录或 Cloudflare 资源已供应。

检查器无子进程、网络和目标写操作；测试对目标文件树做摘要前后比对，未改变内容。
秘密值文件被路径边界拒绝，side-effect canary 不出现在报告；wrangler 配置只使用
非秘密 fixture 值及名称引用。wrapper 只导入控制机显式可信的 checkerModule，不执行
目标 scripts。没有执行真实发布、部署、数据迁移、生产秘密访问或付费资源操作。

独立 checkout 与隔离浏览器/Worker 的外部修复闭环尚属 Deployment；
等待父会话对准确 implementationRevision 的审查批准后再继续，不以这些实施测试替代。
