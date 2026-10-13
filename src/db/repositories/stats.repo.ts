import { Database } from 'better-sqlite3';
import { PatientStats } from '../types.js';

export class StatsRepository {
  constructor(private db: Database) {}

  public getStats(): PatientStats {
    const countsRow = this.db
      .prepare(
        `SELECT 
          COUNT(CASE WHEN deleted_at IS NULL THEN 1 END) as totalPatients,
          COUNT(CASE WHEN deleted_at IS NULL AND created_at >= datetime('now', 'start of day', 'localtime') THEN 1 END) as todayPatients,
          COUNT(CASE WHEN deleted_at IS NULL AND gender = 'male' THEN 1 END) as malePatients,
          COUNT(CASE WHEN deleted_at IS NULL AND gender = 'female' THEN 1 END) as femalePatients,
          COUNT(CASE WHEN deleted_at IS NOT NULL THEN 1 END) as recycleCount
        FROM patients`
      )
      .get() as {
        totalPatients: number;
        todayPatients: number;
        malePatients: number;
        femalePatients: number;
        recycleCount: number;
      };
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
      totalPatients: countsRow.totalPatients,
      todayPatients: countsRow.todayPatients,
      malePatients: countsRow.malePatients,
      femalePatients: countsRow.femalePatients,
      totalVideos: videosRow.c,
      totalDocuments: docsRow.totalDocs,
      totalStorageBytes: videosRow.totalBytes + docsRow.totalDocsBytes,
      recycleBinCount: countsRow.recycleCount,
    };
  }
}
