#!/usr/bin/env bash
# 用无头 Chromium 浏览器将 4 张宣传页截图导出为严格 1280×800 PNG
# 用法：bash export-images.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/png"
PROFILE="$(mktemp -d)/edge-profile"
mkdir -p "$OUT"

BROWSER=""
for b in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"; do
  if [ -x "$b" ]; then BROWSER="$b"; break; fi
done
if [ -z "$BROWSER" ]; then
  echo "未找到 Chromium 内核浏览器，请先安装 Chrome / Edge / Chromium 后重试。" >&2
  exit 1
fi
echo "使用浏览器：$BROWSER"

PAGES=(
  "01-one-click-solve.html"
  "02-dual-engine.html"
  "03-streaming-thinking.html"
  "04-privacy-local.html"
)

for p in "${PAGES[@]}"; do
  name="${p%.html}"
  echo "导出 $name ..."
  "$BROWSER" --headless --no-sandbox --disable-gpu --disable-crash-reporter \
    --use-mock-keychain --disable-dev-shm-usage --disable-component-update \
    --disable-background-networking --hide-scrollbars \
    --force-device-scale-factor=1 --user-data-dir="$PROFILE" \
    --window-size=1280,800 --virtual-time-budget=3000 \
    --screenshot="$OUT/$name.png" "file://$DIR/$p" >/dev/null 2>&1 &
  local_pid=$!
  # 等待 PNG 生成（最多 20 秒），随后主动结束浏览器进程
  for i in $(seq 1 40); do
    [ -f "$OUT/$name.png" ] && break
    sleep 0.5
  done
  sleep 1
  kill "$local_pid" 2>/dev/null || true
  wait "$local_pid" 2>/dev/null || true
  [ -f "$OUT/$name.png" ] || { echo "失败：$name" >&2; exit 1; }
done

rm -rf "$(dirname "$PROFILE")"
echo "完成，输出目录：$OUT"
