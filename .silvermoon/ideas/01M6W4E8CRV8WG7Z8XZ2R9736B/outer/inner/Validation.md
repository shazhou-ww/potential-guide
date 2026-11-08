# 局部依赖与验证环境复用

这是本次评审修复保留的工作树内验证设施，不是发布制品或新的验收合同。
入口始终为 `D:\Code\potential-guide.worktrees\cid-ipfs-objective-definition`。
所有命令在该目录执行；不改变全局 pnpm 配置或共享 store。

## Windows 定向回归

```powershell
$env:pnpm_config_store_dir = Join-Path (Get-Location) '.cache\pnpm-store'
pnpm exec turbo run build --filter=@potential-guide/probe-sdk... --output-logs=errors-only
pnpm --filter @potential-guide/probe-sdk test
pnpm exec tsc -p tsconfig.test.json --pretty false
```

pnpm 11 的进程配置变量是 **`pnpm_config_store_dir`**；
这里不使用失效的 `npm_config_store_dir`，也不修改 `.npmrc` 或项目 YAML。
现有依赖已经恢复；仅当依赖确实缺失或清单改变时执行：

```powershell
pnpm install --frozen-lockfile --store-dir $env:pnpm_config_store_dir
```

Windows 主环境仍没有文件符号链接创建权限。不要通过跳过测试或改变机器
Developer Mode 来“修复”这项环境限制。

## 原生 Linux 完整检查

保留文件：`.cache\probe-review-validation.ext4`。
它是本工作树拥有的 3 GiB 稀疏 ext4 镜像，含独立候选源码、
Linux node_modules、已编译包和检查日志。目录 `probe-review-validation`
只是专用挂载点；交接时镜像已卸载，无长驻 server/helper。
源树逐文件散列与本次候选代码比较，不使用旧副本结果证明新改动。

依赖缓存为 `.cache\pnpm-store`。镜像内使用 Node **24.14.1**、
pnpm **11.22.0**；下面的进程 PATH 去掉 Windows 中已安装的同名 CLI，
避免标准 CLI discovery 测试报告宿主命令冲突。

复跑该已同步候选：

```powershell
wsl -d Ubuntu --exec mountpoint -q probe-review-validation
if ($LASTEXITCODE -ne 0) {
  wsl -d Ubuntu --user root --exec mount -o loop .cache/probe-review-validation.ext4 probe-review-validation
  if ($LASTEXITCODE -ne 0) { throw 'Cannot mount owned validation image' }
}
$checkExit = 1
try {
  wsl -d Ubuntu --exec bash -lc 'cd probe-review-validation && export PATH=/home/lyweiwei/.nvm/versions/node/v24.14.1/bin:/usr/local/bin:/usr/bin:/bin && export pnpm_config_store_dir=$(realpath ../.cache/pnpm-store) && CI=1 pnpm check > .cache/review-full-check.log 2>&1'
  $checkExit = $LASTEXITCODE
  wsl -d Ubuntu --exec cp probe-review-validation/.cache/review-full-check.log .cache/probe-review-full-check.log
} finally {
  wsl -d Ubuntu --user root --exec umount probe-review-validation
}
if ($checkExit -ne 0) { throw "pnpm check failed: $checkExit" }
```

这里的 Unix 路径仅是 WSL 命令参数；镜像、挂载点及日志都归当前 Windows
工作树所有，不使用系统临时目录或其他人的验证工作区。
必须保留 **`--exec bash -lc`**，避免 WSL 默认 shell 在 `cd` 之前提前展开
`$(...)`。已实测正确配置输出为
`/mnt/d/Code/potential-guide.worktrees/cid-ipfs-objective-definition/.cache/pnpm-store`；
不要使用指向其父级工作树目录的缓存路径。

## 修改候选之后

镜像是固定源码快照，不会自动跟随 Windows 文件。父级审查若再修改代码，
必须同步受影响文件（以及清单/锁文件，若有变化）、重新构建及验证，
并重新比较对应文件的 SHA-256。不要把本轮通过记录当作后续源码的通过记录。
尚未改变代码的 Outer 检查可以复用镜像内已验证的 SDK/编译器和已安装依赖。
不要启动并遗留长期 server；只启动本次检查实际需要、可关闭的服务。

评审和部署结束后，父级可以在确认没有本次检查仍使用挂载后卸载它，
删除 `.cache\probe-review-validation.ext4` 和空的专用挂载目录。
依赖缓存可继续留作本工作树的局部 store；不要删除或修复共享
`D:\.pnpm-store\v11`。
