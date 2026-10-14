import DatabaseConstructor, { Database } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

export function createDatabaseConnection(dbPath: string): Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseConstructor(dbPath);
  initDatabaseSchema(db);
  return db;
}

export function initDatabaseSchema(db: Database): void {
  // High-performance PRAGMAs for massive scale and concurrency
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 10000'); // 10s wait for lock across concurrent LAN devices
  db.pragma('foreign_keys = ON');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -64000'); // 64MB Cache
  db.pragma('mmap_size = 2147483648'); // 2GB memory-mapped I/O

  // Primary patients table
  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_number TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      phone TEXT,
      national_id TEXT,
      gender TEXT CHECK(gender IN ('male', 'female')) NOT NULL DEFAULT 'male',
      birth_date TEXT,
      age INTEGER,
      diagnosis TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_patients_file_number ON patients(file_number);
    CREATE INDEX IF NOT EXISTS idx_patients_normalized_name ON patients(normalized_name);
    CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
    CREATE INDEX IF NOT EXISTS idx_patients_created_at ON patients(created_at DESC);
  `);

  // Ensure deleted_at and photo_url columns exist if table was previously created without them
  const tableInfo = db.pragma('table_info(patients)') as Array<{ name: string }>;
  const hasDeletedAt = tableInfo.some((col) => col.name === 'deleted_at');
  if (!hasDeletedAt) {
    db.exec(`ALTER TABLE patients ADD COLUMN deleted_at DATETIME DEFAULT NULL;`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_patients_deleted_at ON patients(deleted_at);`);

  const hasPhotoUrl = tableInfo.some((col) => col.name === 'photo_url');
  if (!hasPhotoUrl) {
    db.exec(`ALTER TABLE patients ADD COLUMN photo_url TEXT DEFAULT NULL;`);
  }

  // High-performance partial indexes for massive datasets
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_patients_active_created ON patients(created_at DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_patients_active_file ON patients(file_number) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_patients_active_name ON patients(full_name COLLATE NOCASE) WHERE deleted_at IS NULL;
  `);

  db.exec(`
    -- Four fixed patient documents table
    CREATE TABLE IF NOT EXISTS patient_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
      separate_file_name TEXT,
      separate_file_size INTEGER,
      separate_updated_at DATETIME,
      program_file_name TEXT,
      program_file_size INTEGER,
      program_updated_at DATETIME,
      tests_file_name TEXT,
      tests_file_size INTEGER,
      tests_updated_at DATETIME,
      behavioral_plan_file_name TEXT,
      behavioral_plan_file_size INTEGER,
      behavioral_plan_updated_at DATETIME
    );

    -- Patient videos table
    CREATE TABLE IF NOT EXISTS patient_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      duration REAL,
      title TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_videos_patient_id ON patient_videos(patient_id);

    -- Full-Text Search FTS5 virtual table
    CREATE VIRTUAL TABLE IF NOT EXISTS patients_fts USING fts5(
      patient_id UNINDEXED,
      normalized_name,
      file_number,
      phone,
      national_id
    );
  `);

  // Automatic triggers to synchronize FTS5 index
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_patients_ai AFTER INSERT ON patients BEGIN
      INSERT INTO patients_fts(patient_id, normalized_name, file_number, phone, national_id)
      VALUES (new.id, new.normalized_name, new.file_number, coalesce(new.phone, ''), coalesce(new.national_id, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS trg_patients_ad AFTER DELETE ON patients BEGIN
      DELETE FROM patients_fts WHERE patient_id = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_patients_au AFTER UPDATE ON patients BEGIN
      DELETE FROM patients_fts WHERE patient_id = old.id;
      INSERT INTO patients_fts(patient_id, normalized_name, file_number, phone, national_id)
      VALUES (new.id, new.normalized_name, new.file_number, coalesce(new.phone, ''), coalesce(new.national_id, ''));
    END;
  `);
}
