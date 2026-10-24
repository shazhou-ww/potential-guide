# npm Objective 包与固定消费

一个 Objective 对应一个独立 npm 包。身份直接取实际 `package.json.name`；
npm alias、CLI 注册简称、版本和来源地址都不是第二个 Objective 身份。
定义只保留包根 `objective.yaml`，不内联到 package.json，不重复写 Objective 名。
References、自包含 worker、Wasm 和资源随包交付。

## 六个内置包

| 包 | check |
| --- | --- |
| `@potential-guide/objective-monorepo-standard` | structure、deliveries |
| `@potential-guide/objective-package-standard` | structure、deliveries |
| `@potential-guide/objective-devbox-health` | identity、system、toolchains、order、sustainability |
| `@potential-guide/objective-pguide-setup` | installation、configuration、sanity |
| `@potential-guide/objective-pguide-self-check` | installation、configuration、sanity |
| `@potential-guide/objective-setup-marker` | marker |

原来的嵌套 package-standard 和 setup marker 已拆开。setup 与 monorepo 根包用
`dependencies` 和 `objectiveDependencies` 显式声明其 Objective 包依赖；
准备时固定这些包，不把另一份 Objective 定义塞进 worker resources。
monorepo 根 subject 仍为 `{context,policy,deliveries}`；独立包标准化 subject
仍为 roles/runtime/allows/entries/joins/deliveries 等包级事实。
依赖要求不等于已通过证据，上层必须观察目标并在取得真实事实后重查。

## 构建与打包

```powershell
pnpm install
pnpm build
pnpm --dir packages\objective-package-standard pack --pack-destination .cache\packs
```

原始定义、源码、资源、lockfile 和构建配置入库。运行时和资源副本生成到忽略的
`.staging/<package>`，组装到 `packages/<package>/dist/package`；
`publishConfig.directory` 供 pnpm pack 选择已组装的包。worker 与复制 runtime
不再作为源码提交。`pnpm workers:build` 构建六包全部 16 个入口，
`pnpm workers:check` 校验实际生成物。

本地/Git 来源只有源码时，调用方必须先明确安装并构建，再准备可消费的包目录或
tarball。例如本地开发使用 `packages\objective-package-standard\dist\package`。
不能把没有 worker 的源码包冒充可执行包，也不在检查期间隐式安装或构建。
Git npm spec 指向一个包根，不支持自创 monorepo 子目录 fragment。
发布只走[包专属 tag 流程](./npm-publishing.md)，本次迁移不执行发布。

脚手架创建一个命名 npm 包、根定义、原始 `src/<check>.cjs`、References 和 build 脚本；
明确执行 `npm run build` 后消费 `dist/package`，不要提交生成 worker。

## 标准 spec 与来源

准备 API 使用 `npm-package-arg`、`pacote` 和 npm Arborist 解析、获取和打包，
接受 registry 名称/精确版本/range/tag、npm alias、Git URL/托管 shorthand、
远程/本地 tarball、本地目录。不会模拟另一套近似 npm 的 parser/downloader。
`workspace:`、`catalog:` 是本仓库构建配置，不是所有消费端的隐式扩展承诺。

`prepareObjectivePackage` 是明确的准备边界，默认不授权生命周期脚本；
确需 Git prepare 等安装脚本时，调用方必须明确授权 `allowScripts`。
registry/tarball 应交付已构建、自包含的 worker。准备结果记录声明 spec、实际包名、
解析版本、准确 resolved 来源、可用 integrity/Git commit，以及内容 digest。
认证和发布者信任不由 digest 证明，可信调用方应限制 registry/来源和脚本授权。

`withPilot` 固定准备结果，依赖首次绑定后复用准确版本。
`packageSpecs` 可由可信调用方提供实际包名到 npm spec 的显式映射；
CLI 使用 `objectives.aliases` 中的实际包名映射，简称仍只是引用别名。
例如消费尚未发布的本地候选，可在实际发现的 config.jsonc 中显式配置：

```json
{
  "objectives.aliases": {
    "@potential-guide/objective-monorepo-standard": "D:\\pguide-source\\packages\\objective-monorepo-standard\\dist\\package",
    "@potential-guide/objective-package-standard": "D:\\pguide-source\\packages\\objective-package-standard\\dist\\package",
    "@potential-guide/objective-setup-marker": "D:\\pguide-source\\packages\\objective-setup-marker\\dist\\package"
  }
}
```

本地目录中的依赖路径按该目录解析；已交付的 tarball/Git 包若声明本地 Objective
依赖，须显式提供准确准备包映射，不猜测消费进程 cwd 中恰好存在的同名目录。
同名包出现冲突来源时明确失败，不按访问先后静默换源。
恢复使用持久化的 `sources` 和内容 capsule；准确内容缺失或被篡改时明确报错，
不会重新解析 latest、range 或 Git branch。新任务或显式重新绑定才选择新版。
监督仍观察 Subject、资源和业务结果；相同声明的刷新不重新解析代码版本。

## 包 digest v1

格式为 `sha256-pguide-package-v1:<64 个小写十六进制字符>`。
摘要输入先写 UTF-8 字节 `pguide-package\0v1\0`，
再按相对文件路径 UTF-8 字节的无符号字典序逐个写：

1. UTF-8 `JSON.stringify([path, byteLength, executable])`；
2. 一个 NUL 字节；
3. 文件的原始字节。

`path` 使用 `/`，`executable` 是 tar 交付权限任一执行位是否设置；
准备时保留这些跨平台 mode 元数据，Windows 不用其本地 chmod 仿真原始执行位。
忽略 tar header/压缩、mtime、绝对位置、UID，以及与执行无关的读写 mode。
定义、package.json、References、所有 check 与资源都在覆盖范围内。
拒绝路径穿越、非 NFC 名、大小写冲突、Windows 歧义路径、链接/硬链接、
特殊文件、运行 node_modules，以及第二个 Objective 定义。
单包准备限制为 256 MiB / 16384 个文件，路径项最多为文件上限的两倍；
越界在提取/执行前明确拒绝，不截断摘要。

固定测试向量：`a.txt` 为 `hello\n`（无执行位），`bin/run` 为字节
`00 01 ff`（有执行位），摘要为
`sha256-pguide-package-v1:32e4aa4b5887e23d4fda2cc08f9a89acafe512963cd314f60359dc9c58ced940`。
相同逻辑包经重打包、移动目录保持相同摘要；任一受覆盖文件或执行位变化改变摘要。
压缩 tarball 的 registry integrity 不等于包 digest。

## 执行、证据与历史

`ObjectiveRevision = (packageName, packageDigest)` 贯穿协议、声明、regulation/
supervision、Coordinator 请求、事件、重放与查询视图。投影计数不是代码 revision。
Host 仍只接收规范 check 目录和该目录全部产物 hash，不理解 npm、Objective 或业务依赖。
包 References 变化可更新包 digest，但字节相同的单个 check hash 不必变化。

准备端把包和 check 物化为私有、单硬链接的不可变 capsule。
pnpm store 的多硬链接不直接交给 Host；不放宽 owner/ACL、链接或完整 hash 验证。
worker 的 Node 代码自包含，不能向任意 node_modules 回退。
外部解释器、工具及 Wasm 不是默认安全沙箱；每次任务仍拥有预算、取消与资源清理。

旧 Git-directory URI 与 commit/tree 证据保持原语义读取，不把 commit 解释成包 digest。
已有历史源码、schema 和验收证据不重写；需要转换到包模型时明确重新准备并取得新事实。
静态 working-tree definition 仍不能作为可执行的固定版本证据。
