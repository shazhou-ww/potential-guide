# 按交付需求检查 pnpm monorepo

这是可复用的 Pilot Objective，不是本仓库专用评分脚本，也不增加一个 `pguide`
子命令。检查器位于私有开发工具 workspace，不进入现有 npm 发布列表。
先在**检查器可信 checkout** 中使用 Node ≥22.13、pnpm ≥11.22：

```powershell
pnpm install --frozen-lockfile
pnpm --filter @potential-guide/monorepo-objective build
```

目标仓库无需安装依赖。建立仅含非秘密路径的 subject：

```json
{
  "root": "D:\\target",
  "contract": "requirements.json",
  "checkerModule": "D:\\checker\\packages\\monorepo-objective\\dist\\index.js"
}
```

独立观察入口（`check.mjs` 及 subject 路径属于检查器机器）：

```powershell
node objectives\pnpm-monorepo\check.mjs structure --subject-file D:\subject.json
node objectives\pnpm-monorepo\check.mjs deliveries --subject-file D:\subject.json
```

使用已有的 pguide/probe 基础设施，无需 Agent 或付费连接：

```powershell
pguide probe --pilot D:\checker\objectives\pnpm-monorepo\pilot.yaml --subject-file D:\subject.json --format json
```

必须使用已构建的准确检查器 checkout。`checkerModule` 是控制机上明确受信任的
检查器入口，**不是目标仓库提供的路径**：wrapper 会执行此模块，不要接受不可信 subject
替换它。Git probe 的临时源码 checkout 不安装依赖或构建，故由此显式路径连接已构建、
同一准确 revision 的检查器。CLI 的本地 Pilot 入口也要求已提交且干净的 Git checkout；
测试使用的虚构 Git 版本只属于集成 fixture，不是实际交付来源证据。
进程 probe 通过 stdin 接收 subject 并返回既有 `Envelope<CheckResult>`。业务失败仍为
`status:200`、`payload.ok:false`；调用失败为 `422/null`，不会伪造成通过。
完整报告在 `message` 的 JSON 和失败 problem 的 `parameters.report` 中。
`structure-incomplete` 与 `delivery-incomplete` 是稳定 problem ID；
细项的稳定规则 ID 在 `findings[].rule`。

## 需求契约

契约是维护者确认的交付需求，不从现有源码自动推断意图。
[本仓库示例](./examples/repository.json)声明两个多包交付物，展示多对多关联，
不是强制每个 package 独立发布。可直接用其相对路径检查本仓库。
严格 JSON schema 可从构建的 `@potential-guide/monorepo-objective` 导出
`contractSchema`，或用 `parseContract(unknown)` 验证；未知字段、未知版本和悬空引用
不能被当作默认成功。所有契约内路径使用仓库相对 POSIX 表示（`/`），不能含 `..`；
这与命令行的 Windows 路径不同。

最小内部共享包示例（先建立所列文件）：

```json
{
  "schemaVersion": 1,
  "policy": {
    "source": "pnpm-default-v1",
    "directories": { "apps": "apps", "packages": "packages", "docs": "docs", "scripts": "scripts" },
    "requiredFiles": [],
    "exceptions": [],
    "assignments": [],
    "allowedDirectories": [],
    "dependencyExceptions": []
  },
  "workspaces": [{
    "name": "shared",
    "path": "packages/shared",
    "roles": ["internal"],
    "runtime": "universal",
    "allows": [],
    "entries": ["src/index.ts"],
    "sources": ["src/index.ts"],
    "tasks": ["build", "test", "typecheck"]
  }],
  "deliveries": []
}
```

每个 workspace 有角色、运行时、公开入口、需存在的源码引用、允许依赖的内部包和
必需任务。`allows` 不区分依赖种类的方向；观察证据保留 dependencies、
optionalDependencies、peerDependencies 与 devDependencies 的种类。内部依赖使用
`workspace:`，第三方版本来自根 pnpm catalog。`universal` 表示明确的跨运行时共享意图，
并非对代码兼容性的认证；工具包的 `tool` runtime 不会被当成浏览器兼容。

