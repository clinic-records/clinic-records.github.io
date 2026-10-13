import DatabaseConstructor, { Database } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { normalizeArabic, prepareFtsQuery } from '../utils/arabic.js';
import { DocumentType } from '../utils/storage.js';

export interface Patient {
  id: number;
  file_number: string;
  full_name: string;
  normalized_name: string;
  phone: string | null;
  national_id: string | null;
  gender: 'male' | 'female';
  birth_date: string | null;
  age: number | null;
  diagnosis: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface PatientDocuments {
  id: number;
  patient_id: number;
  separate_file_name: string | null;
  separate_file_size: number | null;
  separate_updated_at: string | null;
  program_file_name: string | null;
  program_file_size: number | null;
  program_updated_at: string | null;
  tests_file_name: string | null;
  tests_file_size: number | null;
  tests_updated_at: string | null;
  behavioral_plan_file_name: string | null;
  behavioral_plan_file_size: number | null;
  behavioral_plan_updated_at: string | null;
}

export interface PatientVideo {
  id: number;
  patient_id: number;
  original_name: string;
  stored_filename: string;
  file_size: number;
  duration: number | null;
  title: string | null;
  notes: string | null;
  created_at: string;
}

export interface PatientFullDetails extends Patient {
  documents: PatientDocuments | null;
  videos: PatientVideo[];
}

export interface PatientStats {
  totalPatients: number;
  todayPatients: number;
  malePatients: number;
  femalePatients: number;
  totalVideos: number;
  totalDocuments: number;
  totalStorageBytes: number;
  recycleBinCount: number;
}

export class ClinicDatabase {
  private db: Database;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseConstructor(dbPath);
    this.initDatabase();
  }

