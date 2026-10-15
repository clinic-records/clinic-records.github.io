import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { ClinicDatabase } from '../db/database.js';
import { AppConfig } from '../config.js';

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName?: string;
  releaseNotes?: string;
  publishedAt?: string;
  htmlUrl?: string;
  assetUrl?: string;
  assetName?: string;
  assetSize?: number;
  error?: string;
}

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'downloading' | 'extracting' | 'ready' | 'error';
  progress: number;
  message: string;
  error?: string;
}

class SystemUpdater {
  private isUpdating = false;
  private status: UpdateStatus = {
    status: 'idle',
    progress: 0,
    message: '',
  };

  /**
   * Synchronously attempts to acquire update lock to eliminate race conditions
   */
  public acquireUpdateLock(): boolean {
    if (this.isUpdating || this.status.status === 'downloading' || this.status.status === 'extracting') {
      return false;
    }
    this.isUpdating = true;
    this.status = {
      status: 'downloading',
      progress: 2,
      message: 'جارٍ بدء تجهيز التحديث والتحقق من الحزم...',
    };
    return true;
  }

  /**
   * Releases the update lock in case of failure or completion
   */
  public releaseUpdateLock(errorMessage?: string): void {
    this.isUpdating = false;
    if (errorMessage) {
      this.status = {
        status: 'error',
        progress: 0,
        message: 'فشلت عملية التحديث',
        error: errorMessage,
      };
    } else {
      this.status = {
        status: 'idle',
        progress: 0,
        message: '',
      };
    }
  }

