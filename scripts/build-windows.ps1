$pkgDir = "ClinicRecords-Windows-x64"
New-Item -ItemType Directory -Force -Path "$pkgDir"
New-Item -ItemType Directory -Force -Path "$pkgDir/runtime"
New-Item -ItemType Directory -Force -Path "$pkgDir/data"
New-Item -ItemType Directory -Force -Path "$pkgDir/backups"
New-Item -ItemType Directory -Force -Path "$pkgDir/storage/patients"

# Download official standalone Node.js binary
Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.18.0/win-x64/node.exe" -OutFile "$pkgDir/runtime/node.exe"

# Copy application files
Copy-Item -Recurse -Force "dist" "$pkgDir/dist"
Copy-Item -Recurse -Force "public" "$pkgDir/public"
Copy-Item -Recurse -Force "node_modules" "$pkgDir/node_modules"
Copy-Item -Force "package.json" "$pkgDir/"
Copy-Item -Force "start.bat" "$pkgDir/"
Copy-Item -Force "start.bat" "$pkgDir/start-debug.bat"
Copy-Item -Force "scripts/instructions/windows.txt" "$pkgDir/تعليمات_التشغيل_ويندوز.txt"
Copy-Item -Force "scripts/instructions/windows.txt" "$pkgDir/INSTRUCTIONS.txt"
Copy-Item -Force "README.md" "$pkgDir/"

# Compile native Windows GUI Launcher "Clinic Records.exe"
$source = @'
using System;
using System.Diagnostics;
using System.IO;

class Program {
    static void Main() {
        string appDir = AppDomain.CurrentDomain.BaseDirectory;
        string nodePath = Path.Combine(appDir, "runtime", "node.exe");
        string scriptPath = Path.Combine(appDir, "dist", "server.js");

        if (!File.Exists(nodePath)) {
            nodePath = "node";
        }

        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = nodePath;
        psi.Arguments = "\"" + scriptPath + "\"";
        psi.WorkingDirectory = appDir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        Process.Start(psi);
    }
}
'@

Set-Content -Path "launcher.cs" -Value $source
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (Test-Path $csc) {
    & $csc /nologo /target:winexe /out:"$pkgDir\Clinic Records.exe" launcher.cs
} else {
    csc /nologo /target:winexe /out:"$pkgDir\Clinic Records.exe" launcher.cs
}
Remove-Item -Force "launcher.cs"

# Create empty keep files
New-Item -ItemType File -Force -Path "$pkgDir/data/.gitkeep"
New-Item -ItemType File -Force -Path "$pkgDir/backups/.gitkeep"
New-Item -ItemType File -Force -Path "$pkgDir/storage/patients/.gitkeep"

# Compress to zip
Compress-Archive -Path "$pkgDir" -DestinationPath "ClinicRecords-Windows-x64.zip" -Force
Write-Host "Windows package created successfully: ClinicRecords-Windows-x64.zip"
