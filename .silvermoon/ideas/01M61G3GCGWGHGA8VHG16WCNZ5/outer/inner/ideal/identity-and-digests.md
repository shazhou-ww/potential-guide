# 准确引用与 Git SHA-256 内容树

## 身份分层

- URL 是获取位置和来源能力，不是唯一内容身份；同 URL 可更新，多 URL 可提供同内容。
- digest 为准确内容树身份，外观统一为 sha256:<64 lowercase hex>。
- transportDigest 为归档下载原始字节的 SHA-256，不等于内容树 digest。
- 实际 worker 执行 revision 仍独立，不拿内容摘要替换历史执行证据。

两类制品均不把自身 URL、digest、transportDigest 或凭据写进 YAML。Objective 内
Checker 引用的预期 digest 必填；用户创建 Task 时 URL 必填，digest 可选。
下载后计算摘要只说明取得的内容，不证明发布者身份；可信预期值、TLS、来源授权各司其职。

## Git 算法选择

采用 Git 的 SHA-256 对象格式，以制品根 tree OID 作为逻辑 digest；不是仓库 commit、
SHA-1 tree、压缩归档哈希，也不是文件哈希的简单拼接。不要求制品有 .git，更不下载源码历史。

规则应与 Git SHA-256 的 blob/tree 二进制编码精确一致：

1. 每个文件的对象 ID 为 SHA256(UTF8("blob " + byteLength + NUL) + 原始字节)。
2. 目录对象内容为按 Git tree 名称比较规则排序的条目。比较目录时使用名称后接 /
   的规则，不能用普通完整路径字符串排序冒充。
3. 文件条目为 ASCII("100644 ")+UTF8(name)+NUL+32 字节子对象 ID；子目录条目
   使用 "40000 " 和对应 tree ID，不写十六进制文本 ID。
4. tree ID 为 SHA256(UTF8("tree " + bodyByteLength + NUL) + 上述 body)。
5. 根 tree 的 64 位十六进制输出加 sha256:。schema 文件名和内容自然参与树身份，
   不额外加入应用自创的 hash 前缀，否则不再与 Git tree OID 相等。

制品 profile 固定所有常规文件为 100644，包括 worker.cjs；Node 加载 worker
无需宿主可执行位。目录仅为树节点，不采纳 NTFS/POSIX 模式差异。拒绝 symlink、
submodule、特殊文件、空目录和路径冲突；沿用 NFC、跨平台大小写及安全路径验证，
拒绝不规范输入而非重命名。原始 UTF-8 文件字节参与摘要，不经过 autocrlf、Git
attributes、clean filters 或 YAML/Markdown 重新序列化。

因此相同内容树在不同 OS 和归档打包参数下得到同一个逻辑 digest。实现可用共享纯库，
不强制运行时安装 Git；以临时 SHA-256 Git 对象库的 hash-object/mktree 作测试 oracle，
覆盖嵌套目录、Git 特殊排序、Unicode、空文件、换行和篡改。不要依赖当前仓库的对象格式。
具体 schema 应固定此 digest profile，不能只写“使用 SHA-256”留下输入编码歧义。

## 传输摘要

transportDigest 由 Host 流式计算受限下载的准确归档字节，记录于安全来源元数据；
不在 checker.yaml/objective.yaml 中出现，也不要求 Objective 作者手写。
压缩参数改变可以改变 transportDigest 而不改变根 tree digest。
如果可信发布描述另提供预期 transportDigest，Host 比对；否则仅为本次传输记录，
不能声称已比对发布者认可的归档。解压和读取仍有独立限额及安全校验。

## 引用序列化

结构化规范形态为 {kind:"checker"|"objective",url,digest?}。字段上下文已固定类型时
可以省略 kind；主体 URL 必须经授权。原始签名参数、凭据不得进入普通日志或可导出的
历史证据；需要恢复时用明确的凭据解析配置，不以脱敏后不可用的地址伪造可恢复性。

建议文本形式为：

```text
checker:https://example.com/layout.tgz
checker:https://example.com/layout.tgz#sha256:<64 hex>
objective:https://example.com/workspace.tgz
objective:https://example.com/workspace.tgz#sha256:<64 hex>
```

这是带类型引用，不是原样交给 fetch 的 URL。解析前缀和唯一外层 fragment 后分别
验证来源与摘要。来源禁止 fragment，字面 # 必须为 %23；不使用所谓 URL 非法字符
依赖宽松解析器行为。保留查询语义，不任意排序 query 或将重定向目标替换原来源身份。
文本编码、长度及 round-trip 测试在实施 schema 中固定。

裸 digest 可用于已授权缓存查询，不用于猜测缺失内容的来源。浮动确认每次受理选择
当前内容；幂等重试恢复原 Task，不重新确认 latest。固定引用和运行中旧版不被新版覆盖。
历史 sha256-pguide-* 和旧执行 revision 原样解释，不通过改前缀伪造新 Git tree 摘要。