  /**
   * Reads current application version dynamically from package.json or macOS Info.plist
   */
  public getCurrentVersion(): string {
    const importMetaDir = path.dirname(new URL(import.meta.url).pathname);
    const candidates = [
      path.resolve(process.cwd(), 'package.json'),
      path.resolve(process.cwd(), 'resources', 'package.json'),
      path.resolve(importMetaDir, '..', 'package.json'),
      path.resolve(importMetaDir, '..', '..', 'package.json'),
      path.resolve(path.dirname(process.execPath), '..', '..', 'package.json'),
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
          if (pkg.version) {
            return pkg.version.startsWith('v') ? pkg.version : `v${pkg.version}`;
          }
        } catch { }
      }
    }

    // On macOS, also check adjacent Info.plist if running inside .app bundle
    if (process.platform === 'darwin') {
      const macBundle = this.getMacAppBundlePath();
      if (macBundle) {
        const plistPath = path.join(macBundle, 'Contents', 'Info.plist');
        if (fs.existsSync(plistPath)) {
          try {
            const plistContent = fs.readFileSync(plistPath, 'utf-8');
            const match = plistContent.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
            if (match && match[1]) {
              const v = match[1].trim();
              return v.startsWith('v') ? v : `v${v}`;
            }
          } catch { }
        }
      }
    }

    return 'v1.0.0';
  }

  public getStatus(): UpdateStatus {
    return { ...this.status };
  }

  /**
   * Queries GitHub Releases for the latest version and matches the platform asset
   */
  public async checkForUpdates(): Promise<UpdateInfo> {
    const currentVersion = this.getCurrentVersion();
    try {
      const response = await fetch(
        'https://api.github.com/repos/clinic-records/clinic-records.github.io/releases/latest',
        {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'ClinicRecords-Updater/1.0',
          },
        }
      );

      if (!response.ok) {
        return {
          hasUpdate: false,
          currentVersion,
          latestVersion: currentVersion,
          error: `GitHub API error: ${response.statusText}`,
        };
      }

      const release: any = await response.json();
      const latestVersion = release.tag_name || currentVersion;

      // Numeric semantic version comparison (e.g. v1.0.5 vs v1.0.4)
      const cleanCurrent = currentVersion.replace(/^v/, '');
      const cleanLatest = latestVersion.replace(/^v/, '');
      const hasUpdate =
        cleanLatest.localeCompare(cleanCurrent, undefined, { numeric: true }) > 0;

      // Find platform-matching release asset
      let matchedAsset: any = null;
      if (Array.isArray(release.assets)) {
        const platform = process.platform;
        const arch = process.arch;

        const isMac = (name: string) => name.includes('macos') || name.includes('darwin');
        const isWin = (name: string) => name.includes('windows') || name.includes('win32');
        const isLinux = (name: string) => name.includes('linux');

        if (platform === 'win32') {
          matchedAsset = release.assets.find((a: any) => {
            const n = a.name.toLowerCase();
            return isWin(n) && (n.includes('x64') || n.endsWith('.zip'));
          });
        } else if (platform === 'darwin') {
          if (arch === 'arm64') {
            matchedAsset = release.assets.find((a: any) => {
              const n = a.name.toLowerCase();
              return isMac(n) && (n.includes('applesilicon') || n.includes('arm64'));
            });
          } else {
            matchedAsset = release.assets.find((a: any) => {
              const n = a.name.toLowerCase();
              return isMac(n) && (n.includes('intel') || n.includes('x64'));
            });
          }
          // Safe fallback for mac only
          if (!matchedAsset) {
            matchedAsset = release.assets.find((a: any) => isMac(a.name.toLowerCase()) && a.name.endsWith('.zip'));
          }
        } else if (platform === 'linux') {
          matchedAsset = release.assets.find((a: any) => {
            const n = a.name.toLowerCase();
            return isLinux(n) && (n.endsWith('.tar.gz') || n.endsWith('.tgz'));
          });
        }

        if (!matchedAsset) {
          console.warn(`[Updater] No compatible release asset found for platform ${platform} (${arch})`);
        }
      }

      return {
        hasUpdate,
        currentVersion,
        latestVersion,
        releaseName: release.name || latestVersion,
        releaseNotes: release.body || '',
        publishedAt: release.published_at,
        htmlUrl: release.html_url,
        assetUrl: matchedAsset?.browser_download_url,
        assetName: matchedAsset?.name,
        assetSize: matchedAsset?.size,
      };
    } catch (err: any) {
      return {
        hasUpdate: false,
        currentVersion,
        latestVersion: currentVersion,
        error: err?.message || 'Check for updates failed',
      };
    }
  }

  /**
   * Executes full in-place auto update:
   * 1. Auto-backups database for security
   * 2. Downloads update archive with progress tracking
   * 3. Extracts to temp directory
   * 4. Spawns detached runner script
   * 5. Exits process gracefully
   */
  public async installUpdate(db: ClinicDatabase, config: AppConfig): Promise<{ success: boolean; message: string }> {
    // If lock was not acquired prior, try acquiring it now
    if (!this.isUpdating) {
      if (!this.acquireUpdateLock()) {
        throw new Error('عملية التحديث قيد التنفيذ بالفعل حالياً بواسطة مستخدم أو جهاز آخر.');
      }
    }

    const check = await this.checkForUpdates();
    if (!check.hasUpdate || !check.assetUrl) {
      this.releaseUpdateLock('لا يوجد تحديث متاح للتثبيت أو لم يتم العثور على حزمة النظام.');
      throw new Error('لا يوجد تحديث متاح للتثبيت أو لم يتم العثور على حزمة النظام.');
    }

    const tempBase = path.join(os.tmpdir(), `clinic_update_${Date.now()}`);
    fs.mkdirSync(tempBase, { recursive: true });

    try {
      // 1. Safety Pre-Update Database Backup
      this.status = {
        status: 'downloading',
        progress: 5,
        message: 'جارٍ أخذ نسخة احتياطية تأمينية من قاعدة البيانات...',
      };

      if (!fs.existsSync(config.backupPath)) {
        fs.mkdirSync(config.backupPath, { recursive: true });
      }
      const safetyBackupFile = path.join(
        config.backupPath,
        `pre_update_backup_${Date.now()}.db`
      );
      try {
        await db.backupDatabase(safetyBackupFile);
      } catch (e) {
        console.warn('Pre-update backup warning:', e);
      }

      // 2. Download Archive with Progress
      this.status = {
        status: 'downloading',
        progress: 10,
        message: 'جارٍ تنزيل ملف التحديث من الخادم...',
      };

      const assetName = check.assetName || 'update_package.zip';
      const downloadedFilePath = path.join(tempBase, assetName);

      const resp = await fetch(check.assetUrl, {
        headers: { 'User-Agent': 'ClinicRecords-Updater/1.0' },
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`فشل تنزيل ملف التحديث: ${resp.statusText}`);
      }

      const totalBytes = Number(resp.headers.get('content-length')) || check.assetSize || 0;
      let receivedBytes = 0;

      const fileStream = fs.createWriteStream(downloadedFilePath);
      const reader = resp.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          receivedBytes += value.length;
          fileStream.write(Buffer.from(value));

          if (totalBytes > 0) {
            const pct = 10 + Math.floor((receivedBytes / totalBytes) * 65);
            this.status.progress = Math.min(75, pct);
            this.status.message = `جارٍ تنزيل التحديث (${Math.round(receivedBytes / (1024 * 1024))}MB / ${Math.round(totalBytes / (1024 * 1024))}MB)...`;
          }
        }
      }

      await new Promise<void>((resolve, reject) => {
        fileStream.end((err?: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // 3. Extract Archive
      this.status = {
        status: 'extracting',
        progress: 80,
        message: 'جارٍ فك ضغط ملفات التحديث...',
      };

      const extractDir = path.join(tempBase, 'extracted');
      fs.mkdirSync(extractDir, { recursive: true });

      await this.extractArchive(downloadedFilePath, extractDir);

      this.status.progress = 90;
      this.status.message = 'جارٍ تجهيز استبدال ملفات البرنامج وإعادة التشغيل...';

      // 4. Locate package payload root
      const payloadRoot = this.findPayloadRoot(extractDir);
      const appRoot = this.getAppRootDirectory();

      // 5. Spawn detached runner script and schedule graceful exit
      this.spawnDetachedRunner(payloadRoot, appRoot, tempBase);

      this.status = {
        status: 'ready',
        progress: 100,
        message: 'تم تجهيز التحديث بنجاح! سيتم إغلاق البرنامج وإعادة تشغيله تلقائياً الآن...',
      };

      // Delay exit long enough for multiple client polling cycles to catch 'ready' status:
      // - C# UpdateProgressForm polls every 500ms
      // - Web browser polls every 600ms
      // - 4 seconds gives ~6-8 successful polls before exit so 'ready' is never missed
      setTimeout(() => {
        process.exit(0);
      }, 4000);

      return {
        success: true,
        message: 'تم تجهيز التحديث بنجاح وجارٍ إعادة التشغيل.',
      };
    } catch (err: any) {
      this.releaseUpdateLock(err?.message || 'Unknown update error');
      throw err;
    }
  }

  /**
   * Resolves the app root directory (where data, backups, storage live)
   */
  private getAppRootDirectory(): string {
    const cwd = process.cwd();
    // If running inside resources/ directory, root is parent directory
    if (path.basename(cwd).toLowerCase() === 'resources') {
      return path.dirname(cwd);
    }
    return cwd;
  }

  /**
   * Resolves the full path to Clinic Records.app on macOS
   */
  private getMacAppBundlePath(): string | null {
    if (process.platform !== 'darwin') return null;
    const parts = process.execPath.split(path.sep);
    const appIndex = parts.findIndex((part) => part.endsWith('.app'));
    if (appIndex !== -1) {
      return parts.slice(0, appIndex + 1).join(path.sep);
    }
    const cwdApp = path.join(process.cwd(), 'Clinic Records.app');
    if (fs.existsSync(cwdApp)) {
      return cwdApp;
    }
    return null;
  }

  /**
   * Finds the extracted application root folder inside temp
   */
  private findPayloadRoot(extractDir: string): string {
    const entries = fs.readdirSync(extractDir);
    for (const entry of entries) {
      const full = path.join(extractDir, entry);
      if (fs.statSync(full).isDirectory()) {
        if (
          fs.existsSync(path.join(full, 'resources')) ||
          fs.existsSync(path.join(full, 'Clinic Records.exe')) ||
          fs.existsSync(path.join(full, 'Clinic Records.app')) ||
          fs.existsSync(path.join(full, 'dist'))
        ) {
          return full;
        }
      }
    }
    return extractDir;
  }

  /**
   * Native OS archive extraction (zero dependencies, completely hidden without terminal windows)
   */
  private extractArchive(archivePath: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let cmd: string;
      let args: string[];

      if (process.platform === 'win32') {
        cmd = 'powershell';
        args = [
          '-NoProfile',
          '-NonInteractive',
          '-WindowStyle',
          'Hidden',
          '-Command',
          `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${destDir}" -Force`,
        ];
      } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
        cmd = 'tar';
        args = ['-xzf', archivePath, '-C', destDir];
      } else {
        cmd = 'unzip';
        args = ['-q', '-o', archivePath, '-d', destDir];
      }

      const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Extraction failed with exit code ${code}`));
      });
      child.on('error', (err) => reject(err));
    });
  }

  /**
   * Spawns a fully detached update runner that waits for this process to exit,
   * updates the code files, and restarts the companion app silently without any command windows.
   */
  private spawnDetachedRunner(payloadDir: string, appRootDir: string, tempBase: string): void {
    if (process.platform === 'win32') {
      const runnerBat = path.join(tempBase, 'apply-update.bat');
      const batContent = `@echo off
chcp 65001 > nul
timeout /t 3 /nobreak > nul

:: 1. Forcefully terminate running instances to release file locks on Windows
taskkill /F /IM "Clinic Records.exe" > nul 2>&1
taskkill /F /IM "node.exe" > nul 2>&1
timeout /t 1 /nobreak > nul

set "SRC=${payloadDir}"
set "DEST=${appRootDir}"

:: 2. Replace resources (code and runtime)
if exist "%SRC%\\resources" (
    robocopy "%SRC%\\resources" "%DEST%\\resources" /E /R:3 /W:1 /NP > nul 2>&1
    if errorlevel 8 (
        xcopy /E /I /Y /Q "%SRC%\\resources" "%DEST%\\resources\\" > nul 2>&1
    )
)

:: 3. Replace companion launcher executable
if exist "%SRC%\\Clinic Records.exe" (
    copy /Y "%SRC%\\Clinic Records.exe" "%DEST%\\Clinic Records.exe" > nul 2>&1
)

:: 4. Replace instructions & debugger
if exist "%SRC%\\تعليمات_التشغيل.txt" (
    copy /Y "%SRC%\\تعليمات_التشغيل.txt" "%DEST%\\تعليمات_التشغيل.txt" > nul 2>&1
)
if exist "%SRC%\\start-debug.bat" (
    copy /Y "%SRC%\\start-debug.bat" "%DEST%\\start-debug.bat" > nul 2>&1
)

timeout /t 1 /nobreak > nul

:: 5. Launch brand-new instance
if exist "%DEST%\\Clinic Records.exe" (
    start "" "%DEST%\\Clinic Records.exe"
) else (
    start "" "%DEST%\\resources\\runtime\\node.exe" "%DEST%\\resources\\dist\\server.js"
)
exit
`;
      fs.writeFileSync(runnerBat, batContent, 'utf-8');

      // VBScript wrapper ensures 100% silent execution in Windows with zero black terminal flashes
      const vbsPath = path.join(tempBase, 'silent-run.vbs');
      const vbsContent = 'Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.Run chr(34) & WScript.Arguments(0) & chr(34), 0, False\r\n';
      fs.writeFileSync(vbsPath, vbsContent, 'utf-8');

      const proc = spawn('wscript.exe', ['//B', '//Nologo', vbsPath, runnerBat], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        cwd: tempBase,
      });
      proc.unref();
    } else if (process.platform === 'darwin') {
      const runnerSh = path.join(tempBase, 'apply-update.sh');
      const macBundle = this.getMacAppBundlePath();
      const destApp = macBundle || path.join(appRootDir, 'Clinic Records.app');
      const destDir = path.dirname(destApp);

      const shContent = `#!/bin/bash
sleep 3

# 1. Terminate any running Clinic Records app so bundle is completely unlocked
killall "Clinic Records" 2>/dev/null || true
sleep 1

SRC="${payloadDir}"
DEST_APP="${destApp}"
DEST_DIR="${destDir}"

# 2. Replace app bundle atomically
if [ -d "$SRC/Clinic Records.app" ]; then
    rm -rf "$DEST_APP"
    cp -R "$SRC/Clinic Records.app" "$DEST_DIR/"
    xattr -dr com.apple.quarantine "$DEST_APP" 2>/dev/null || true
    chmod +x "$DEST_APP/Contents/MacOS/Clinic Records" 2>/dev/null || true
    chmod +x "$DEST_APP/Contents/Resources/app/runtime/bin/node" 2>/dev/null || true
fi

# 3. Copy instructions & console debugger if included
if [ -f "$SRC/تعليمات_التشغيل.txt" ]; then
    cp "$SRC/تعليمات_التشغيل.txt" "$DEST_DIR/" 2>/dev/null || true
fi
if [ -f "$SRC/start-debug.command" ]; then
    cp "$SRC/start-debug.command" "$DEST_DIR/" 2>/dev/null || true
    chmod +x "$DEST_DIR/start-debug.command" 2>/dev/null || true
fi

# 4. Launch new instance (-n forces clean fresh instance)
if [ -d "$DEST_APP" ]; then
    open -n "$DEST_APP" || open "$DEST_APP"
fi
exit 0
`;
      fs.writeFileSync(runnerSh, shContent, { encoding: 'utf-8', mode: 0o755 });

      const proc = spawn('/bin/bash', [runnerSh], {
        detached: true,
        stdio: 'ignore',
        cwd: tempBase,
      });
      proc.unref();
    } else {
      const runnerSh = path.join(tempBase, 'apply-update.sh');
      const shContent = `#!/bin/bash
sleep 1
killall "Clinic Records" 2>/dev/null || true
sleep 1

SRC="${payloadDir}"
DEST="${appRootDir}"

if [ -d "$SRC/resources" ]; then
    cp -r "$SRC/resources"/* "$DEST/resources/"
fi
if [ -f "$SRC/Clinic Records" ]; then
    cp "$SRC/Clinic Records" "$DEST/"
    chmod +x "$DEST/Clinic Records"
fi

if [ -f "$DEST/start.sh" ]; then
    bash "$DEST/start.sh" &
fi
exit 0
`;
      fs.writeFileSync(runnerSh, shContent, { encoding: 'utf-8', mode: 0o755 });

      const proc = spawn('/bin/bash', [runnerSh], {
        detached: true,
        stdio: 'ignore',
        cwd: tempBase,
      });
      proc.unref();
    }
  }
}

export const systemUpdater = new SystemUpdater();
