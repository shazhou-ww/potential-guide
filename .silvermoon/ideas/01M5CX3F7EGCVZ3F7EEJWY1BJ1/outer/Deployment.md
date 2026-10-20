# Deployment

本契约验证 Windows 和真实 POSIX 的独立消费，不授权 npm 发布或修改用户真实配置。

## Steps

### D-S01: 验证声明的实际消费

在独立使用环境中调用 Unit 和显式输入声明，取得 context、投影结果和目标校验的可核对证据。

### D-S02: 验证跨平台与升级

通过 Windows 与 POSIX 消费样例验证路径结果及缺省场景，并演示旧声明拒绝和显式迁移。

## Acceptance criteria

### D-AC01: 作者调用无需内部知识

独立样例证明作者按公开声明和 context 文档即可调用，省略 Unit 输入不再重复编写 schema，也不需读取隐藏身份。

### D-AC02: 跨平台及迁移结果一致

消费证据表明同一受限表达式遵循本地 join 规则，旧 context 不被静默解释为新结构，迁移失败不损坏原文件。

实际消费与未通过检查的区分见 [Verification.md](./Verification.md)。
