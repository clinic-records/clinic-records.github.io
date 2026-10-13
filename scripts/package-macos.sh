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
cp -r node_modules "$RESOURCES/"
cp package.json "$RESOURCES/"

# Copy icon
if [ -f "assets/AppIcon.icns" ]; then
    cp assets/AppIcon.icns "$CONTENTS/Resources/AppIcon.icns"
fi

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
    <string>1.0.5</string>
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
touch "$PKG_NAME/storage/patients/.gitkeep"

zip -r "${PKG_NAME}.zip" "$PKG_NAME"
echo "macOS package created: ${PKG_NAME}.zip"
