param(
  [Parameter(Mandatory = $true)][string]$DeploymentRevision,
  [string]$CandidateCommit = "93ad00d0fd901785d0d70177b67c1deb6b59245d",
  [string]$RunDirectory
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
Set-Location $root
if ($DeploymentRevision -notmatch "^[0-9a-f]{40,64}$") { throw "必须提供准确部署修订。" }
$tree = (git ls-tree HEAD -- .silvermoon\ideas\01M6KBWCZSSWWF3BBMRC3ZBTXD\outer) -split "\s+"
if ($tree[2] -ne $DeploymentRevision) { throw "当前部署契约与已观察修订不一致。" }
$sourceDelta = git diff --name-only $CandidateCommit HEAD -- apps packages scripts package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json
if ($sourceDelta) { throw "候选实现与已验收版本不同：$sourceDelta" }
git merge-base --is-ancestor HEAD origin/main
if ($LASTEXITCODE -ne 0) { throw "部署契约尚未同步到 primary。" }
if (-not $RunDirectory) { $RunDirectory = Join-Path $root (".cache\official-car-delivery-" + [guid]::NewGuid().ToString("N")) }
$RunDirectory = [System.IO.Path]::GetFullPath($RunDirectory)
if (Test-Path -LiteralPath $RunDirectory) { throw "不得覆盖已有验证目录。" }
New-Item -ItemType Directory -Path $RunDirectory | Out-Null
$env:pnpm_config_store_dir = Join-Path $root ".cache\pnpm-consumer-store"
$env:pnpm_config_cache_dir = Join-Path $root ".cache\pnpm-consumer-cache"
$env:NODE_OPTIONS = ""
$env:NODE_PATH = ""
pnpm sources:check *> (Join-Path $RunDirectory "build.log")
if ($LASTEXITCODE -ne 0) { throw "候选构建或生成源检查失败。" }
if (git diff --name-only -- apps packages scripts package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json) {
  throw "构建改变了已验收实现，停止交付。"
}
function Write-JsonFile([string]$Path, $Value) {
  [System.IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $Value -Depth 100), [System.Text.UTF8Encoding]::new($false))
}
$definitions = @{}
foreach ($directory in Get-ChildItem (Join-Path $root "packages"),(Join-Path $root "apps") -Directory) {
  $path = Join-Path $directory.FullName "package.json"
  if (Test-Path $path) {
    $manifest = Get-Content -Raw $path | ConvertFrom-Json
    $definitions[$manifest.name] = @{ root = $directory.FullName; manifest = $manifest }
  }
}
$selected = [System.Collections.Generic.HashSet[string]]::new()
$pending = [System.Collections.Generic.Queue[string]]::new()
foreach ($name in @("@potential-guide/pguide-task-bundle", "@potential-guide/task-engine-server", "@potential-guide/task-engine-http", "@potential-guide/task-engine")) { $pending.Enqueue($name) }
while ($pending.Count) {
  $name = $pending.Dequeue()
  if (-not $selected.Add($name)) { continue }
  if (-not $definitions.ContainsKey($name)) { throw "缺少内部包：$name" }
  $manifest = $definitions[$name].manifest
  foreach ($field in @("dependencies", "optionalDependencies")) {
    if ($manifest.$field) {
      foreach ($property in $manifest.$field.psobject.Properties) {
        if ([string]$property.Value -like "workspace:*") { $pending.Enqueue($property.Name) }
      }
    }
  }
}
$packDirectory = Join-Path $RunDirectory "packages"
New-Item -ItemType Directory -Path $packDirectory | Out-Null
$archives = @()
$overrides = [ordered]@{}
foreach ($name in ($selected | Sort-Object)) {
  if ($name -eq "@potential-guide/ipfs-content") { throw "生产交付闭包不得包含 ipfs-content。" }
  $definition = $definitions[$name]
  $raw = pnpm --dir $definition.root pack --pack-destination $packDirectory --json 2>> (Join-Path $RunDirectory "pack.stderr.log")
  if ($LASTEXITCODE -ne 0) { throw "打包失败：$name" }
  $packed = ($raw -join "`n") | ConvertFrom-Json
  if ($packed.version -ne $definition.manifest.version) { throw "归档版本不一致。" }
  if ($packed.files.path -match "^src/") { throw "归档包含仓库源码。" }
  $overrides[$name] = ([System.Uri]::new($packed.filename)).AbsoluteUri
  $archives += [ordered]@{
    name = $name; version = $packed.version; file = [System.IO.Path]::GetFileName($packed.filename)
    bytes = (Get-Item $packed.filename).Length; sha256 = (Get-FileHash $packed.filename).Hash.ToLower()
  }
}
$author = Join-Path $RunDirectory "author"
$runtime = Join-Path $RunDirectory "runtime"
foreach ($item in @(
  @{ path = $author; entries = @("@potential-guide/pguide-task-bundle") },
  @{ path = $runtime; entries = @("@potential-guide/task-engine", "@potential-guide/task-engine-http", "@potential-guide/task-engine-server") }
)) {
  New-Item -ItemType Directory -Path $item.path | Out-Null
  $dependencies = [ordered]@{}
  foreach ($name in $item.entries) { $dependencies[$name] = $overrides[$name] }
  Write-JsonFile (Join-Path $item.path "package.json") ([ordered]@{ private = $true; type = "module"; dependencies = $dependencies })
  [System.IO.File]::WriteAllText((Join-Path $item.path "pnpm-workspace.yaml"), ("packages: []`noverrides: " + (ConvertTo-Json -InputObject $overrides -Compress) + "`n"), [System.Text.UTF8Encoding]::new($false))
  pnpm --dir $item.path install --prod --ignore-scripts --no-frozen-lockfile --reporter=append-only *> (Join-Path $item.path "install.log")
  if ($LASTEXITCODE -ne 0) { throw "隔离消费者安装失败。" }
}
Copy-Item (Join-Path $PSScriptRoot "Author.mjs") (Join-Path $author "author.mjs")
Push-Location $author
try {
  node .\author.mjs *> author.log
  if ($LASTEXITCODE -ne 0) { throw "离线作者交付失败。" }
} finally { Pop-Location }
Copy-Item (Join-Path $author "bundle.car") (Join-Path $runtime "bundle.car")
Copy-Item (Join-Path $author "author-proof.json") (Join-Path $runtime "author-proof.json")
Move-Item (Join-Path $author "node_modules") (Join-Path $author "author_modules")
Copy-Item (Join-Path $PSScriptRoot "Runtime.mjs") (Join-Path $runtime "runtime.mjs")
$ipfs = (Get-Command ipfs.exe).Source
$context = [ordered]@{
  candidateCommit = $CandidateCommit; packagedFromCommit = (git rev-parse HEAD)
  deploymentContractRevision = $DeploymentRevision; packageManager = (pnpm --version)
  ipfsExecutable = $ipfs; ipfsBinarySha256 = (Get-FileHash $ipfs).Hash.ToLower(); archives = $archives
  authorLockSha256 = (Get-FileHash (Join-Path $author "pnpm-lock.yaml")).Hash.ToLower()
  runtimeLockSha256 = (Get-FileHash (Join-Path $runtime "pnpm-lock.yaml")).Hash.ToLower()
}
Write-JsonFile (Join-Path $runtime "context.json") $context
Push-Location $runtime
try {
  node .\runtime.mjs .\context.json *> runtime.log
  if ($LASTEXITCODE -ne 0) { throw "独立运行消费者验证失败，检查 runtime.log 与 delivery-result.json。" }
} finally { Pop-Location }
Write-Output ("RUN_DIRECTORY=" + $RunDirectory)
Get-Content -Raw (Join-Path $runtime "delivery-result.json") | ConvertFrom-Json | Select-Object complete,@{Name="cid";Expression={$_.author.cid}},@{Name="cases";Expression={$_.cases.Count}}