`deliveries[]` 的字段：

| 字段 | 含义 |
| --- | --- |
| `id`, `purpose`, `kind` | 稳定需求身份、用途、交付类型。支持 `npm`、`cli`、`browser`、`cloudflare-worker`；其他服务返回未验证。 |
| `packages`, `entry` | 全部关联包及入口 `{package,path}`。包含运行/peer 支撑包闭包，允许同一包支撑多个需求。 |
| `runtime` | `node`、`browser`、`worker`、`universal` 或 `tool`；多运行时合包可声明 universal，并分别声明不同交付入口。 |
| `environment`, `config`, `output` | 浏览器/Worker 所需的环境名、仓库相对配置路径及产物目录。 |
| `resources` | 仅名称引用：`{name,kind,visibility,supply,environment}`。kind 为 configuration/secret/resource/identity；visibility 为 public/server；supply 为 build/runtime/platform。绝不放值。 |
| `services` | 相关内部服务包名，或相同环境的 resource 名称引用（外部 API）；不执行网络请求。 |
| `capabilities` | 按需 `oidc`、`migrations`；未知能力未验证。OIDC 只查身份供应引用，不查线上登录。 |
| `migration` | 仅当需要迁移时声明 `{package,entry,resource}`，关联包入口与资源名称；不靠文件名猜测执行命令。 |
| `independent` | 是否要求独立交付；没有此约束不强制所有包单独构建/部署。独立执行仍需外部证据。 |

## 两层顺序与目录职责

第一层必须没有 fail 或 unverified 才进入第二层；只观察结构时返回
`layer2:not-requested`。关键映射无效不能从已有源码补成需求。

默认规则来源 `pnpm-default-v1`：应用位于 apps，共享/开发工具位于 packages，
项目文档位于 docs、项目脚本位于 scripts；包级文档、脚本、迁移按 owner
归入该包的 docs/scripts/migrations。CLI 可作为可复用 npm 包位于 packages。
项目可以覆盖四个目录名，以 `exceptions:{path,reason}` 解释固定位置例外，
以 `allowedDirectories:{path,reason}` 声明其他顶层目录职责。
例外只豁免位置，不豁免 schema、依赖或交付规则。

`assignments` 为已确认用途的文件声明 `{path,purpose,owner?,targetDirectory?,reason}`；
purpose 为 project-doc/package-doc/script/migration/generated/tool/unknown。
跨服务迁移用显式 targetDirectory 表达项目协调归属，不强制根目录。
已确认错放报告当前路径、规则依据、建议目录、维护引用提示，以及同名目标冲突。
生成物或工具固定位置必须有理由；没有职责依据的散落文件是**待分类**，
而不是违规移动/删除指令。只按文件名、后缀或 Git 跟踪状态判断归属是不允许的。
目录内未知用途同样可用 unknown assignment 显式阻止误判；未声明的包内内容暂按包职责
容纳，不能把这种容纳当成已识别每个文件的具体业务用途。

支持的全局配置是根 package.json（npm 可扩展元数据中的身份、依赖、scripts、
files、engines、bin 类型）、pnpm-workspace.yaml（packages、catalog(s) 类型与已知
pnpm 配置字段）以及 Turbo 的 tasks/dependsOn/outputs/inputs/env/cache/persistent
子集。YAML 重复 key、无效类型、未知 Turbo 字段明确阻止验证；
其他工具文件目前只按显式 requiredFiles 检查存在性，**不声称验证其完整 schema**。
pnpm pattern 支持 literal、`*`、`**` 与排除 `!`；更复杂 pattern 为未验证，
不猜测 pnpm 的匹配结果。

## 类型细化与证据

