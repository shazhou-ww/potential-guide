# 契约、范围与准备期证据

本文支撑 [Idea](./Idea.md)。2026-11-06 用户讨论已明确替换初始 R-01 方案：默认文本自动规范化，binary 显式排除，Bundle 自解释，根 CID 是唯一内容身份，不做旧契约兼容；不引入容器哈希或发布来源批准体系。[Recommendation](./Recommendation.md)保留历史建议，不作为与本契约冲突时的实施依据。

## 已决定的内容规则

1. 构建配置增加 `binary` pattern 列表，省略等同空列表。使用既有可移植 glob 约定，匹配 include 映射后的最终 Bundle 根相对路径，而非作者源码路径；规则固定、大小写敏感，禁止绝对路径、越界及隐式平台差异。不按扩展名或 NUL 启发式猜测类型，不读取机器 Git 配置。
2. 未匹配 binary 的所有最终文件必须是合法 UTF-8，非法字节明确报错并指明路径；将 CRLF 与孤立 CR 规范化为 LF，保留其余字节，包括 BOM、空格、末尾换行数量和 Unicode 表示，不自动转码或静默改写原作者文件。binary 表示原始字节保留，允许把需要保留 CR 的文本夹具声明为 binary。
3. 规范化在生成最终内容树、目录、CAR 及 CID 前完成。目录和 CAR 从同一规范化快照生成；生成的 manifest、Schema 和 Worker 同样遵守文本契约。控制声明不能通过 binary 逃避自身的 UTF-8/LF 要求。
4. 最终 task.yaml 显式包含准确、排序且不重复的 binary 文件路径列表（无 binary 时也显式记录空列表），列表必须是实际文件集合的子集。打包阶段展开 pattern，最终消费者无需作者 .build.yaml、Git 或原始目录即可判断每个文件的规则。禁止 dangling/unsafe 声明；仅影响未选中文件的 pattern 不创建额外内容。
5. 已存在的目录/CAR 读取器只验证实际字节，不重新规范化并返回另一个 CID。公共 Bundle 契约验证 UTF-8/LF、binary 清单及既有精确 include/Schema 规则。遗漏新必需声明的旧 Bundle 明确拒绝并提示重新构建，不维护双轨旧行为；更新全部本仓库生产者、夹具、内嵌资产及机器 Schema。

用户已授权监督者自主决定实施细节及门禁。UTF-8 严格校验、CRLF/孤立 CR 均转 LF、最终 binary 精确清单是本次采用的明确决策；不留待实施者隐式选择，也不据此接受旧 ideal。

## 唯一身份与消费边界

- 根 CID 标识实际内容树；CAR 是容器，不要求不同合法序列化字节相同。整 CAR SHA-256 不参与身份、不必新增该输出；大小仅用于容量限制及统计。块哈希和 DAG 完整性校验必须保留。
- 没有期望 CID 时，只回答是否合法及实际根；有明确期望 CID 时，在完整标准校验后比较。不按构建日期、版本高低、来源未知推导“不合法”，不让 Bundle 工具依赖 npm/Git 来源批准。
- 复制/消费绑定已验证的稳定快照，不能先 check 后重开可变路径 copyFile。读取过程中替换仍沿用现有保护，读取完成后只使用已验内容；替换后的路径不能改变实际交付。失败不能覆盖既有接受输出。
- 同根不同 CAR 块顺序应通过；损坏块、缺块、额外块、多根、容量超限、危险路径等继续由现有标准验证器拒绝，不手写另一套解析器。不增加外部上传客户端或 Pinboard expected-root。
- references.json 继续表示各 kind 的 directory/car/cid，不加入第二套身份。确需证明某个 npm 包或 Git 提交的来源属于额外发布策略，不是本子 IDEA 未完成的隐含门槛。

## 实际接线与缓存

复用 [artifact 读取器](../../../../../../packages/pguide-task-bundle/src/artifact.ts)、[作者工具](../../../../../../packages/pguide-task-bundle/src/authoring.ts)、[标准协议](../../../../../../packages/task-protocol/src/bundle.ts)，核对 Engine、公共 JSON Schema、作者 CLI、生成器及消费测试的全部生产/验证面。

[environment 构建](../../../../../../packages/check-environment/build.mjs)和 [SDK 资源比较](../../../../../../packages/check-sdk/src/authoring.ts)必须比较按新规则规范化的预期资源，而非旧的原始文本字节；binary 仍精确比较原字节。复制使用已验快照，保留 candidate 整体接受和失败不覆盖的语义。

