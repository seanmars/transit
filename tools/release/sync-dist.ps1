#Requires -Version 7
param(
  [string]$Version
)

$ErrorActionPreference = 'Stop'

function Invoke-SyncDist {
  param([string]$Version)

  if (-not $Version) {
    $Version = (Get-Content 'transit/manifest.json' -Raw | ConvertFrom-Json).version
  }
  $tag = "v$($Version.TrimStart('v'))"

  $found = $false
  for ($i = 0; $i -lt 30; $i++) {
    gh release view $tag *> $null
    if ($LASTEXITCODE -eq 0) {
      $found = $true
      break
    }
    Start-Sleep -Seconds 10
  }
  if (-not $found) {
    throw "GitHub Release $tag 5 分鐘內沒有出現,稍後手動執行:tools/release/sync-dist.ps1 $tag"
  }

  if (Test-Path 'dist') {
    Remove-Item 'dist' -Recurse -Force
  }
  New-Item -ItemType Directory 'dist' | Out-Null

  gh release download $tag --dir dist --pattern '*'
  if ($LASTEXITCODE -ne 0) { throw "下載 $tag 的 Release 資產失敗。" }
  gh release download $tag --dir dist --archive=zip
  if ($LASTEXITCODE -ne 0) { throw "下載 $tag 的原始碼壓縮檔失敗。" }

  Write-Host ''
  Write-Host "dist/ 已同步為 ${tag}:"
  Get-ChildItem 'dist' | Format-Table Name, @{ Name = 'Size(MB)'; Expression = { [math]::Round($_.Length / 1MB, 1) } } -AutoSize
}

$exitCode = 0
Push-Location (Join-Path $PSScriptRoot '../..')
try {
  Invoke-SyncDist -Version $Version
} catch {
  Write-Host "❌ $($_.Exception.Message)"
  $exitCode = 1
} finally {
  Pop-Location
}
exit $exitCode
