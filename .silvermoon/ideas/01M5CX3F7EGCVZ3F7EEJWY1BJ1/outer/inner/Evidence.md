# 绑定实施验证

共同的环境、缓存与独立打包结果见
[前置契约实施证据](../../../01M5CX0VMQ080XYSX96ZDCCTZS/outer/inner/Evidence.md)。
两个 Ideal 未改变，Deployment seed 未当作已完成。

## 覆盖内容

- protocol 新旧测试共 9/9：省略 inputSchema 归一化为 `{const:{}}`；
  显式 `{}`/`true` 接受任意实际 JSON 但不允许省略输入；
  false 拒绝输入，Unit 不把显式 null 改成默认值；
  投影仍经目标 subjectSchema 实例校验。
- 集成后的 pguide 87 项中 85 通过、2 平台跳过：Git root/subdirectory/worktree、
  无 origin、非 Git、Git 运行故障、声明发现及固定来源 continue。
  context 只有 repo/path，没有 opaque checkout/repository ID 或伪造 origin。
- `$pathJoin` 对照宿主 `node:path.join`，覆盖 Windows、POSIX 字符串样例、
  空字符串、`..` 和绝对片段；明确没有 containment 或文件系统保证。
  未授权函数、动态执行、参数数量/类型、缺失路径、null repo 读取及输出限制
  都有失败用例；既有 AST、深度、执行限时机制保持。
- 显式迁移按 JSONata AST 转换已知路径，字符串常量保持；
  原始文件/既有输出不覆盖；需要语境的转换要求 `--context-kind`，
  整体 context 与无法表达的身份失败或接受显式 reviewed override。
- monorepo subject 直接采用 repo/path；包 subject 明确投影 root/directory，
  不将路径或 origin 文本伪装成旧身份。生成 runtime 及私有 tarball 消费通过。

## 剩余外部验证

`pnpm check` 和独立打包均在 Windows 执行。测试对 POSIX/Windows 标准函数的
对照不冒充真实 POSIX 宿主消费；真实双平台独立消费和公共 schema 字节验证
仍留给 Deployment。没有生命周期提交/验收事件、push 或 npm 发布。