[Turbo](../../../../../../turbo.json)输入应跟踪规范化代码、配置和相关依赖，binary 声明变化不能误命中旧产物；命中后的交付边界仍验证新契约和规范预期内容，旧的未声明/CRLF 输出不能凭缓存成功逃过校验。以真实 environment 路径测试冷构建、命中、规则变化及注入旧输出，再作最小接线修复；不永久 --force、全局禁缓存或无条件清缓存。

## 已完成的准备期复现（不是新实现验收）

2026-11-06 在基线 `61cefb02b2f81dd7d85e98b469c600b4f7016970`，Windows、Node v24.11.1、pnpm 11.22.0、Turbo 2.11.8 下，用独立临时 Git/pnpm workspace 复现。默认 inputs、dist/** outputs、仅本地缓存，沿用 `* text=auto eol=lf`，core.autocrlf=false；原仓库及父 worktree 未被实验修改。

取 [tools Reference](../../../../../../packages/check-environment/references/tools/en/check.md) 的 LF 字节和仅替换换行的 CRLF 字节，用标准 encodeContentCar 打包 probe，标准 readTaskArtifact 校验。四次工作树 diff 为空，输入 Git/Turbo 哈希均为 `c8f3a457fd5755232e79fa1762b6bb079c41d8db`，任务哈希为 `6cdbb8dbdb0db850`。

| 实验 | 输入页面字节 | 缓存 | 输出页面字节 | 与原始输入相同 |
| --- | --- | --- | --- | --- |
| CRLF 初次构建 | 1000 | miss | 1000 | 是 |
| LF 复用上述缓存 | 979 | hit | 1000 | 否 |
| LF 独立空缓存对照 | 979 | miss | 979 | 是 |
| LF 正常命中 | 979 | hit | 979 | 是 |

旧契约下两个 probe CAR 都合法，但根不同：CRLF 为 `bafybeig3x6b6ehidjuc5d3ch6pmxcz5g6zewbuhg5elck5yr4thdpj5teq`，LF 为 `bafybeicec2jdrocgnsdvhwp3pcauoaummfmszt3rftjzypchnrckyfrl6m`。这证明此配置下规范化输入哈希与原始产物字节可分离，不证明所有 Turbo 缓存不可靠或完整还原历史 A-02。

此前现有 car-files/official-car 两个测试文件 9/9 通过，仅证明旧读取保护基线。旧方案完整证据保留在 Git 历史的 `751a19e1f9c8839c17efd90d10d831e33df445b3`；新契约下应证明 LF/CRLF/CR 默认文本生成相同根，而非继续要求因行尾差异拒绝。

## R-01 覆盖及验收矩阵

| 场景 | 必须观察到的结果 |
| --- | --- |
| A-01，LF/CRLF/CR、混合行尾、空文件、BOM、末尾无换行 | 默认文本合法 UTF-8，只有换行被改写；规范文件集合和根 CID 一致，幂等，目录与 CAR 内容一致。 |
| binary glob、重命名 include、嵌套/大小写路径 | 按最终路径决定，binary 字节不变，manifest 精确清单可独立验证；非法 UTF-8 非 binary 报路径错误，绝不自动 fallback。 |
| A-02，冷构建/正常命中/规则变化/旧输出恢复 | 新规则正确接线，正确命中通过；旧契约或不符当前规范预期的资源在接受/打包前拒绝，不靠强制重建。 |
| A-03，明确期望根匹配/不匹配、无期望根的较早制品 | 只按完整验证后的实际 CID 比较，不以“旧”拒绝合法 Bundle。 |
| A-04，合法同根不同容器排列 | 不要求容器哈希/大小相同；标准校验后返回同一根，调用方不手工拼多字段批准清单。 |
| A-05，坏块/缺块/多根/额外块/路径/容量 | 保留既有标准拒绝，无单独 CAR 头解析替代完整校验。 |
| 读取中及读取后替换、构建失败 | 读取中替换拒绝；读取后交付已验快照或失败，绝不消费新路径内容，不覆盖已有接受输出。 |
| 仓库外消费及 Windows/Linux | 使用打包后的公共 API/CLI 验证默认文本、binary、自解释 manifest、同根容器及错根拒绝；记录真实环境证据，不以模拟 LF/CRLF 冒充另一操作系统运行。 |
