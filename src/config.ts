import path from 'node:path';
import fs from 'node:fs';

export interface AppConfig {
  port: number;
  host: string;
  dbPath: string;
  storagePath: string;
  backupPath: string;
  autoOpenBrowser: boolean;
}

const DEFAULT_CONFIG: AppConfig = {
  port: 3000,
  host: '0.0.0.0',
  dbPath: './data/clinic.db',
  storagePath: './storage',
  backupPath: './backups',
  autoOpenBrowser: true,
};

const CONFIG_FILE = path.resolve(process.cwd(), 'config.json');

export function loadConfig(): AppConfig {
  let rawConfig: Partial<AppConfig> = {};

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      rawConfig = JSON.parse(raw);
    } catch (err) {
      console.warn('Failed to parse config.json, using defaults:', err);
    }
  } else {
    try {
      // Write clean relative paths so the folder is 100% portable across locations and computers
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    } catch {
      // ignore
    }
  }

  const baseDir = process.cwd();

  // Helper to resolve relative path or sanitize stale absolute path if moved across computers/disks
  const resolvePortablePath = (configuredPath: string | undefined, defaultRel: string): string => {
    if (!configuredPath) return path.resolve(baseDir, defaultRel);

    // If it's a clean relative path (e.g. ./data/clinic.db or data/clinic.db)
    if (!path.isAbsolute(configuredPath)) {
      return path.resolve(baseDir, configuredPath);
    }

    // If it was an absolute path that still matches current base directory
    if (configuredPath.startsWith(baseDir)) {
      return configuredPath;
    }

    // Stale absolute path from another machine/path! Self-heal relative to current location:
    if (configuredPath.includes('clinic.db')) return path.resolve(baseDir, './data/clinic.db');
    if (configuredPath.includes('storage')) return path.resolve(baseDir, './storage');
    if (configuredPath.includes('backups')) return path.resolve(baseDir, './backups');

    return path.resolve(baseDir, defaultRel);
  };

  const port = Number(rawConfig.port) || 3000;
  const host = rawConfig.host || '0.0.0.0';
  const dbPath = resolvePortablePath(rawConfig.dbPath, './data/clinic.db');
  const storagePath = resolvePortablePath(rawConfig.storagePath, './storage');
  const backupPath = resolvePortablePath(rawConfig.backupPath, './backups');
  const autoOpenBrowser = rawConfig.autoOpenBrowser !== false;

  const config: AppConfig = {
    port,
    host,
    dbPath,
    storagePath,
    backupPath,
    autoOpenBrowser,
  };

  // Ensure directories exist
  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  if (!fs.existsSync(config.storagePath)) fs.mkdirSync(config.storagePath, { recursive: true });
  if (!fs.existsSync(config.backupPath)) fs.mkdirSync(config.backupPath, { recursive: true });

  return config;
}
