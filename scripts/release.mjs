/**
 * Clinic Patient Records System - Automated Enterprise Release Tool
 * Synchronizes versions across all platforms (Node, Windows C#, macOS Swift, Info.plist),
 * runs full validation tests, commits, tags, and triggers GitHub Actions multi-platform builds.
 *
 * Usage:
 *   node scripts/release.mjs [version | patch | minor | major]
 *   npm run release -- 1.0.5
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT_DIR = process.cwd();

function run(cmd, label) {
  if (label) console.log(`⏳ ${label}...`);
  try {
    return execSync(cmd, { cwd: ROOT_DIR, encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch (err) {
    console.error(`❌ Failed: ${label || cmd}`);
    if (err.stdout) console.error(err.stdout);
    if (err.stderr) console.error(err.stderr);
    process.exit(1);
  }
}

function parseVersion(targetInput, currentVersion) {
  const parts = currentVersion.replace(/^v/, '').split('.').map(Number);
  if (!targetInput) {
    return currentVersion.replace(/^v/, '');
  }

  const clean = targetInput.trim().toLowerCase();
  if (clean === 'patch') {
    return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  }
  if (clean === 'minor') {
    return `${parts[0]}.${parts[1] + 1}.0`;
  }
  if (clean === 'major') {
    return `${parts[0] + 1}.0.0`;
  }

  const custom = targetInput.replace(/^v/, '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(custom)) {
    console.error(`❌ Invalid semantic version format: "${targetInput}". Expected format: X.Y.Z (e.g. 1.0.5)`);
    process.exit(1);
  }
  return custom;
}

console.log('\n=============================================================');
console.log('   🚀 CLINIC PATIENT RECORDS - ENTERPRISE RELEASE RUNNER    ');
console.log('=============================================================\n');

// 1. Read current package.json
const pkgPath = path.resolve(ROOT_DIR, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const currentVersion = pkg.version || '1.0.4';

// 2. Determine target version
const targetArg = process.argv[2];
const newVersion = parseVersion(targetArg, currentVersion);
const newTag = `v${newVersion}`;

console.log(`📌 Current Version : v${currentVersion}`);
console.log(`🎯 Release Target   : ${newTag}\n`);

// 3. Verify git tag does not already exist
const existingTags = run('git tag -l', 'Checking existing tags').split('\n');
if (existingTags.includes(newTag)) {
  console.error(`❌ Error: Git tag "${newTag}" already exists!`);
  console.error(`   Choose a higher version (e.g., node scripts/release.mjs patch)`);
  process.exit(1);
}

// 4. Run validation checks
console.log('🧪 Step 1/5: Running validation checks...');
run('npm run check', 'Checking frontend ES modules and TypeScript types');
console.log('   ✅ All modules and types validated successfully.');

console.log('\n📦 Step 2/5: Testing production bundle...');
run('npm run build', 'Compiling production server bundle with esbuild');
console.log('   ✅ Bundle built cleanly in dist/server.js.');

// 5. Synchronize version across all platform files
console.log('\n🔄 Step 3/5: Synchronizing version across multi-platform files...');

// A. package.json
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
console.log(`   ✓ package.json -> ${newVersion}`);

// B. package-lock.json
const lockPath = path.resolve(ROOT_DIR, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
  lock.version = newVersion;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = newVersion;
  }
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf-8');
  console.log(`   ✓ package-lock.json -> ${newVersion}`);
}

// C. Windows C# Launcher (Program.cs)
const winProgramPath = path.resolve(ROOT_DIR, 'scripts', 'windows-launcher', 'Program.cs');
if (fs.existsSync(winProgramPath)) {
  let content = fs.readFileSync(winProgramPath, 'utf-8');
  content = content.replace(
    /string currentVersion = "v\d+\.\d+\.\d+";/,
    `string currentVersion = "${newTag}";`
  );
  fs.writeFileSync(winProgramPath, content, 'utf-8');
  console.log(`   ✓ scripts/windows-launcher/Program.cs -> ${newTag}`);
}

// D. macOS Swift Launcher (main.swift)
const macSwiftPath = path.resolve(ROOT_DIR, 'scripts', 'macos-launcher', 'main.swift');
if (fs.existsSync(macSwiftPath)) {
  let content = fs.readFileSync(macSwiftPath, 'utf-8');
  content = content.replace(
    /let currentVer = "v\d+\.\d+\.\d+"/,
    `let currentVer = "${newTag}"`
  );
  fs.writeFileSync(macSwiftPath, content, 'utf-8');
  console.log(`   ✓ scripts/macos-launcher/main.swift -> ${newTag}`);
}

// E. macOS App Info.plist generator (package-macos.sh)
const macPkgScript = path.resolve(ROOT_DIR, 'scripts', 'package-macos.sh');
if (fs.existsSync(macPkgScript)) {
  let content = fs.readFileSync(macPkgScript, 'utf-8');
  content = content.replace(
    /<key>CFBundleShortVersionString<\/key>\s*<string>\d+\.\d+\.\d+<\/string>/,
    `<key>CFBundleShortVersionString</key>\n    <string>${newVersion}</string>`
  );
  fs.writeFileSync(macPkgScript, content, 'utf-8');
  console.log(`   ✓ scripts/package-macos.sh -> ${newVersion}`);
}

// F. Server updater fallback (src/utils/updater.ts)
const updaterPath = path.resolve(ROOT_DIR, 'src', 'utils', 'updater.ts');
if (fs.existsSync(updaterPath)) {
  let content = fs.readFileSync(updaterPath, 'utf-8');
  content = content.replace(
    /return 'v\d+\.\d+\.\d+';/,
    `return '${newTag}';`
  );
  fs.writeFileSync(updaterPath, content, 'utf-8');
  console.log(`   ✓ src/utils/updater.ts -> ${newTag}`);
}

// G. Web UI placeholder label (public/index.html)
const indexPath = path.resolve(ROOT_DIR, 'public', 'index.html');
if (fs.existsSync(indexPath)) {
  let content = fs.readFileSync(indexPath, 'utf-8');
  content = content.replace(
    /<strong id="update-current-version-label">v\d+\.\d+\.\d+<\/strong>/,
    `<strong id="update-current-version-label">${newTag}</strong>`
  );
  fs.writeFileSync(indexPath, content, 'utf-8');
  console.log(`   ✓ public/index.html -> ${newTag}`);
}

// 6. Git commit and tag
console.log('\n🏷️  Step 4/5: Creating Git commit and release tag...');
run('git add .', 'Staging updated version files');
const status = run('git status --porcelain');
if (status.length > 0) {
  run(`git commit -m "chore(release): ${newTag}"`, `Committing release ${newTag}`);
  console.log(`   ✓ Committed as "chore(release): ${newTag}"`);
} else {
  console.log('   ✓ Working tree already clean and synced.');
}

run(`git tag -a "${newTag}" -m "Release ${newTag}"`, `Tagging repository with ${newTag}`);
console.log(`   ✓ Created tag ${newTag}`);

// 7. Push to GitHub
console.log('\n🚀 Step 5/5: Pushing release to GitHub remote...');
run('git push origin main', 'Pushing commits to main branch');
run(`git push origin "${newTag}"`, `Pushing tag ${newTag} to trigger GitHub Actions`);
console.log('   ✓ Pushed successfully to origin main and tags.');

console.log('\n=============================================================');
console.log(`🎉 RELEASE ${newTag} SUCCESSFULLY LAUNCHED!`);
console.log('=============================================================');
console.log(`🌐 GitHub Actions is now building Windows, macOS & Linux bundles:`);
console.log(`   https://github.com/clinic-records/clinic-records.github.io/actions`);
console.log(`📦 Release page will be available at:`);
console.log(`   https://github.com/clinic-records/clinic-records.github.io/releases/tag/${newTag}\n`);
