# 声明绑定的独立消费验证

公共定义、实际打包与跨平台运行记录见
[Objective 契约交付验证](../../01M5CX0VMQ080XYSX96ZDCCTZS/outer/Verification.md)；
对应 schema URI、字节哈希及原始 CI run/job 可据此独立复核。

本地 Windows 与 CI 的 Ubuntu/macOS 真实打包消费均通过，使用独立安装的包，
不是把 win32/posix 字符串对照冒充另一操作系统。协议独立消费包含声明 Unit 默认、
input 校验、受限投影与普通 pathJoin；实际部署还覆盖目标观察、绑定及跨进程恢复。

先前 Node 22/24 全量检查中的进程 fixture 超时与 Agent 子测试取消尚未因部署成功
而忽略；须取得修复后的完整检查通过证据，才能给当前 Deployment revision 记录提交与验收。
此前本地完整检查和直接协议测试通过的实施证据，不替代这个外部门限。
