#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

VERSION="${1:-$(node -p "require('./transit/manifest.json').version")}"
TAG="v${VERSION#v}"

FOUND=0
for _ in $(seq 1 30); do
  if gh release view "${TAG}" >/dev/null 2>&1; then FOUND=1; break; fi
  sleep 10
done
if [ "${FOUND}" != "1" ]; then
  echo "❌ GitHub Release ${TAG} 5 分鐘內沒有出現,稍後手動執行:tools/release/sync-dist.sh ${TAG}"
  exit 1
fi

rm -rf dist
mkdir -p dist
gh release download "${TAG}" --dir dist --pattern '*'
gh release download "${TAG}" --dir dist --archive=zip

echo ""
echo "dist/ 已同步為 ${TAG}:"
ls -lh dist
