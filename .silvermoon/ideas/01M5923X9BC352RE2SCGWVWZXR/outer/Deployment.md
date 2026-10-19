# Deployment

## Steps

### D-S01: 验证同步后的独立消费者

同步部署契约后，由主会话在独立 consumer 中安装并运行准确提交的本地候选，
验证 CLI、库导出、权限和恢复；不以源码 import 代替安装产物验证。
Windows 本地执行 pnpm deployment:verify，并检查本次操作拥有的 consumer 已删除；
同步候选的 CI 需覆盖 Node 22.13.0 / 24.11.1 完整检查与三个 OS 的独立 packed consumer。
CI 若因并发文档提交取消，只接受包含同一产品树的后续完整成功矩阵，不把取消当作通过。

### D-S02: 记录发布边界与后续操作

记录准确提交、门禁及消费者输出；给出新 RC 和未来 latest 的有序验证命令，
保留既有发版暂缓条件，不执行 npm 发布或 tag 操作。
交付记录须区分准确版本和默认 latest 两种 registry 验证命令，说明本地 overrides
仅用来解析尚未发布的内部候选，不证明真实 registry 的依赖可获取或 provenance。

## Acceptance criteria

### D-AC01: 当前候选可独立安装运行

主会话执行 pnpm deployment:verify 成功，检查入口包传递依赖与现有运行契约，
并确认本次 consumer 和子进程被清理。适用平台的现有 CI 矩阵应成功。

### D-AC02: 结果与未执行事项真实

发布就绪说明区分本地候选、真实 npm RC 和默认 latest 的证据；
未发布、未验证的外部结果不得标为完成。主会话验收准确部署修订。