依赖例外为 `{from,to,reason,allowCycle?}`；默认只允许特定依赖方向，不隐藏循环。
确有允许循环的明确依据时，`allowCycle:true` 仅排除该边的依赖循环诊断，不豁免
任务图循环、运行时或公开入口规则。已知 Wrangler 配置没有需求映射时标为待分类，
需要显式的工具/样例归属例外，而不是猜测成真实部署或默默遗漏。
导入观察使用 TypeScript 语法树，不把注释/普通字符串当成依赖，也不把 type-only
导入当作运行时代码。动态计算导入和工具专属 alias 仍属于未验证边界。

- npm：公开身份、exports、types、files allowlist、内部依赖可发布性和既有入口产物。
  实际 tarball/consumer 未运行，仅记入范围外 limitations；仍不以 scripts 存在代替必需产物。
- CLI：bin、Node engine 声明、shebang、npm 打包入口；多角色叠加，不互相替代。
  命令与扩展发现未执行，仅在 limitations 说明，不扩大为必需在线或执行门禁。
- Browser：部署引用 JSON `{entry,environment,outputDirectory}` 与需求相符，
  构建输出与 Turbo 一致，配置公开性、秘密边界和 API 引用成立。
  这是**显式引用适配器**，不是对任意前端平台配置或真实 bundle 的认证。
- Cloudflare：严格 JSON Wrangler 配置的 name/main/compatibility_date、目标 env、
  普通 vars 名称与环境局部 bindings；不支持 JSONC/TOML 时明确未验证。
  配置只含普通值与供应引用，绝不提供生产秘密。远端资源存在、secret 供应、
  认证与 Worker 健康均不在静态证据内。
- Internal/tool：private、入口与消费者依赖关系；不要求 public 发布配置。
- 通用：内部依赖方向、循环（包括 peer/dev 边）、静态跨包入口绕过、运行时明显违规、
  必需 scripts、任务引用/循环、build 的依赖前置与输出。

静态导入扫描覆盖包内非 test/tests/__tests__/dist 的 JS/TS。无法解析的实际导入
（包括不支持的动态计算或 alias）、不支持的目标适配器、缺少必需配置/产物仍返回
阻断性 `unverified`。合法 Worker Node 兼容模式需要受支持的专项适配，不直接按浏览器规则误判。
第三方传递依赖执行、引擎范围交集的执行证明、真实 bundle 运行与远端可用性不属于此
配置准备 Objective；未做事项放入 `limitations`，不制造无限阻断。内部包及各交付类型
均能在范围内配置/静态证据成立时返回 pass，Pilot 可到 terminal。
没有“导入一份自称通过的报告”绕过机制，也不通过 waiver 隐藏真正的范围内缺口。

四态 `pass/fail/unverified/not-applicable` 分别表示满足、不满足、未验证、不适用。
整体 fail 优先于 unverified，必需未验证阻止整体 pass。报告携带 layer、rule、
location、evidence、remedy、requirements、packages 和可用的 targetDirectory；
全局问题保持空包关联。`scope` 恒为 delivery-preparation，
`evidenceKind` 恒为 configuration-and-existing-files，`onlineVerified:false`；
`limitations` 明确列出范围外未执行事项，不参与 findings 的四态汇总。
因此配置通过并不声称 tarball 已消费、命令已运行、资源已供应或线上登录成功。
这是逐需求检查而非抽象架构评分。

## 只观察的执行边界

检查器无进程启动、安装、构建、打包、发布、部署、迁移、网络访问或目标写入。
只枚举文件名并读取有界元数据与源码；不读取 `.env*`、`.npmrc`、secret/credentials
文件、证书私钥，不解析环境变量或凭据存储。不跟随 symlink；输出不回显 JSON
解析原文。单文件上限 1 MiB，目标文件 inventory 上限 20,000；超出明确失败。
请只在可信且检查期间不并发改写的目标 checkout 上运行；不是恶意文件系统的安全沙箱。
外部构建/打包/消费验证须单独授权、隔离运行，并把证据持久化，不由此检查器执行。

测试：`pnpm --filter @potential-guide/monorepo-objective test`；
Pilot/probe 集成测试：`node --test scripts/monorepo-objective.test.mjs`（先 `pnpm build`）。
