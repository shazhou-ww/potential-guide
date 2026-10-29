param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{40}$')][string]$PlanRevision
)
$ErrorActionPreference = "Stop"
$repository = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw "必须从目标仓库运行验证" }
$repository = [IO.Path]::GetFullPath($repository)
$idea = ".silvermoon/ideas/01M63AFYJEDXZ8PFZQQVZC1W02"
$outer = Join-Path $repository ".silvermoon\ideas\01M63AFYJEDXZ8PFZQQVZC1W02\outer"
$acceptedInner = "51adbc160975b8287373ddc8eca0e27abb74a95a"
$acceptedIdeal = "23bf1b89e48571b18d746dc4184ef448209b9ac3"
$inner = (& git rev-parse "HEAD:$idea/outer/inner").Trim()
$ideal = (& git rev-parse "HEAD:$idea/outer/inner/ideal").Trim()
$observedPlan = (& git rev-parse "HEAD:$idea/outer").Trim()
if ($inner -ne $acceptedInner -or $ideal -ne $acceptedIdeal -or $observedPlan -ne $PlanRevision) {
  throw "验收树或已同步部署合同不匹配"
}
& git diff --quiet HEAD -- "$idea/outer/verify" "$idea/outer/Deployment.md"
if ($LASTEXITCODE -ne 0) { throw "验证脚本/合同尚未同步到当前候选" }
$planCommit = (& git rev-parse HEAD).Trim()
& pnpm exec tsc -b packages\task-protocol packages\task-engine packages\task-engine-http packages\task-engine-storage --pretty false
if ($LASTEXITCODE -ne 0) { throw "准确源码构建失败" }
$operation = [Guid]::NewGuid().ToString("N")
$parent = Split-Path $repository -Parent
$consumerName = "potential-guide-consumer-$operation"
$consumer = Join-Path $parent $consumerName
$originalLocation = Get-Location
$originalNodePath = $env:NODE_PATH
$originalNodeOptions = $env:NODE_OPTIONS
$originalNpmConfig = $env:NPM_CONFIG_USERCONFIG
$report = [ordered]@{
  schemaVersion = 1
  planRevision = $PlanRevision
  planCommit = $planCommit
  acceptedInner = $acceptedInner
  acceptedIdeal = $acceptedIdeal
  operationId = $operation
  consumerRoot = $consumer
  startedAt = [DateTimeOffset]::UtcNow.ToString("o")
  packages = @()
  passed = $false
  cleanup = [ordered]@{ markerVerified = $false; consumerRemoved = $false }
}
$created = $false
try {
  Set-Location $parent
  New-Item -ItemType Directory -Path $consumerName | Out-Null
  $created = $true
  Set-Location $consumerName
  [IO.File]::WriteAllText((Join-Path (Get-Location) ".deployment-owner"), $operation)
  New-Item -ItemType Directory -Path "tarballs" | Out-Null
  Copy-Item (Join-Path $outer "verify\*.mjs") -Destination "."
  $env:NODE_PATH = $null
  $env:NODE_OPTIONS = $null
  $env:NPM_CONFIG_USERCONFIG = Join-Path $consumer ".npmrc"
  Set-Content -LiteralPath ".npmrc" -Value "" -Encoding utf8
  $dependencies = [ordered]@{}
  foreach ($name in @("task-protocol", "task-engine", "task-engine-http", "task-engine-storage")) {
    $packageRoot = Join-Path $repository "packages\$name"
    $destination = [IO.Path]::GetRelativePath($packageRoot, (Join-Path $consumer "tarballs"))
    $packedOutput = & pnpm --dir $packageRoot pack --pack-destination $destination --json
    if ($LASTEXITCODE -ne 0) { throw "打包失败: $name" }
    $packed = ($packedOutput -join "`n") | ConvertFrom-Json
    $archive = [IO.Path]::GetFullPath($packed.filename)
    if (-not $archive.StartsWith((Join-Path $consumer "tarballs"), [StringComparison]::OrdinalIgnoreCase)) {
      throw "打包路径越出本次消费者目录"
    }
    $digest = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    $dependencies[$packed.name] = ([Uri]$archive).AbsoluteUri
    $report.packages += [ordered]@{ name = $packed.name; version = $packed.version; file = (Split-Path $archive -Leaf); sha256 = $digest }
  }
  $manifest = [ordered]@{ name = "external-generic-task-verification"; private = $true; type = "module"; dependencies = $dependencies }
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "package.json" -Encoding utf8
  $overrides = $dependencies | ConvertTo-Json -Compress
  "packages: []`noverrides: $overrides`n" | Set-Content -LiteralPath "pnpm-workspace.yaml" -Encoding utf8
  & pnpm install --offline --ignore-scripts --no-frozen-lockfile --store-dir ".pnpm-store" --reporter=append-only *> "install.log"
  if ($LASTEXITCODE -ne 0) { throw "独立离线安装失败: $(Get-Content install.log -Tail 8 | Out-String)" }
  & node "suite.mjs" $repository $PlanRevision *> "verification.log"
  $suiteCode = $LASTEXITCODE
  if (Test-Path "consumer-result.json") {
    $report.consumer = Get-Content "consumer-result.json" -Raw | ConvertFrom-Json
  }
  $report.commandExitCode = $suiteCode
  if ($suiteCode -ne 0 -or -not $report.consumer.passed) {
    throw "独立验证失败: $(Get-Content verification.log -Tail 12 | Out-String)"
  }
  $report.passed = $true
} catch {
  $report.error = $_.Exception.Message
  $report.passed = $false
} finally {
  $env:NODE_PATH = $originalNodePath
  $env:NODE_OPTIONS = $originalNodeOptions
  $env:NPM_CONFIG_USERCONFIG = $originalNpmConfig
  Set-Location $originalLocation
  if ($created) {
    $marker = Join-Path $consumer ".deployment-owner"
    if ((Test-Path -LiteralPath $marker) -and
      ([IO.File]::ReadAllText($marker) -eq $operation) -and
      ((Split-Path $consumer -Parent) -eq $parent) -and
      ((Split-Path $consumer -Leaf) -eq $consumerName)) {
      $report.cleanup.markerVerified = $true
      Remove-Item -LiteralPath $consumer -Recurse -Force
      $report.cleanup.consumerRemoved = -not (Test-Path -LiteralPath $consumer)
    } else {
      $report.passed = $false
      $report.cleanup.error = "所有权 marker 不匹配，未删除任何目录"
    }
  }
  $report.completedAt = [DateTimeOffset]::UtcNow.ToString("o")
  $report | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $outer "verification-result.json") -Encoding utf8
}
& git diff --quiet HEAD -- packages "$idea/outer/inner"
if ($LASTEXITCODE -ne 0) { throw "发现验收实现变动：停止并交父代理处理" }
if (-not $report.passed -or -not $report.cleanup.consumerRemoved) { throw "验证未完成；见 outer/verification-result.json" }
Write-Output ("外部验证通过: {0} 项断言组；四包摘要和清理事实已保存。" -f $report.consumer.checks.Count)
