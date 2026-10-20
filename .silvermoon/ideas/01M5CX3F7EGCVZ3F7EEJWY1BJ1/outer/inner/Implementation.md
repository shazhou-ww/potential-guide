# Implementation

本实施沿用前置子构想的入口、URI 与迁移基础设施，精化输入、context 与受限表达式；
不改变已接受的 Ideal，也不将代码验证误作独立环境或公共部署证据。
验证范围见 [Evidence.md](./Evidence.md)。

## Steps

### I-S01: 规范声明输入边界

外部 `inputSchema` 可省略，解析归一化为 `{const:{}}`；显式 `{}`/`true`
保持任意 JSON 语义，但实际输入仍须显式提供。Unit 可省略为 `{}`，
显式 null 不替换。输入、有限 JSON 投影结果与目标 subjectSchema 分别校验。

### I-S02: 贯通 context 与受限路径函数

工具与声明快照仅携带 `{repo:{rootPath,origin:string|null}|null,path:string}`。
Git path 为相对 POSIX 路径、根为 "."，非 Git path 为绝对路径；
缺少 origin 保留 null，Git 操作故障不降级为非 Git，也不生成隐式身份。
在既有 AST profile 中仅增加 `$pathJoin`，严格要求恰好两个字符串，
调用宿主 `node:path.join` 作纯路径计算，保留节点、深度、时间和输出边界。

### I-S03: 同步作者样例和迁移验证

更新所有作者声明、业务目标、生成 runtime 和独立消费样例。
monorepo subject 显式采用新 repo/path 契约，包 subject 明确投影 root/directory，
不以 origin 或路径冒充旧 opaque 身份。迁移解析 JSONata AST 后转换已知路径，
需要明确 Git/非 Git 语境；字符串常量不替换。无法保持语义的旧身份或整体
context 投影拒绝，只有显式审阅的 subject override 可替换表达式。

## Acceptance criteria

### I-AC01: 输入语义精确

用省略 schema、显式 Unit、空 schema、布尔 schema、非空对象、原始值及 null
证明精确输入语义；非法投影结果仍由目标 subjectSchema 拒绝。

### I-AC02: context 和路径可移植

Git 根目录/子目录、worktree、无 origin、非 Git 和 Git 故障测试证明 context
形状与来源边界；宿主 Windows join 的运行证据和显式 POSIX/Windows 标准函数
对照证明普通 join 约定。真实 POSIX 独立消费仍属 Deployment 待验事项。

### I-AC03: 投影边界未扩大

反例覆盖任意函数、动态调用、错误参数数量/类型、null repo 字段读取、缺失路径、
AST/表达式和输出限制；既有执行限时检查继续生效。
集成、非覆盖迁移和仓库检查证明能力没有扩大为任意 JSONata 或文件系统访问。
