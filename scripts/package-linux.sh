#!/bin/bash
set -euo pipefail

PKG_DIR="${1:-ClinicRecords-Linux-x64}"

echo "Packaging Linux bundle for $PKG_DIR..."

mkdir -p "$PKG_DIR/data" "$PKG_DIR/backups" "$PKG_DIR/storage/patients" "$PKG_DIR/runtime/bin"

# Download standalone Node.js binary for Linux (Node 22 LTS)
curl -fsSL "https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.gz" | tar -xz
cp node-v22.14.0-linux-x64/bin/node "$PKG_DIR/runtime/bin/node"
chmod +x "$PKG_DIR/runtime/bin/node"
rm -rf node-v22.14.0-linux-x64

# Copy application files
cp -r dist "$PKG_DIR/"
cp -r public "$PKG_DIR/"
mkdir -p "$PKG_DIR/node_modules"
cp -r node_modules/better-sqlite3 "$PKG_DIR/node_modules/"
if [ -d "node_modules/node-addon-api" ]; then
    cp -r node_modules/node-addon-api "$PKG_DIR/node_modules/"
fi
# Strip non-essential test and benchmark files
find "$PKG_DIR/node_modules" -type d \( -name "test" -o -name "tests" -o -name "benchmark" -o -name "examples" -o -name ".github" \) -exec rm -rf {} + 2>/dev/null || true
find "$PKG_DIR/node_modules" -type f \( -name "*.md" -o -name "*.txt" -o -name "eslint.config.js" \) ! -name "LICENSE" -delete 2>/dev/null || true
cp package.json start.sh README.md "$PKG_DIR/"
cp scripts/instructions/linux.txt "$PKG_DIR/تعليمات_التشغيل.txt"
chmod +x "$PKG_DIR/start.sh"

touch "$PKG_DIR/data/.gitkeep"
touch "$PKG_DIR/backups/.gitkeep"
touch "$PKG_DIR/storage/patients/.gitkeep"

VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "")
if [ -n "$VERSION" ]; then
    TAR_NAME="ClinicRecords-v${VERSION}-Linux-x64.tar.gz"
else
    TAR_NAME="${PKG_DIR}.tar.gz"
fi

tar -czf "$TAR_NAME" "$PKG_DIR"
if [ "$TAR_NAME" != "${PKG_DIR}.tar.gz" ]; then
    cp "$TAR_NAME" "${PKG_DIR}.tar.gz"
fi
echo "Linux package created: $TAR_NAME (and ${PKG_DIR}.tar.gz)"
