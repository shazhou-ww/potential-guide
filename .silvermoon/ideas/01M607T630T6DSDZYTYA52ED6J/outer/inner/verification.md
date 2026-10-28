# 独立 Check 制品实现证据

## 环境与范围

2026-10-28，Windows / Node `v24.11.1` / pnpm `11.22.0`。
本页仅证明 Inner World 候选；不宣称外部部署、用户验收、签名认证或正式 Release。
原始 accepted Ideal 和 Deployment seed 未修改。

实现入口为[制品工具与完整契约](../../../../../packages/check-artifacts/README.md)，
关键代码是 [manifest/内容校验](../../../../../packages/check-artifacts/src/manifest.ts)、
[node-tar 读取边界](../../../../../packages/check-artifacts/src/archive.ts)、
[显式构建打包](../../../../../packages/check-artifacts/src/build.ts) 和
[准确准备/缓存](../../../../../packages/check-artifacts/src/index.ts)。
所有生成 worker、压缩包及执行缓存均在 Git 忽略目录中；Git 仅交付源码、原始资源、
References、构建配置和依赖锁定。

## 实际运行的验证

- `pnpm install --ignore-scripts`：新 workspace manifest 增加后执行，成功；
  仅复用 catalog 的 Ajv/esbuild/tar 及已有 workspace 依赖，没有新增第三方版本。
- `pnpm exec tsc -b packages\check-artifacts --pretty false`：成功。
- `pnpm exec biome format --write packages\check-artifacts` 和
  `pnpm exec biome lint packages\check-artifacts`：最终相关检查成功。
- `pnpm --filter @potential-guide/check-artifacts test`：11 个测试通过，0 失败，
  0 跳过；其后增加了 EOF 限额流控及示例绝对路径校验，最终版本还由下述全量检查覆盖。
- `pnpm check`：最终退出 `0`，layers、format、lint、typecheck、test、pack:check 全部通过。
  测试 Turbo 48/48 tasks 成功；新制品 11/11、现有包准备 16/16、
  Host 31 通过/0 失败/2 个平台跳过、pguide 105 通过/0 失败/1 个平台跳过，
  根 scripts 35/35；既有 22 个发布包的 pack 和 10 组隔离消费者全部通过。
- `pnpm --dir packages\objective-monorepo-standard exec tsx --test --test-name-pattern "real repository has" test\pilot.test.mjs`：
  新 workspace 声明和目录覆盖补齐后，2 个测试通过，0 失败。
- `pnpm --dir packages\cli-runtime exec node --test test\package-source.test.mjs`：
  16 个现有包准备/摘要/恢复测试通过，0 失败，0 跳过。
- `pnpm --dir packages\check-artifacts pack --pack-destination ..\..\.cache\check-artifacts-tool-pack --json`：
  成功，25 个文件；含 `dist/index.js`、`dist/build.js`、类型声明、完整作者示例、
  README 与 LICENSE。此为本地工具包检查，不是上传或发布。
- `node packages\check-artifacts\examples\file-content\build.mjs`：最终示例显式构建和
  gzip tar 打包成功，摘要见下节。随后通过真实 CheckKernel 执行匹配和不匹配目标文件，
  分别得到 `Completed` 的 `ok: true` 和 `ok: false / content-mismatch`，不是模拟结果。

早期测试暴露并修复了 Windows manifest 受保护 ACL/私有 mutex 元数据混入制品、
tar 在 Windows 上规范化反斜杠前的检查、监听器挂载位置、现有 deadline 的协作取消预期。
一次早期全量运行在新测试格式化检查失败处停止；最终检查重跑，不把该次失败计为通过。
后续全量检查识别了新 workspace 必须提供的现有标准声明/公共交付映射及包数量断言，
现已补齐；这不是 Objective 制品迁移。

同次检查也复现现有 npm 包摘要在本机 Windows 首次读取归档恢复时间戳的文件时，
路径 `lstat` ChangeTime 延迟刷新导致误报“内容变化”。单独复现显示 inode、长度、
mtime 均不变而路径 ctime 在读取后刷新。为保持原有内容验证可用，包摘要读取精确采用
已有 Host 的 no-follow、单硬链接、路径到 handle 身份核对及同一 handle 读前/读后元数据
核对策略；未跳过时间检查、未靠重试容错、未改变摘要格式或 Objective 来源语义。
相关修复在 [package-source.ts](../../../../../packages/cli-runtime/src/package-source.ts)，
由上述原有 16 个回归测试验证。

