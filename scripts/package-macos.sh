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

mkdir -p "$MACOS_BIN" "$CONTENTS/Resources" "$PKG_NAME/data" "$PKG_NAME/backups" "$PKG_NAME/storage/patients" "$RESOURCES/runtime/bin"

# Download standalone Node.js binary for this architecture (Node 22 LTS)
curl -fsSL "https://nodejs.org/dist/v22.14.0/node-v22.14.0-${ARCH}.tar.gz" | tar -xz
cp "node-v22.14.0-${ARCH}/bin/node" "$RESOURCES/runtime/bin/node"
chmod +x "$RESOURCES/runtime/bin/node"
rm -rf "node-v22.14.0-${ARCH}"

# Copy application files into app bundle
cp -r dist "$RESOURCES/"
cp -r public "$RESOURCES/"
mkdir -p "$RESOURCES/node_modules"
cp -r node_modules/better-sqlite3 "$RESOURCES/node_modules/"
if [ -d "node_modules/node-addon-api" ]; then
    cp -r node_modules/node-addon-api "$RESOURCES/node_modules/"
fi
# Clean up any non-essential test, benchmark, or doc files
find "$RESOURCES/node_modules" -type d \( -name "test" -o -name "tests" -o -name "benchmark" -o -name "examples" -o -name ".github" \) -exec rm -rf {} + 2>/dev/null || true
find "$RESOURCES/node_modules" -type f \( -name "*.md" -o -name "*.txt" -o -name "eslint.config.js" \) ! -name "LICENSE" -delete 2>/dev/null || true
cp package.json "$RESOURCES/"

# Copy icon
if [ -f "assets/AppIcon.icns" ]; then
    cp assets/AppIcon.icns "$CONTENTS/Resources/AppIcon.icns"
fi

APP_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "1.0.0")

# Create Info.plist with icon binding
cat << EOF > "$CONTENTS/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>Clinic Records</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>io.github.clinicrecords.app</string>
    <key>CFBundleName</key>
    <string>Clinic Records</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${APP_VERSION}</string>
    <key>LSMinimumSystemVersion</key>
    <string>${MIN_OS}</string>
</dict>
</plist>
EOF

# Compile native Swift Cocoa companion launcher
if [ "$ARCH" = "darwin-arm64" ]; then
    SWIFT_TARGET="arm64-apple-macos${MIN_OS}"
else
    SWIFT_TARGET="x86_64-apple-macos${MIN_OS}"
fi

echo "Compiling native Cocoa companion launcher ($SWIFT_TARGET)..."
swiftc -O -target "$SWIFT_TARGET" scripts/macos-launcher/main.swift -o "$MACOS_BIN/Clinic Records"
chmod +x "$MACOS_BIN/Clinic Records"

# Copy single clean Arabic instructions
cp scripts/instructions/macos.txt "$PKG_NAME/تعليمات_التشغيل.txt"

# Console debug launcher for advanced troubleshooting
cat << 'EOF' > "$PKG_NAME/start-debug.command"
#!/bin/bash
cd "$(dirname "$0")"
echo "Starting Clinic Patient Records with console output..."
echo ""
exec "./Clinic Records.app/Contents/Resources/app/runtime/bin/node" "./Clinic Records.app/Contents/Resources/app/dist/server.js"
EOF
chmod +x "$PKG_NAME/start-debug.command"

touch "$PKG_NAME/data/.gitkeep"
touch "$PKG_NAME/backups/.gitkeep"
if [ -n "$APP_VERSION" ]; then
    SUFFIX=$(echo "$PKG_NAME" | sed 's/^ClinicRecords-//')
    ZIP_NAME="ClinicRecords-v${APP_VERSION}-${SUFFIX}.zip"
else
    ZIP_NAME="${PKG_NAME}.zip"
fi

zip -r "$ZIP_NAME" "$PKG_NAME"
# Also keep canonical zip for script backwards-compatibility if different
if [ "$ZIP_NAME" != "${PKG_NAME}.zip" ]; then
    cp "$ZIP_NAME" "${PKG_NAME}.zip"
fi
echo "macOS package created: $ZIP_NAME (and ${PKG_NAME}.zip)"
