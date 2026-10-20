# 声明绑定的独立消费验证

公共定义、实际打包与跨平台运行记录见
[Objective 契约交付验证](../../01M5CX0VMQ080XYSX96ZDCCTZS/outer/Verification.md)；
对应 schema URI、字节哈希及原始 CI run/job 可据此独立复核。

本地 Windows 与 CI 的 Ubuntu/macOS 真实打包消费均通过，使用独立安装的包，
不是把 win32/posix 字符串对照冒充另一操作系统。协议独立消费包含声明 Unit 默认、
input 校验、受限投影与普通 pathJoin；实际部署还覆盖目标观察、绑定及跨进程恢复。

先前 Node 22/24 全量检查中的进程 fixture 超时与嵌套子测试取消没有被忽略，
对应修复已纳入最终来源 `e906e0fa27d9a3317fbed453006657b81894a371`。
[CI run 39469580773](https://github.com/shazhou-ww/potential-guide/actions/runs/39469580773)
整体 success：Ubuntu Node 22.13.0 / 24.11.1 完整检查及 Windows/macOS/Ubuntu
独立打包消费五项均成功，具体 job ID 见关联验证记录。
这提供真实 POSIX 宿主消费证明，而不只是用 path.posix 模拟的字符串断言。
未发布 npm 包，用户原有未提交修改不属于该 CI 来源。