  private initDatabase() {
    // High-performance PRAGMAs for massive scale and concurrency
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('cache_size = -64000'); // 64MB Cache
    this.db.pragma('mmap_size = 2147483648'); // 2GB memory-mapped I/O

    // Primary patients table
    this.db.exec(`
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

    // Ensure deleted_at column exists if table was previously created without it
    const tableInfo = this.db.pragma('table_info(patients)') as Array<{ name: string }>;
    const hasDeletedAt = tableInfo.some((col) => col.name === 'deleted_at');
    if (!hasDeletedAt) {
      this.db.exec(`ALTER TABLE patients ADD COLUMN deleted_at DATETIME DEFAULT NULL;`);
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_patients_deleted_at ON patients(deleted_at);`);

    this.db.exec(`
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
    this.db.exec(`
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

  /**
   * Generates next unique patient file number (e.g. CL-000001)
   */
  private generateNextFileNumber(): string {
    const row = this.db.prepare('SELECT MAX(id) as maxId FROM patients').get() as {
      maxId: number | null;
    };
    const nextId = (row?.maxId || 0) + 1;
    return `CL-${String(nextId).padStart(6, '0')}`;
  }

  /**
   * Creates a new patient
   */
  public createPatient(data: {
    file_number?: string;
    full_name: string;
    phone?: string;
    national_id?: string;
    gender?: 'male' | 'female';
    birth_date?: string;
    age?: number;
    diagnosis?: string;
    notes?: string;
  }): Patient {
    const fileNumber = data.file_number?.trim() || this.generateNextFileNumber();
    const normalizedName = normalizeArabic(data.full_name);

    const insertStmt = this.db.prepare(`
      INSERT INTO patients (file_number, full_name, normalized_name, phone, national_id, gender, birth_date, age, diagnosis, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertStmt.run(
      fileNumber,
      data.full_name.trim(),
      normalizedName,
      data.phone?.trim() || null,
      data.national_id?.trim() || null,
      data.gender === 'female' ? 'female' : 'male',
      data.birth_date || null,
      data.age || null,
      data.diagnosis?.trim() || null,
      data.notes?.trim() || null
    );

    const patientId = Number(result.lastInsertRowid);

    // Initialize document row for this patient
    this.db.prepare('INSERT INTO patient_documents (patient_id) VALUES (?)').run(patientId);

    return this.getPatientById(patientId)!;
  }

  /**
   * Updates an existing patient
   */
  public updatePatient(
    id: number,
    data: {
      file_number?: string;
      full_name?: string;
      phone?: string;
      national_id?: string;
      gender?: 'male' | 'female';
      birth_date?: string;
      age?: number;
      diagnosis?: string;
      notes?: string;
    }
  ): Patient | null {
    const existing = this.getPatientById(id);
    if (!existing) return null;

    const fileNumber = data.file_number?.trim() || existing.file_number;
    const fullName = data.full_name?.trim() || existing.full_name;
    const normalizedName = normalizeArabic(fullName);

    this.db
      .prepare(
        `
      UPDATE patients
      SET file_number = ?,
          full_name = ?,
          normalized_name = ?,
          phone = ?,
          national_id = ?,
          gender = ?,
          birth_date = ?,
          age = ?,
          diagnosis = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
      )
      .run(
        fileNumber,
        fullName,
        normalizedName,
        data.phone !== undefined ? data.phone.trim() || null : existing.phone,
        data.national_id !== undefined ? data.national_id.trim() || null : existing.national_id,
        data.gender !== undefined ? (data.gender === 'female' ? 'female' : 'male') : existing.gender,
        data.birth_date !== undefined ? data.birth_date : existing.birth_date,
        data.age !== undefined ? data.age : existing.age,
        data.diagnosis !== undefined ? data.diagnosis.trim() || null : existing.diagnosis,
        data.notes !== undefined ? data.notes.trim() || null : existing.notes,
        id
      );

    return this.getPatientById(id);
  }

  /**
   * Deletes a patient permanently (cascades to documents and videos)
   */
  public deletePatient(id: number): boolean {
    const result = this.db.prepare('DELETE FROM patients WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Soft deletes a patient (moves to recycle bin)
   */
  public softDeletePatient(id: number): boolean {
    const result = this.db
      .prepare('UPDATE patients SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL')
      .run(id);
    return result.changes > 0;
  }

  /**
   * Restores a patient from recycle bin
   */
  public restorePatient(id: number): boolean {
    const result = this.db
      .prepare('UPDATE patients SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL')
      .run(id);
    return result.changes > 0;
  }

  /**
   * Batch soft-delete patients
   */
  public batchSoftDelete(ids: number[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(
      `UPDATE patients SET deleted_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders}) AND deleted_at IS NULL`
    );
    const result = stmt.run(...ids);
    return result.changes;
  }

  /**
   * Batch restore patients from recycle bin
   */
  public batchRestore(ids: number[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(
      `UPDATE patients SET deleted_at = NULL WHERE id IN (${placeholders}) AND deleted_at IS NOT NULL`
    );
    const result = stmt.run(...ids);
    return result.changes;
  }

  /**
   * Gets list of deleted patients in recycle bin
   */
  public getDeletedPatients(options: {
    page?: number;
    limit?: number;
    query?: string;
    gender?: string;
    startDate?: string;
    endDate?: string;
    sortBy?: string;
  } = {}): {
    patients: Patient[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } {
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(100, options.limit || 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['patients.deleted_at IS NOT NULL'];
    const params: any[] = [];

    if (options.gender === 'male' || options.gender === 'female') {
      conditions.push('patients.gender = ?');
      params.push(options.gender);
    }

    if (options.startDate) {
      conditions.push('date(patients.deleted_at) >= date(?)');
      params.push(options.startDate);
    }

    if (options.endDate) {
      conditions.push('date(patients.deleted_at) <= date(?)');
      params.push(options.endDate);
    }

    if (options.query && options.query.trim()) {
      const q = options.query.trim();
      const normalized = normalizeArabic(q);
      conditions.push('(patients.normalized_name LIKE ? OR patients.file_number LIKE ? OR patients.phone LIKE ?)');
      params.push(`%${normalized}%`, `%${q}%`, `%${q}%`);
    }

    let orderBy = 'patients.deleted_at DESC';
    if (options.sortBy === 'created_asc') {
      orderBy = 'patients.deleted_at ASC';
    } else if (options.sortBy === 'name_asc') {
      orderBy = 'patients.full_name COLLATE NOCASE ASC';
    } else if (options.sortBy === 'file_asc') {
      orderBy = 'patients.file_number ASC';
    }

    const whereClause = conditions.join(' AND ');
    const countRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM patients WHERE ${whereClause}`)
      .get(params) as { count: number };
    const total = countRow?.count || 0;

    const patients = this.db
      .prepare(
        `SELECT patients.* FROM patients WHERE ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
      )
      .all([...params, limit, offset]) as Patient[];

    return {
      patients,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Gets IDs of all patients currently in recycle bin
   */
  public getAllDeletedPatientIds(): number[] {
    const rows = this.db
      .prepare('SELECT id FROM patients WHERE deleted_at IS NOT NULL')
      .all() as Array<{ id: number }>;
    return rows.map((r) => r.id);
  }

  /**
   * Permanently deletes multiple patients
   */
  public batchPermanentDelete(ids: number[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(`DELETE FROM patients WHERE id IN (${placeholders})`);
    const result = stmt.run(...ids);
    return result.changes;
  }

  /**
   * Gets a patient by ID
   */
  public getPatientById(id: number, includeDeleted = false): Patient | null {
    const sql = includeDeleted
      ? 'SELECT * FROM patients WHERE id = ?'
      : 'SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL';
    const row = this.db.prepare(sql).get(id) as Patient | undefined;
    return row || null;
  }

  /**
   * Gets full patient details including documents and videos
   */
  public getPatientFullDetails(id: number): PatientFullDetails | null {
    const patient = this.getPatientById(id, true);
    if (!patient) return null;

    const documents =
      (this.db.prepare('SELECT * FROM patient_documents WHERE patient_id = ?').get(id) as
        | PatientDocuments
        | undefined) || null;

    const videos = this.db
      .prepare('SELECT * FROM patient_videos WHERE patient_id = ? ORDER BY created_at DESC')
      .all(id) as PatientVideo[];

    return {
      ...patient,
      documents,
      videos,
    };
  }

  /**
   * Fast full-text search with pagination and multi-dimensional filters
   */
  public searchPatients(options: {
    query?: string;
    gender?: string;
    startDate?: string;
    endDate?: string;
    diagnosis?: string;
    hasFiles?: 'all' | 'with_files' | 'without_files';
    sortBy?: 'created_desc' | 'created_asc' | 'name_asc' | 'file_asc';
    page?: number;
    limit?: number;
  }): {
    patients: Patient[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } {
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(100, options.limit || 20));
    const offset = (page - 1) * limit;

    const rawQuery = (options.query || '').trim();
    const ftsQuery = rawQuery ? prepareFtsQuery(rawQuery) : '';

    const conditions: string[] = ['patients.deleted_at IS NULL'];
    const params: any[] = [];

    if (options.gender === 'male' || options.gender === 'female') {
      conditions.push('patients.gender = ?');
      params.push(options.gender);
    }

    if (options.startDate) {
      conditions.push('date(patients.created_at) >= date(?)');
      params.push(options.startDate);
    }

    if (options.endDate) {
      conditions.push('date(patients.created_at) <= date(?)');
      params.push(options.endDate);
    }

    if (options.diagnosis && options.diagnosis.trim()) {
      conditions.push('patients.diagnosis LIKE ?');
      params.push(`%${options.diagnosis.trim()}%`);
    }

    if (options.hasFiles === 'with_files') {
      conditions.push(`(
        EXISTS (
          SELECT 1 FROM patient_documents d 
          WHERE d.patient_id = patients.id 
          AND (d.separate_file_name IS NOT NULL OR d.program_file_name IS NOT NULL OR d.tests_file_name IS NOT NULL OR d.behavioral_plan_file_name IS NOT NULL)
        ) OR EXISTS (
          SELECT 1 FROM patient_videos v WHERE v.patient_id = patients.id
        )
      )`);
    } else if (options.hasFiles === 'without_files') {
      conditions.push(`(
        NOT EXISTS (
          SELECT 1 FROM patient_documents d 
          WHERE d.patient_id = patients.id 
          AND (d.separate_file_name IS NOT NULL OR d.program_file_name IS NOT NULL OR d.tests_file_name IS NOT NULL OR d.behavioral_plan_file_name IS NOT NULL)
        ) AND NOT EXISTS (
          SELECT 1 FROM patient_videos v WHERE v.patient_id = patients.id
        )
      )`);
    }

    let orderBy = 'patients.created_at DESC';
    if (options.sortBy === 'created_asc') {
      orderBy = 'patients.created_at ASC';
    } else if (options.sortBy === 'name_asc') {
      orderBy = 'patients.full_name COLLATE NOCASE ASC';
    } else if (options.sortBy === 'file_asc') {
      orderBy = 'patients.file_number ASC';
    }

    let patients: Patient[] = [];
    let total = 0;

    if (ftsQuery) {
      try {
        const ftsWhere = `patients_fts MATCH ? AND ${conditions.join(' AND ')}`;
        const countRow = this.db
          .prepare(
            `
          SELECT COUNT(*) as count
          FROM patients_fts
          JOIN patients ON patients.id = patients_fts.patient_id
          WHERE ${ftsWhere}
        `
          )
          .get([ftsQuery, ...params]) as { count: number };

        total = countRow?.count || 0;

        const sortClause = options.sortBy ? orderBy : 'rank, patients.created_at DESC';
        patients = this.db
          .prepare(
            `
          SELECT patients.*
          FROM patients_fts
          JOIN patients ON patients.id = patients_fts.patient_id
          WHERE ${ftsWhere}
          ORDER BY ${sortClause}
          LIMIT ? OFFSET ?
        `
          )
          .all([ftsQuery, ...params, limit, offset]) as Patient[];
      } catch {
        // Fallback to LIKE if FTS query syntax error
        const normalized = normalizeArabic(rawQuery);
        const searchPattern = `%${normalized}%`;
        const codePattern = `%${rawQuery}%`;

        const likeConditions = [
          ...conditions,
          '(patients.normalized_name LIKE ? OR patients.file_number LIKE ? OR patients.phone LIKE ?)',
        ];
        const likeParams = [...params, searchPattern, codePattern, codePattern];

        const countRow = this.db
          .prepare(`SELECT COUNT(*) as count FROM patients WHERE ${likeConditions.join(' AND ')}`)
          .get(likeParams) as { count: number };

        total = countRow?.count || 0;

        patients = this.db
          .prepare(
            `SELECT patients.* FROM patients WHERE ${likeConditions.join(' AND ')} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
          )
          .all([...likeParams, limit, offset]) as Patient[];
      }
    } else {
      const whereClause = conditions.join(' AND ');
      const countRow = this.db
        .prepare(`SELECT COUNT(*) as count FROM patients WHERE ${whereClause}`)
        .get(params) as { count: number };

      total = countRow?.count || 0;

      patients = this.db
        .prepare(
          `SELECT patients.* FROM patients WHERE ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
        )
        .all([...params, limit, offset]) as Patient[];
    }

    return {
      patients,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Updates PDF document metadata
   */
  public updatePatientDocument(
    patientId: number,
    docType: DocumentType,
    fileName: string,
    fileSize: number
  ): void {
    const colName = `${docType}_file_name`;
    const colSize = `${docType}_file_size`;
    const colUpdated = `${docType}_updated_at`;

    this.db
      .prepare(
        `
      UPDATE patient_documents
      SET ${colName} = ?,
          ${colSize} = ?,
          ${colUpdated} = CURRENT_TIMESTAMP
      WHERE patient_id = ?
    `
      )
      .run(fileName, fileSize, patientId);
  }

  /**
   * Removes PDF document record
   */
  public removePatientDocument(patientId: number, docType: DocumentType): void {
    const colName = `${docType}_file_name`;
    const colSize = `${docType}_file_size`;
    const colUpdated = `${docType}_updated_at`;

    this.db
      .prepare(
        `
      UPDATE patient_documents
      SET ${colName} = NULL,
          ${colSize} = NULL,
          ${colUpdated} = NULL
      WHERE patient_id = ?
    `
      )
      .run(patientId);
  }

  /**
   * Adds a video record
   */
  public addPatientVideo(
    patientId: number,
    data: {
      original_name: string;
      stored_filename: string;
      file_size: number;
      duration?: number;
      title?: string;
      notes?: string;
    }
  ): PatientVideo {
    const stmt = this.db.prepare(`
      INSERT INTO patient_videos (patient_id, original_name, stored_filename, file_size, duration, title, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      patientId,
      data.original_name,
      data.stored_filename,
      data.file_size,
      data.duration || null,
      data.title?.trim() || null,
      data.notes?.trim() || null
    );

    return (this.db
      .prepare('SELECT * FROM patient_videos WHERE id = ?')
      .get(result.lastInsertRowid) as PatientVideo)!;
  }

  /**
   * Gets video by ID
   */
  public getVideoById(videoId: number): PatientVideo | null {
    const row = this.db.prepare('SELECT * FROM patient_videos WHERE id = ?').get(videoId) as
      | PatientVideo
      | undefined;
    return row || null;
  }

  /**
   * Deletes a video record
   */
  public deletePatientVideo(videoId: number): boolean {
    const result = this.db.prepare('DELETE FROM patient_videos WHERE id = ?').run(videoId);
    return result.changes > 0;
  }

  /**
   * System statistics
   */
  public getStats(): PatientStats {
    const patientsCount = (
      this.db.prepare('SELECT COUNT(*) as c FROM patients WHERE deleted_at IS NULL').get() as { c: number }
    ).c;
    const todayPatientsCount = (
      this.db
        .prepare(
          "SELECT COUNT(*) as c FROM patients WHERE deleted_at IS NULL AND date(created_at, 'localtime') = date('now', 'localtime')"
        )
        .get() as { c: number }
    ).c;
    const maleCount = (
      this.db
        .prepare("SELECT COUNT(*) as c FROM patients WHERE deleted_at IS NULL AND gender = 'male'")
        .get() as { c: number }
    ).c;
    const femaleCount = (
      this.db
        .prepare("SELECT COUNT(*) as c FROM patients WHERE deleted_at IS NULL AND gender = 'female'")
        .get() as { c: number }
    ).c;
    const recycleCount = (
      this.db.prepare('SELECT COUNT(*) as c FROM patients WHERE deleted_at IS NOT NULL').get() as { c: number }
    ).c;
    const videosRow = this.db
      .prepare(
        `SELECT COUNT(*) as c, COALESCE(SUM(v.file_size), 0) as totalBytes 
         FROM patient_videos v 
         JOIN patients p ON p.id = v.patient_id 
         WHERE p.deleted_at IS NULL`
      )
      .get() as { c: number; totalBytes: number };

    const docsRow = this.db
      .prepare(
        `
      SELECT 
        (COUNT(separate_file_name) + COUNT(program_file_name) + COUNT(tests_file_name) + COUNT(behavioral_plan_file_name)) as totalDocs,
        COALESCE(SUM(COALESCE(separate_file_size,0) + COALESCE(program_file_size,0) + COALESCE(tests_file_size,0) + COALESCE(behavioral_plan_file_size,0)), 0) as totalDocsBytes
      FROM patient_documents d
      JOIN patients p ON p.id = d.patient_id
      WHERE p.deleted_at IS NULL
    `
      )
      .get() as { totalDocs: number; totalDocsBytes: number };

    return {
      totalPatients: patientsCount,
      todayPatients: todayPatientsCount,
      malePatients: maleCount,
      femalePatients: femaleCount,
      totalVideos: videosRow.c,
      totalDocuments: docsRow.totalDocs,
      totalStorageBytes: videosRow.totalBytes + docsRow.totalDocsBytes,
      recycleBinCount: recycleCount,
    };
  }

  /**
   * Creates hot backup without stopping the database using VACUUM / backup API
   */
  public backupDatabase(destinationPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        if (fs.existsSync(destinationPath)) {
          fs.unlinkSync(destinationPath);
        }
        this.db
          .backup(destinationPath)
          .then(() => resolve())
          .catch((err) => reject(err));
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Safely restores database from a backup file
   */
  public restoreDatabase(sourceBackupPath: string): void {
    if (!fs.existsSync(sourceBackupPath)) {
      throw new Error('Backup file not found');
    }
    // Verify backup file integrity
    const testDb = new DatabaseConstructor(sourceBackupPath, { readonly: true });
    testDb.pragma('quick_check');
    testDb.close();

    // Close current connection
    this.db.close();

    // Overwrite main database file
    fs.copyFileSync(sourceBackupPath, this.dbPath);

    // Clean wal / shm files if present
    const walFile = `${this.dbPath}-wal`;
    const shmFile = `${this.dbPath}-shm`;
    if (fs.existsSync(walFile)) fs.unlinkSync(walFile);
    if (fs.existsSync(shmFile)) fs.unlinkSync(shmFile);

    // Reopen database
    this.db = new DatabaseConstructor(this.dbPath);
    this.initDatabase();
  }

  public close(): void {
    this.db.close();
  }
}
