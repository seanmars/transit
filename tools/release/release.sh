#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

RELEASE_BRANCH="${RELEASE_BRANCH:-main}"
VERSION="$(node -p "require('./transit/manifest.json').version")"
TAG="v${VERSION}"
MSG="${1:-${TAG}}"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "${BRANCH}" != "${RELEASE_BRANCH}" ]; then
  echo "❌ 目前在 ${BRANCH},release 只能在 ${RELEASE_BRANCH} 執行(可用 RELEASE_BRANCH 覆寫)。"
  exit 1
fi

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  echo "❌ 本機已有 tag ${TAG}。請先更新 transit/manifest.json 的 version。"
  exit 1
fi
if git ls-remote --exit-code --tags origin "refs/tags/${TAG}" >/dev/null 2>&1; then
  echo "❌ 遠端已有 tag ${TAG}。請先更新 transit/manifest.json 的 version。"
  exit 1
fi

echo "==> pnpm run check"
pnpm run check

if [ "${SKIP_TESTS:-0}" = "1" ]; then
  echo "⚠️  SKIP_TESTS=1,跳過測試。"
elif [ -d test ]; then
  echo "==> pnpm run test:all"
  pnpm run test:all
else
  echo "⚠️  找不到 test/ 目錄,跳過測試。"
fi

PREV_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"
PREV_VER="${PREV_TAG#v}"
if [ -n "${PREV_VER}" ] && [ "${VERSION%.*}" != "${PREV_VER%.*}" ]; then
  echo ""
  echo "⚠️  Major / Minor 版本變更(${PREV_TAG} → ${TAG}),使用者更新後會看到「歡迎升級」提示。"
  echo "   請確認 transit/lib/release-highlights.js 的 RELEASE_HIGHLIGHT_KEYS,"
  echo "   以及 transit/lib/i18n.js 8 個語系的 popup.banner.hl.* 字串。"
  if [ -t 0 ]; then
    read -r -p "   按 Enter 繼續,按 Ctrl+C 中止 ... " _
  else
    echo "   (非互動模式,略過確認)"
  fi
fi

if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -m "${TAG} — ${MSG}"
fi
git tag -a "${TAG}" -m "${TAG} — ${MSG}"

if ! git push origin "${BRANCH}"; then
  echo "❌ push ${BRANCH} 失敗。本機已建立 tag ${TAG},尚未推送。"
  echo "   處理方式:git pull --rebase origin ${BRANCH} && git tag -f -a ${TAG} -m \"${TAG} — ${MSG}\" && git push origin ${BRANCH} ${TAG}"
  exit 1
fi
if ! git push origin "${TAG}"; then
  echo "❌ push tag ${TAG} 失敗,GitHub Actions 不會建立 Release。請手動執行:git push origin ${TAG}"
  exit 1
fi

echo ""
echo "==> 同步 GitHub Release 資產到 dist/"
./tools/release/sync-dist.sh "${TAG}" || echo "⚠️  dist 同步失敗,稍後手動執行:tools/release/sync-dist.sh ${TAG}"

echo ""
echo "${TAG} 已推送。Release:https://github.com/seanmars/transit/releases/tag/${TAG}"
