import { Database } from 'better-sqlite3';
import { PatientVideo } from '../types.js';

export class VideosRepository {
  constructor(private db: Database) {}

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

  public getVideoById(videoId: number): PatientVideo | null {
    const row = this.db.prepare('SELECT * FROM patient_videos WHERE id = ?').get(videoId) as
      | PatientVideo
      | undefined;
    return row || null;
  }

  public deletePatientVideo(videoId: number): boolean {
    const result = this.db.prepare('DELETE FROM patient_videos WHERE id = ?').run(videoId);
    return result.changes > 0;
  }
}
