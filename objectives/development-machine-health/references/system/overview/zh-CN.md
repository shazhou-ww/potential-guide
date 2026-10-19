---
title: 开发机器健康
description: Debian/Ubuntu 开发环境的五层可验证健康目标。
references: []
---

# 开发机器健康

每次 Pilot 评估从 initial 开始，依次检查身份、系统、工具链、秩序、持续性；
不复用上次 terminal 结论。每层只执行所属的一组检查，编译证明不重复执行。
terminal 只表示本次测量符合已声明的策略，不承诺未来无限健康。

## Subject 合约

必填：`environment`（container、native-linux、wsl）、`user`、`home`、
`workspace`、`scratchDirectory`、`cacheDirectory`、`logDirectory`、
`tasksDirectory`、`stacks`（typescript、python、cpp、rust 的无重复子集）。
所有目录必须是已存在、当前用户拥有的规范 Linux 绝对路径；不能是符号链接、
根目录、含点路径或尾随斜杠。工作区、临时、缓存、日志、任务目录不得相互嵌套；
允许这些目录位于 home 内，但不能包含 home。

可选 `target` 默认为 `{type:"local"}`；Docker 为
`{type:"docker",container:"容器名或ID"}`，通过 docker exec 的独立参数和
`--user subject.user` 执行 Node 源码，无 shell 拼接、SSH、本机回退或自动安装。
本地只支持 Linux；包管理器仅支持 Debian/Ubuntu 的 dpkg 与 apt-get。
Windows/macOS 必须指定 Linux Docker 目标。容器和 WSL 不检查宿主内核重启。

`minimumVersions` 是以下工具到数字最低版本字符串的扁平映射。默认值：
git 2.30、node 22.13、npm 10、tsc 5、python3 3.10、c++ 10、cmake 3.20、
ninja 1.10、rustup 1.25、rustc 1.75、cargo 1.75。只比较数字分段；
Git 必需，其余按所选 stacks 检查。TypeScript 使用已经安装的 npm 与 tsc，
不调用 npx 或下载全局包；Rust 使用无依赖 Cargo 项目并加 --offline。

可选 `policy` 默认值：minFreeBytes=1073741824、minFreeInodes=1024、
retentionSeconds=86400、historyMinSamples=3、historyMinSpanMs=1000、
historyMaxAgeMs=300000、maxCacheGrowthBytesPerSecond=1048576、
maxLogGrowthBytesPerSecond=65536、maxPackageIndexAgeSeconds=604800。
策略数值均有限且非负；历史最少三个样本、跨度至少 1000ms。容量与增长阈值的
相等边界通过；过期和保留周期仅在严格超过时失败。

可选 `network:{dns:[],urls:[]}` 只访问显式声明的 DNS 名和无凭据 HTTP(S) URL。
URL 支持 DNS/IPv4 主机与 1–65535 端口，不支持 IPv6 字面量或凭据；
必须直接返回 2xx，不自动跟随重定向。不配置端点时在 message 中明确记录不适用，
不会假定公共互联网可达。不要在 URL、路径、参数或任务记录里保存秘密。

## 历史与采样

`node health-check.mjs sample --subject-file subject.json` 或通过 stdin 提交相同 subject。
结果为 `{status:200,payload:{hostname,user,home,measuredAt,freeBytes,freeInodes,cacheBytes,logBytes},message:""}`。
measuredAt 为 Unix 毫秒，容量是 workspace 文件系统的可用字节与 inode，
缓存和日志为普通文件大小总和（不跟随符号链接），不是磁盘实际分配量。
采样目录遍历最多 100000 个节点，任务注册目录最多 10000 个条目，
子进程输出最多 256KiB，输入最多 2MiB，stdin 输入必须在两秒内结束；
超限、执行超时和意外故障是非 200 故障，不会伪装健康。

调用者保存至少三次真实采样到 `history` 数组；按 measuredAt 严格递增且
hostname/user/home 必须匹配当前目标，不接受未来、过旧、缺失或负值样本。
缓存/日志增长率按首尾样本的差值除以真实秒数计算，负增长允许；
不伪造历史，也不因一次空闲快照宣告持续健康。

## 故障与修复边界

检查包装器从 stdin 读取 subject，只向 stdout 输出一条严格 JSON envelope。
支持的问题返回 status=200、payload={ok:false,problems:[{id,parameters}]}；
输入/平台/传输/执行故障返回非 200 与 payload=null，不推进等级。
单层本地执行预算 24 秒，Docker 外层 27 秒，单命令通常 6 秒；
编译命令最多 10 秒但仍受总预算限制。超时终止本次创建的进程组，
不触碰任务注册表中的进程。较慢机器应使用适当资源的环境，不放宽外层 30 秒。

所有检查只读取用户数据；读写探针和编译只使用唯一命名的自有文件/目录并清理。
检查不会安装软件、升级系统、杀死已登记任务、清空日志、清理未提交文件或重启宿主。
任何修复应先解释计划、保护未提交数据、取得相应授权，再重新从第一层评估。
