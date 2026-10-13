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
  dbPath: path.resolve(process.cwd(), 'data', 'clinic.db'),
  storagePath: path.resolve(process.cwd(), 'storage'),
  backupPath: path.resolve(process.cwd(), 'backups'),
  autoOpenBrowser: true,
};

const CONFIG_FILE = path.resolve(process.cwd(), 'config.json');

export function loadConfig(): AppConfig {
  let config: AppConfig = { ...DEFAULT_CONFIG };

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      config = { ...config, ...parsed };
    } catch (err) {
      console.warn('Failed to parse config.json, using defaults:', err);
    }
  } else {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    } catch {
      // ignore
    }
  }

  // Ensure directories exist
  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  if (!fs.existsSync(config.storagePath)) fs.mkdirSync(config.storagePath, { recursive: true });
  if (!fs.existsSync(config.backupPath)) fs.mkdirSync(config.backupPath, { recursive: true });

  return config;
}
