# 规范化声明输入与 JSONata 绑定

## 问题

声明重复要求 Unit schema，投影 context 的字段与目标使用场景不一致，路径拼接缺少跨平台能力。依据[总构想 O-01 至 O-05](../../../../01M5CR0X2B4R2C6K3183Y1T3SQ/outer/inner/ideal/Schemas.md)，衔接 [Objective 定义规范化](../../../../01M5CX0VMQ080XYSX96ZDCCTZS/outer/inner/ideal/Idea.md)。

## 结果

声明引用使用 objective，可选 inputSchema 省略时等价于 `{ const: {} }`；JSONata 以 `{ context, input }` 求值，context 收敛为 repo、path，并支持普通宿主路径拼接函数 `$pathJoin`。

## 边界

- Git 内 path 为仓库相对路径，根目录为 "."；repo 含 rootPath、origin，无 origin 为 null。非 Git 时 repo 为 null、path 为绝对路径，不伪造来源。
- Unit input 可省略为 `{}`；显式空 schema 仍接受任意 JSON，不放宽 Unit-only 省略规则，也不把显式 null 替换成默认值。
- pathJoin 只作普通纯路径计算，不承诺仓库包含性，不访问文件系统；保留投影能力、时间和输出边界，不开放任意 JSONata。

## 验收标准

- 声明加载和绑定区分省略 schema、显式空 schema、Unit 及缺失实际输入，合法结果通过目标 subjectSchema 校验。
- Git、无 origin、非 Git 场景产生明确 context，并支持 Windows/POSIX 的普通 pathJoin 语义，无额外身份或环境泄漏。
- 旧声明和旧 context 使用明确失败及显式迁移路径，受限投影能力不因增加函数而扩大为任意执行。

## 下一步

在构想验收前明确 pathJoin 的固定参数签名及非 Git 场景的声明使用约定；公共声明 URI 复用前置子构想确定的发布策略。
