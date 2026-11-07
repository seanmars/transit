#Requires -Version 7
param(
  [string]$Message
)

$ErrorActionPreference = 'Stop'

function Assert-ExitCode {
  param([string]$ErrorMessage)
  if ($LASTEXITCODE -ne 0) { throw $ErrorMessage }
}

# 回傳去掉最後一段的版本號,例如 0.1.0 -> 0.1。行為同 bash 的 ${VERSION%.*}。
function Get-VersionPrefix {
  param([string]$Version)
  $index = $Version.LastIndexOf('.')
  if ($index -lt 0) { return $Version }
  return $Version.Substring(0, $index)
}

function Invoke-Release {
  param([string]$Message)

  $releaseBranch = if ($env:RELEASE_BRANCH) { $env:RELEASE_BRANCH } else { 'main' }
  $version = (Get-Content 'transit/manifest.json' -Raw | ConvertFrom-Json).version
  $tag = "v$version"
  if (-not $Message) { $Message = $tag }

  $branch = git rev-parse --abbrev-ref HEAD
  Assert-ExitCode '無法取得目前的 branch。'
  if ($branch -ne $releaseBranch) {
    throw "目前在 ${branch},release 只能在 ${releaseBranch} 執行(可用 RELEASE_BRANCH 覆寫)。"
  }

  git rev-parse -q --verify "refs/tags/$tag" *> $null
  if ($LASTEXITCODE -eq 0) {
    throw "本機已有 tag ${tag}。請先更新 transit/manifest.json 的 version。"
  }
  git ls-remote --exit-code --tags origin "refs/tags/$tag" *> $null
  if ($LASTEXITCODE -eq 0) {
    throw "遠端已有 tag ${tag}。請先更新 transit/manifest.json 的 version。"
  }

  Write-Host '==> pnpm run check'
  pnpm run check
  Assert-ExitCode 'pnpm run check 失敗。'

  if ($env:SKIP_TESTS -eq '1') {
    Write-Host '⚠️  SKIP_TESTS=1,跳過測試。'
  } elseif (Test-Path 'test' -PathType Container) {
    Write-Host '==> pnpm run test:all'
    pnpm run test:all
    Assert-ExitCode 'pnpm run test:all 失敗。'
  } else {
    Write-Host '⚠️  找不到 test/ 目錄,跳過測試。'
  }

  $prevTag = git describe --tags --abbrev=0 2>$null
  if ($LASTEXITCODE -ne 0) { $prevTag = '' }
  $prevVersion = "$prevTag".TrimStart('v')
  if ($prevVersion -and (Get-VersionPrefix $version) -ne (Get-VersionPrefix $prevVersion)) {
    Write-Host ''
    Write-Host "⚠️  Major / Minor 版本變更(${prevTag} → ${tag}),使用者更新後會看到「歡迎升級」提示。"
    Write-Host '   請確認 transit/lib/release-highlights.js 的 RELEASE_HIGHLIGHT_KEYS,'
    Write-Host '   以及 transit/lib/i18n.js 8 個語系的 popup.banner.hl.* 字串。'
    if ([Console]::IsInputRedirected) {
      Write-Host '   (非互動模式,略過確認)'
    } else {
      Read-Host '   按 Enter 繼續,按 Ctrl+C 中止 ...' | Out-Null
    }
  }

  $dirty = git status --porcelain
  Assert-ExitCode '無法取得 git status。'
  if ($dirty) {
    git add -A
    Assert-ExitCode 'git add 失敗。'
    git commit -m "$tag — $Message"
    Assert-ExitCode 'git commit 失敗。'
  }
  git tag -a $tag -m "$tag — $Message"
  Assert-ExitCode "建立 tag $tag 失敗。"

  git push origin $branch
  if ($LASTEXITCODE -ne 0) {
    throw (@(
        "push $branch 失敗。本機已建立 tag ${tag},尚未推送。"
        "   處理方式:git pull --rebase origin $branch && git tag -f -a $tag -m `"$tag — $Message`" && git push origin $branch $tag"
      ) -join "`n")
  }
  git push origin $tag
  Assert-ExitCode "push tag $tag 失敗,GitHub Actions 不會建立 Release。請手動執行:git push origin $tag"

  Write-Host ''
  Write-Host '==> 同步 GitHub Release 資產到 dist/'
  & (Join-Path $PSScriptRoot 'sync-dist.ps1') $tag
  if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  dist 同步失敗,稍後手動執行:tools/release/sync-dist.ps1 $tag"
  }

  Write-Host ''
  Write-Host "$tag 已推送。Release:https://github.com/seanmars/transit/releases/tag/$tag"
}

$exitCode = 0
Push-Location (Join-Path $PSScriptRoot '../..')
try {
  Invoke-Release -Message $Message
} catch {
  Write-Host "❌ $($_.Exception.Message)"
  $exitCode = 1
} finally {
  Pop-Location
}
exit $exitCode
