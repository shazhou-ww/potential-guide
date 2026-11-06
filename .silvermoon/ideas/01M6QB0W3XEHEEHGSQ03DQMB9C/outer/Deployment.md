# Deployment

## Steps

### D-S01: 独立验证实际消费结果

在独立 Windows/Ubuntu 环境执行正常与中途失败流程，真实公共验证显式选择 endpoint；Reference 阶段复用 R-10。

## Acceptance criteria

### D-AC01: 结果有可复验证据

成功阶段与失败阶段均有准确身份和状态回执，不遗留本次服务，也不触及其他用户进程或配置。 外部环境或授权不可用时明确报告阻塞，不用建议文档代替结果。
