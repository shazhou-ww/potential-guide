# 规范化 Task Bundle 内容并统一 CID 身份

父 IDEA：[交付跟进](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Idea.md)；[原始 R-01](./Recommendation.md)仅保留历史来源，当前范围以本文及[契约与证据](./Scope-and-evidence.md)为准。

## 问题

跨平台文本换行使本应相同的 Bundle 内容得到不同 CID，Git/Turbo 输入身份又可能掩盖原始字节差异。交付中混用容器哈希与内容 CID、只解析 CAR 头或重新读取可变路径，会造成身份判断与实际消费不一致。

## 结果

打包工具自动规范化默认文本，显式 binary 文件原样保留，最终 Bundle 自解释；所有身份判断只使用完整验证后的内容根 CID，实际消费绑定已验证内容。

## 边界

- 默认文本为合法 UTF-8，CRLF 和孤立 CR 统一为 LF；build YAML 的 binary pattern 按最终 Bundle 相对路径排除，最终 manifest 保存准确 binary 清单，不靠文件类型猜测。
- 本次不保留旧契约兼容分支。新契约贯通作者工具、公共协议/Schema、Engine 读取及仓库构建消费；公开 references.json 的路径/CID 语义不变，不新增整 CAR SHA-256 身份或来源批准体系。
- 不判断制品新旧优劣；只有明确期望 CID 才比较目标。复用标准 CAR/DAG 校验，不修改 Pinboard expected-root、其他子 IDEA、npm 发布授权或通用上传服务。

## 验收标准

- LF/CRLF/CR 文本按同一规则生成相同规范内容和 CID，binary 原字节不变；非法 UTF-8 明确报错，独立 Bundle 可验证其文本/binary 声明，读取器只校验不改写。
- 新规则和 binary 配置变化使缓存正确失效，旧输出不得通过新契约；正确冷构建及普通命中可用，不依赖永久强制重建。
- 合法同根不同容器表示均通过，不以 CAR 哈希/大小拒绝；坏块、缺块、错误期望 CID 和读取中替换被拒绝，实际消费不重新读取未验证的路径内容。
