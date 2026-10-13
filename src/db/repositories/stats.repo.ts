import { Database } from 'better-sqlite3';
import { PatientStats } from '../types.js';

export class StatsRepository {
  constructor(private db: Database) {}

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
}
