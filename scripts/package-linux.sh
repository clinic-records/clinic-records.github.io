#!/bin/bash
set -euo pipefail

PKG_DIR="${1:-ClinicRecords-Linux-x64}"

echo "Packaging Linux bundle for $PKG_DIR..."

mkdir -p "$PKG_DIR/data" "$PKG_DIR/backups" "$PKG_DIR/storage/patients" "$PKG_DIR/runtime/bin"

# Download standalone Node.js binary for Linux
curl -fsSL "https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.gz" | tar -xz
cp node-v20.18.0-linux-x64/bin/node "$PKG_DIR/runtime/bin/node"
chmod +x "$PKG_DIR/runtime/bin/node"
rm -rf node-v20.18.0-linux-x64

# Copy application files
cp -r dist "$PKG_DIR/"
cp -r public "$PKG_DIR/"
cp -r node_modules "$PKG_DIR/"
cp package.json start.sh README.md "$PKG_DIR/"
cp scripts/instructions/linux.txt "$PKG_DIR/تعليمات_التشغيل_لينكس.txt"
cp scripts/instructions/linux.txt "$PKG_DIR/INSTRUCTIONS.txt"
chmod +x "$PKG_DIR/start.sh"

touch "$PKG_DIR/data/.gitkeep"
touch "$PKG_DIR/backups/.gitkeep"
touch "$PKG_DIR/storage/patients/.gitkeep"

tar -czf "${PKG_DIR}.tar.gz" "$PKG_DIR"
echo "Linux package created: ${PKG_DIR}.tar.gz"
