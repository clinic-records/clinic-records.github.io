import { Database } from 'better-sqlite3';
import { normalizeArabic, prepareFtsQuery } from '../../utils/arabic.js';
import { Patient, PatientFullDetails, PatientDocuments, PatientVideo } from '../types.js';

export class PatientsRepository {
  constructor(private db: Database) {}

  public generateNextFileNumber(): string {
    const row = this.db.prepare('SELECT MAX(id) as maxId FROM patients').get() as {
      maxId: number | null;
    };
    const nextId = (row?.maxId || 0) + 1;
    return `CL-${String(nextId).padStart(6, '0')}`;
  }

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
    photo_url?: string | null;
  }): Patient {
    const fileNumber = data.file_number?.trim() || this.generateNextFileNumber();
    const normalizedName = normalizeArabic(data.full_name);

    const insertStmt = this.db.prepare(`
      INSERT INTO patients (file_number, full_name, normalized_name, phone, national_id, gender, birth_date, age, diagnosis, notes, photo_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      data.notes?.trim() || null,
      data.photo_url || null
    );

    const patientId = Number(result.lastInsertRowid);
    this.db.prepare('INSERT INTO patient_documents (patient_id) VALUES (?)').run(patientId);

    return this.getPatientById(patientId)!;
  }

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
      photo_url?: string | null;
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
          photo_url = ?,
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
        data.photo_url !== undefined ? data.photo_url : existing.photo_url,
        id
      );

    return this.getPatientById(id);
  }

  public updatePatientPhoto(id: number, photoUrl: string | null): boolean {
    const result = this.db
      .prepare('UPDATE patients SET photo_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(photoUrl, id);
    return result.changes > 0;
  }

  public deletePatient(id: number): boolean {
    const result = this.db.prepare('DELETE FROM patients WHERE id = ?').run(id);
    return result.changes > 0;
  }

  public softDeletePatient(id: number): boolean {
    const result = this.db
      .prepare('UPDATE patients SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL')
      .run(id);
    return result.changes > 0;
  }

  public restorePatient(id: number): boolean {
    const result = this.db
      .prepare('UPDATE patients SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL')
      .run(id);
    return result.changes > 0;
  }

  public batchSoftDelete(ids: number[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(
      `UPDATE patients SET deleted_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders}) AND deleted_at IS NULL`
    );
    const result = stmt.run(...ids);
    return result.changes;
  }

  public batchRestore(ids: number[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(
      `UPDATE patients SET deleted_at = NULL WHERE id IN (${placeholders}) AND deleted_at IS NOT NULL`
    );
    const result = stmt.run(...ids);
    return result.changes;
  }

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

  public getAllDeletedPatientIds(): number[] {
    const rows = this.db
      .prepare('SELECT id FROM patients WHERE deleted_at IS NOT NULL')
      .all() as Array<{ id: number }>;
    return rows.map((r) => r.id);
  }

  public batchPermanentDelete(ids: number[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(`DELETE FROM patients WHERE id IN (${placeholders})`);
    const result = stmt.run(...ids);
    return result.changes;
  }

  public getPatientById(id: number, includeDeleted = false): Patient | null {
    const sql = includeDeleted
      ? 'SELECT * FROM patients WHERE id = ?'
      : 'SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL';
    const row = this.db.prepare(sql).get(id) as Patient | undefined;
    return row || null;
  }

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
}
