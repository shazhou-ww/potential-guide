# 当前交付独立验收

## 准备与历史有效性

产品起点为 `3be07d321a57637e9189eda452cfb2f5703eb295`，已接受 Inner 为
`e766edd27d16c247d8ff059021ecb8a08f03c9d9`。现有
[Deployment.md](Deployment.md) 不变；旧 [外部证据](Gateway-Only-External-Evidence.md)
和 [结果](Gateway-Only-Results.json) 固定于 `09f93e45...`，不能直接沿用。
本轮不修改源码、Ideal、Inner，不授权 acceptOuter，不发布 npm。

初次直接运行旧验证器，在任何服务启动前退出 1：
`Missing consumer manifest: @potential-guide/ipfs-content`。
当前公开作者入口已为 `@potential-guide/pguide-task-bundle`，Task SDK 不再导出
`/build`、`/publish`。仅更新 Outer [验证器](Gateway-Only-Verify.mjs) 的离线作者
夹具：通过公开 Bundle build/Car API 生成及校验 CAR，将原始块交给独立 HTTP 内容源；
不访问 Kubo、不模拟服务读取、不声称已执行真实节点 pin。
四个 D-* 恢复未勾选，等待新实测；辅助材料先同步 primary 后观察 revision。

同步 `32180f573098d8db7a33994c5dfc44cd8d2965a7` 后第二次运行完成生产安装，
但发现阶段继承的宿主 PATH 中另有全局 `pguide-task-engine`，按公开协议正确报
`Ambiguous command task-engine`，尚未启动服务。进一步隔离运行期 PATH 为
本次 consumer binary、当前 Node 目录及系统工具目录，保留安装期包管理器 PATH；
不修改宿主 PATH 或移除全局 binary。此辅助材料修正亦先同步再证明。

跨盘临时目录的首次尝试被既有同盘路径安全断言拒绝，未启动进程或写入夹具。
改用新建的仓库外同盘独占目录，未放宽断言。

## 宿主与仓库验证

Windows，Node `v24.12.0`，pnpm `11.22.0`。
`pnpm run build` 首次触发缺失依赖恢复，但共享 store 返回
`ERR_SQLITE_ERROR: database disk image is malformed`；不修复共享 store。
随后使用本工作区独占 store，`pnpm install --frozen-lockfile --store-dir <owned-store>`
退出 0，`pnpm run build` 退出 0。

`pnpm check` 退出 1：已通过 sources/layers/format/lint/typecheck，test 阶段
`@potential-guide/pguide-task-bundle` 五项 symlink 测试被 Windows 宿主以
`EPERM: operation not permitted, symlink` 拒绝，Turbo 中止，pack:check 未执行。
不更改宿主权限、全局配置或产品代码，也不把该结果记为全库通过。

## 复现

在新建、空的同盘仓库外目录执行：

```powershell
$source = 'D:\Code\potential-guide.worktrees\task-engine-server-config-validation'
$env:npm_config_store_dir = '<本次独占 store>'
node "$source\.silvermoon\ideas\01M6GRRES5EBHYDP1G9DZEGE8E\outer\Gateway-Only-Verify.mjs" $source <精确产品 HEAD>
```

运行器使用两个独立生产安装、随机 loopback 端口、新 DB、隔离用户 JSONC，
只停止自身追踪的 PID；实际结果及最终清理将在运行后补充。
