$pkgDir = "ClinicRecords-Windows-x64"
$appResDir = "$pkgDir/resources"

New-Item -ItemType Directory -Force -Path "$pkgDir"
New-Item -ItemType Directory -Force -Path "$appResDir/runtime"
New-Item -ItemType Directory -Force -Path "$pkgDir/data"
New-Item -ItemType Directory -Force -Path "$pkgDir/backups"
New-Item -ItemType Directory -Force -Path "$pkgDir/storage/patients"

# Download official standalone Node.js binary (Node 22 LTS with native ESM require support)
Invoke-WebRequest -Uri "https://nodejs.org/dist/v22.14.0/win-x64/node.exe" -OutFile "$appResDir/runtime/node.exe"

# Copy internal application files into resources
Copy-Item -Recurse -Force "dist" "$appResDir/dist"
Copy-Item -Recurse -Force "public" "$appResDir/public"
Copy-Item -Recurse -Force "node_modules" "$appResDir/node_modules"
Copy-Item -Force "package.json" "$appResDir/"

# Copy single clean Arabic instructions
Copy-Item -Force "scripts/instructions/windows.txt" "$pkgDir/تعليمات_التشغيل.txt"

# Console debug launcher for advanced troubleshooting
$debugBat = @"
@echo off
chcp 65001 > nul
echo =============================================================
echo   Starting Clinic Patient Records Console Debugger
echo =============================================================
echo.
resources\runtime\node.exe resources\dist\server.js
pause
"@
Set-Content -Path "$pkgDir/start-debug.bat" -Value $debugBat -Encoding utf8

# Compile native Windows GUI Companion Launcher "Clinic Records.exe"
# Embed icon directly into the PE binary resources from assets/AppIcon.ico
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$iconParam = if (Test-Path "assets/AppIcon.ico") { "/win32icon:assets\AppIcon.ico" } else { "" }

$cscArgs = @(
    "/nologo",
    "/target:winexe",
    $iconParam,
    "/r:System.Windows.Forms.dll,System.Drawing.dll,System.Net.Http.dll,System.Core.dll",
    "/out:$pkgDir\Clinic Records.exe",
    "scripts\windows-launcher\Program.cs"
) | Where-Object { $_ -ne "" }

Write-Host "Compiling Windows companion app with csc.exe..."
if (Test-Path $csc) {
    & $csc $cscArgs
} else {
    csc $cscArgs
}
if ($LASTEXITCODE -ne 0) {
    throw "csc.exe compilation failed with exit code $LASTEXITCODE"
}

# Create empty keep files
New-Item -ItemType File -Force -Path "$pkgDir/data/.gitkeep"
New-Item -ItemType File -Force -Path "$pkgDir/backups/.gitkeep"
New-Item -ItemType File -Force -Path "$pkgDir/storage/patients/.gitkeep"

# Compress to zip
Compress-Archive -Path "$pkgDir" -DestinationPath "ClinicRecords-Windows-x64.zip" -Force
Write-Host "Windows package created successfully: ClinicRecords-Windows-x64.zip"
