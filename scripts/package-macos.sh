#!/bin/bash
set -euo pipefail

PKG_NAME="${1:-ClinicRecords-macOS-AppleSilicon}"
ARCH="${2:-darwin-arm64}"
MIN_OS="${3:-11.0}"

echo "Packaging macOS bundle for $PKG_NAME ($ARCH)..."

APP_DIR="$PKG_NAME/Clinic Records.app"
CONTENTS="$APP_DIR/Contents"
RESOURCES="$CONTENTS/Resources/app"
MACOS_BIN="$CONTENTS/MacOS"

mkdir -p "$MACOS_BIN" "$PKG_NAME/data" "$PKG_NAME/backups" "$PKG_NAME/storage/patients" "$RESOURCES/runtime/bin"

# Download standalone Node.js binary for this architecture
curl -fsSL "https://nodejs.org/dist/v20.18.0/node-v20.18.0-${ARCH}.tar.gz" | tar -xz
cp "node-v20.18.0-${ARCH}/bin/node" "$RESOURCES/runtime/bin/node"
chmod +x "$RESOURCES/runtime/bin/node"
rm -rf "node-v20.18.0-${ARCH}"

# Copy application files into app bundle
cp -r dist "$RESOURCES/"
cp -r public "$RESOURCES/"
cp -r node_modules "$RESOURCES/"
cp package.json "$RESOURCES/"

# Create Info.plist
cat << EOF > "$CONTENTS/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>Clinic Records</string>
    <key>CFBundleIdentifier</key>
    <string>io.github.clinicrecords.app</string>
    <key>CFBundleName</key>
    <string>Clinic Records</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>${MIN_OS}</string>
</dict>
</plist>
EOF

# Create launch executable
cat << 'EOF' > "$MACOS_BIN/Clinic Records"
#!/bin/bash
APP_DIR="$(cd "$(dirname "$0")/../Resources/app" && pwd)"
CONTAINER_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"

if [ "$CONTAINER_DIR" = "/Applications" ] || [ ! -w "$CONTAINER_DIR" ]; then
    DATA_ROOT="$HOME/Library/Application Support/ClinicRecords"
    mkdir -p "$DATA_ROOT"
    cd "$DATA_ROOT"
else
    cd "$CONTAINER_DIR"
fi

mkdir -p data backups storage/patients
exec "$APP_DIR/runtime/bin/node" "$APP_DIR/dist/server.js"
EOF
chmod +x "$MACOS_BIN/Clinic Records"

# Copy instructions and debug launcher
cp INSTRUCTIONS.txt "$PKG_NAME/"
cp start.command "$PKG_NAME/start-debug.command"
chmod +x "$PKG_NAME/start-debug.command"

touch "$PKG_NAME/data/.gitkeep"
touch "$PKG_NAME/backups/.gitkeep"
touch "$PKG_NAME/storage/patients/.gitkeep"

zip -r "${PKG_NAME}.zip" "$PKG_NAME"
echo "macOS package created: ${PKG_NAME}.zip"
