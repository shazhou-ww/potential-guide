# 独立 Agent 资源交付验证

## 交付对象与范围

验证对象是已合并的 `511e9ac`、`090d4c6` 及其集成提交 `96fd7c7`，不是 npm 发布版本。
Implementation 精确 revision `845317e657e70dc940afd2cb6998f1c524d33ef0` 经代理审查后通过门限。
公共 schema 的网络可取得性仍待 Pages 工作流部署，本记录不将包内可用冒充公共 URI 已可访问。

## 独立安装与实际操作

主协调者从干净 integration worktree 打包 `@potential-guide/cli-core` 与
`@potential-guide/pguide-agents`，安装到新建、无工作区依赖的临时 consumer。
测试使用真实 `node_modules/.bin/pguide-agents.cmd`，并将 APPDATA/XDG_CONFIG_HOME
指向隔离目录；测试结束只删除此次创建的 consumer，不修改真实用户配置。

验证通过的可观察行为：

- `--help` 识别 agents 入口。
- 用户级 `set local` 后 `show local` 返回用户来源及完整 profile。
- 项目级同名 `set` 后返回项目 profile；删除项目定义后重新显露用户定义，没有深合并。
- 显式 migrate 将旧主配置中的无 type ACP profile 规范化为 canonical `type: acp`；
  备份保留原始配置，资源校验通过，没有兼容读取旧内嵌格式。
- 已安装 cli-core 的公开 schema 子路径可离线取得，按字节等于仓库 schema。

实际运行平台为 Windows，独立消费检查返回 0，schema SHA-256 为：

```text
bf6f4e634b0167cbd6302ab56e3a6c56f798c4855e565795e74dbe55c2ed9cba
```

验证脚本属于本次 session 的可重复检查工具，不随业务包发布。
最初一次脚本因用未解析真实路径的 pnpm symlink 构造 createRequire 而无法定位传递依赖；
修正测试工具后重新完整执行通过，不将该工具错误掩盖为产品成功。

## 主协调者补充检查

- 从集成工作区直接执行 manager 测试，9/9 通过。
- 重建 pguide 分发产物后直接执行 Agent 路由/非法资源隔离回归，2/2 通过。
- 集成工作区完整 `pnpm check` 返回 0，包括打包及九种隔离消费场景。
- 原始 D 盘工作区存在无 package.json 的遗留 monorepo-objective 目录，基线检查已明确失败；
  干净工作区同一基线通过。未删除、修改该未知遗留目录。

## 尚待的公共交付证据

Pages 已启用 Actions 部署，但 schema 工作流尚待 Objective 分支集成。
应在同步当前 Deployment revision 后验证实际 URL、响应内容及不可变检查，
再完成 D-S01/D-AC01，不能以仓库文件存在代替公共可取得性。
