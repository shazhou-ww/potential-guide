# 以共享 Check Host 复用 Node 检查器

## 问题

逐次启动检查进程和加载重依赖使完整 probe 超出预算；现有 Git 路径身份与入库 bundle 又混合了源码、分发及执行版本。需要统一可复用宿主，并为 Pilot 建立简单且可固定的包身份。

## 结果

一个 Objective 对应一个 npm 包，名称取 package.json.name，Revision 取完整交付包内容的 digest；定义保留在包根 objective.yaml。调用方显式准备并固定包，Check Host 仅复用其 check 的执行资源，提供开始、取消、观察，详见 [最小设计](./Design.md)。

## 边界

- 一包一个 Objective，多个 check 共享包身份；复用 npm dependency spec 与显式安装/构建，不要求生成产物入 Git，不在 check 中隐式安装或追踪上游更新。
- 任务开始时固定包，运行与恢复不静默升级；Coordinator 区分包名与包 digest，Host 只接收 check 目录与其完整产物 hash，不承担包管理、业务依赖或版本选择。
- Node 入口允许受管子进程及 Wasm，check 仍是最小并发单元；输入、证据、预算、取消与资源清理隔离，既有历史不改写，不默认扩展不可信沙箱或远程发布。

## 验收标准

- 内置 6 个 Objective/16 个 check 独立成包消费；不同 npm 来源解析为固定包名及内容 digest，定义与资源完整，registry 更新或本地修改不重绑既有任务，历史来源可诊断。
- 多 CLI 共享执行；观察不重复执行或误取消，业务依赖与来源证据准确，成功/失败/取消后的资源有界，包身份与 check 产物身份不混淆。
- 干净源码可构建及隔离消费，无需提交 bundle；同环境真实冷/热测量证明复用，既有冷启动超时与启动中退出问题闭合，不跳检查、不放宽预算冒充通过。
