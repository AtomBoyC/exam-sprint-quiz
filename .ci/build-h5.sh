#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="$ROOT_DIR/.ci/h5-builder"

echo "==> Preparing uni-app Vue 3 Vite builder in $WORK_DIR ..."
if [ ! -f "$WORK_DIR/package.json" ]; then
  rm -rf "$WORK_DIR"
  git clone --depth 1 -b vite https://github.com/dcloudio/uni-preset-vue.git "$WORK_DIR"
fi

echo "==> Syncing uni-app root sources into $WORK_DIR/src ..."
rm -rf "$WORK_DIR/src"
mkdir -p "$WORK_DIR/src"

for item in App.vue main.js manifest.json pages.json uni.scss pages utils static; do
  if [ -e "$ROOT_DIR/$item" ]; then
    cp -R "$ROOT_DIR/$item" "$WORK_DIR/src/"
  fi
done

cd "$WORK_DIR"
if [ ! -d "node_modules" ]; then
  echo "==> Installing official uni-app Vite dependencies ..."
  npm install --legacy-peer-deps
  npm install -D sass --legacy-peer-deps
fi

echo "==> Building H5 Web / Desktop bundle ..."
npm run build:h5

OUT_DIR="$WORK_DIR/dist/build/h5"

# Inject PWA Web App Manifest for mobile "Add to Home Screen"
cat > "$OUT_DIR/manifest.webmanifest" <<'EOF'
{
  "name": "极速刷题宝",
  "short_name": "极速刷题",
  "description": "全平台离线优先 + 云端同步智能题库刷题助手",
  "start_url": "./index.html",
  "display": "standalone",
  "background_color": "#F4F6FB",
  "theme_color": "#2563EB",
  "icons": [
    {
      "src": "./static/logo.png",
      "sizes": "256x256",
      "type": "image/png"
    }
  ]
}
EOF

# Also include standalone zero-build edition under /lite/ for instant offline fallback
if [ -d "$ROOT_DIR/standalone-html" ]; then
  mkdir -p "$OUT_DIR/lite"
  cp -R "$ROOT_DIR/standalone-html/index.html" "$ROOT_DIR/standalone-html/css" "$OUT_DIR/lite/"
  mkdir -p "$OUT_DIR/lite/js"
  for jsf in zip-reader.js parser.js storage.js app.js; do
    if [ -f "$ROOT_DIR/standalone-html/js/$jsf" ]; then
      cp "$ROOT_DIR/standalone-html/js/$jsf" "$OUT_DIR/lite/js/"
    fi
  done
fi

echo "==> Build complete: $OUT_DIR"
