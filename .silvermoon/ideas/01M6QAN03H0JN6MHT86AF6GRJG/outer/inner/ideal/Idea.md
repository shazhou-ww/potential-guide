# 绑定 Task 制品身份与交付来源

父 IDEA：[check-delivery-acceptance-followups](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Idea.md)；原始 [R-01 副本](./Recommendation.md)保留来源。审阅范围与准备期复现见[范围、兼容性与证据](./Scope-and-evidence.md)。

## 问题

CAR 根 CID、容器哈希与来源由操作者分散拼接，旧缓存和同名旧副本容易被误当成正确制品。结构合法的 CAR 不一定对应本次选定源码或已发布包；仅凭 Git 干净状态也不能证明 Reference 原始字节一致。

## 结果

通过现有离线校验入口生成同一稳定读取的制品身份，由仓库交付层绑定可核实来源；复制、委派和上传只消费与该记录配套的已验证字节，不再人工拼接批准清单。

## 边界

- 复用 `readTaskArtifact` / `check artifact` 及既有 CAR/DAG 校验；保留原 API、CLI 结果和公开 `references.json` 契约。CID 标识内容，SHA-256 标识实际 CAR 容器；目录不伪造容器身份。
- 首批接线限本仓库 Check environment 的构建、打包和交付前核验，支持源码快照及准确 npm 包来源。缓存命中也核对精确资源字节，不偷偷规范化 Reference，不以强制重建作为永久正确性机制。
- 不新增通用上传服务、宿主文件桥接或 Pinboard expected-root；不处理其余七个子 IDEA。本子 IDEA 独立审阅，不继承父级或原交付 IDEA 的任何接受决定。

## 验收标准

- CAR 的根 CID、容器 SHA-256、字节数和验证结果来自同一次稳定读取；来源验证独立可追溯，未知来源仍可离线检查，但不得成为可交付或已批准的证明。
- 相对已核实来源的旧 CAR、互相矛盾字段、操作前或读取中替换的文件均明确拒绝，失败时复制/委派及网络写入次数为零；校验后不得重新按可变路径读取另一份内容。
- Windows/Ubuntu 对相同字节与工具配置得到相同身份；CRLF/LF 差异、旧缓存恢复可观察且被交付核验拒绝，正确输出正常命中缓存仍通过，既有 CAR/DAG 拒绝规则不变。
