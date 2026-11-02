# Deployment

本阶段仅在受控本地环境验证已接受的实现，不发布 npm、不改生产环境、不迁移旧数据。
验证对象为本 Idea 已接受的 `implementationRevision=51a9212036d4718cd448766210e70e0cf9471086`；
后续 Task Bundle Idea 的增量不在本轮验收范围。

## Steps

### D-S01: 验证独立服务消费

运行 `pnpm pack:check`，在仅安装生产 tarball 的独立消费者中核对服务启动、提交、取消、
Task/Run 查询与订阅及真实 Check/Probe。运行 Web UI 的 Chrome 隔离冒烟，验证独立后端连接与交互；
UI 是私有 workspace 应用，浏览器场景不冒充 npm tarball 消费。

### D-S02: 验证退出恢复与增量观察

复跑既有 SQLite 真实子进程崩溃及 Check/Probe restart 集成场景，连同生产消费者的 SSE 重连和持久库重开证据，
核对不重演旧 Run、资格见证、冻结分页与完整源事件增量。分别标记生产包消费、workspace 集成及浏览器证据，
不相互替代；关闭所有自有服务/Worker/浏览器，只清理本次验证资源。

## Acceptance criteria

### D-AC01: 对外行为符合契约

生产 tarball 消费脚本退出 0，独立消费者能观察正确状态、结果、错误及订阅句柄行为；
浏览器冒烟的 checks 全部通过并保留截图/结果路径，不依赖 Engine 内部对象。不以单元测试代替独立消费。

### D-AC02: 重启与观察结果可复核

真实崩溃/重开集成场景及源事件集合补读场景全部通过，证明恢复不会重演旧 Run，
同一水位及观察时间下完整分页基线与增量一致。记录命令、退出码、交付提交及验证边界；
无法确认的物理回收仍失败/未知，不把 Windows 强制进程退出当优雅清理证明。