两次诊断调用先后使用了错误的 cwd 和缺失 tsx loader，分别明确失败；按各 package
原有运行边界修正后才取得上面记录的通过结果，没有把诊断调用的失败记成成功。

## 真实 Check 的准确内容

源码为 [file-content/worker.ts](../../../../../packages/check-artifacts/examples/file-content/worker.ts)，
其 Ajv 依赖由 esbuild 捆绑进单个 worker。资源为精确 UTF-8 预期文本；
完整通用知识分别在 [Check Reference](../../../../../packages/check-artifacts/examples/file-content/references/check.md)
和 [problem Reference](../../../../../packages/check-artifacts/examples/file-content/references/content-mismatch.md)。

最终显式构建输出（当前 Windows 文件字节与工具版本）：

| 边界 | 准确值 |
| --- | --- |
| Check ID | `file-content` |
| 逻辑制品 digest | `sha256-pguide-check-v1:3d0dddd74456804b7ab70ce04309081577c86b685bf938f66591b3995611bcb5` |
| gzip tar 传输 digest | `sha256:764ea01511fd2e37cc75fbb0a6237f3b7b2de34d69e9b91c560f9e4b73c4329c` |
| Windows Host execution revision | `52649b7eec962a60c2fd5564afdcea741fca7589df528a8f4798a832c0f08119` |

消费者执行树只有 `worker.cjs` 和 `resources/`，没有 Check `node_modules`。
Host 原有解析器禁止从父目录回退加载代码依赖，因此通过真实 Ajv Check 同时验证了自包含。
References 在完整逻辑制品树中逐字节交付，但不被作为 worker 执行资源混入 Host revision。
这些值不是其他平台或重构建的版本别名；重建时仍须重新计算、声明并校验准确内容。

## 验收路径

[artifacts.test.ts](../../../../../packages/check-artifacts/test/artifacts.test.ts)
覆盖 I-AC01、I-AC02，并覆盖 I-AC03 的经新准备层执行路径：

- 真实源码→显式 bundle→node-tar gzip→本地准备→Host 正/负业务结果，逐字节校对 References；
- 真实 localhost TLS 服务，运行时生成且清理的一天期证书，仅在子进程设置
  `NODE_EXTRA_CA_CERTS`；不关闭 TLS 验证、不使用外部网络或 registry；
- HTTPS 传输/逻辑摘要分别错误、替换内容、重定向、声明超限及超时均失败；
  有效缓存的源服务关闭后仍可准确复用；
- 逻辑摘要固定向量、重新压缩不改变逻辑内容、Reference 变化不改变相同 Host revision、
  manifest 执行位声明改变逻辑摘要；
- 并发准备、离线复用、损坏执行树、缺失执行树不被修复或替换；
- 本地/压缩包路径穿越、Windows/NFC 歧义、软/硬链接、特殊项、重复/大小写冲突、
  缺失/未声明内容、文件数/路径数/字节数/传输/展开限额、截断和嵌套压缩；
- 经制品准备的真实 worker 协作取消和 deadline 均在 defer 清理完成后成为 `Cancelled`，
  不把取消写成成功业务结果，不保留已拥有的子进程。

Host 本身没有源码改动。既有 Host 的预算、并发、取消、资源/进程清理、ACL、
Wasm、HTTP 和执行边界由其原测试实际覆盖，31 项通过、2 项平台跳过、0 失败。

## 待部署验证及已知边界

- 外部独立消费者、托管/取得 HTTPS 制品和实际部署证据属于下一阶段；未提前勾选 D-*。
- HTTPS 只接收直接 URL，不自动跟随 Release/CDN 重定向；来源授权和可信 digest
  由调用方负责。没有签名、registry、隐式认证、沙箱或 Objective 继承覆盖承诺。
- 当前现场验证为 Windows/Node 24；Linux 与最低支持 Node 22 的现场消费应在后续环境验证。
  JSON Schemas 使用现有 Ajv draft-07 编译，不加载远程 schema。
- 私有缓存根复用现有 Host helper 的 64 个直属条目上限；没有自动 GC 或崩溃后锁接管。
  缓存只读及摘要证明内容一致，不能对抗所有者，也不等同发布者认证。
- 新工具 workspace 已构建并本地 pack；本项没有发布工具 npm 包、Check Release asset，
  也没有修改正式发布库存。后续内置迁移/正式 Release idea 保留其独立范围。
