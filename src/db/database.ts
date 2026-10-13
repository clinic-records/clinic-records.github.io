import DatabaseConstructor, { Database } from 'better-sqlite3';
import fs from 'node:fs';
import { createDatabaseConnection, initDatabaseSchema } from './connection.js';
import { PatientsRepository } from './repositories/patients.repo.js';
import { DocumentsRepository } from './repositories/documents.repo.js';
import { VideosRepository } from './repositories/videos.repo.js';
import { StatsRepository } from './repositories/stats.repo.js';
import { DocumentType } from '../utils/storage.js';
import { Patient, PatientFullDetails, PatientVideo, PatientStats } from './types.js';

export * from './types.js';
export { PatientsRepository } from './repositories/patients.repo.js';
export { DocumentsRepository } from './repositories/documents.repo.js';
export { VideosRepository } from './repositories/videos.repo.js';
export { StatsRepository } from './repositories/stats.repo.js';

/**
 * Unified Clinic Database Facade
 * Delegates to dedicated repositories following Enterprise Repository Pattern.
 */
export class ClinicDatabase {
  private db: Database;
  private dbPath: string;

  public readonly patients: PatientsRepository;
  public readonly documents: DocumentsRepository;
  public readonly videos: VideosRepository;
  public readonly stats: StatsRepository;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = createDatabaseConnection(dbPath);

    this.patients = new PatientsRepository(this.db);
    this.documents = new DocumentsRepository(this.db);
    this.videos = new VideosRepository(this.db);
    this.stats = new StatsRepository(this.db);
  }

  // --- Patients Facade Methods ---
  public createPatient(data: Parameters<PatientsRepository['createPatient']>[0]): Patient {
    return this.patients.createPatient(data);
  }

  public updatePatient(id: number, data: Parameters<PatientsRepository['updatePatient']>[1]): Patient | null {
    return this.patients.updatePatient(id, data);
  }

  public updatePatientPhoto(id: number, photoUrl: string | null): boolean {
    return this.patients.updatePatientPhoto(id, photoUrl);
  }

  public deletePatient(id: number): boolean {
    return this.patients.deletePatient(id);
  }

  public softDeletePatient(id: number): boolean {
    return this.patients.softDeletePatient(id);
  }

  public restorePatient(id: number): boolean {
    return this.patients.restorePatient(id);
  }

  public batchSoftDelete(ids: number[]): number {
    return this.patients.batchSoftDelete(ids);
  }

  public batchRestore(ids: number[]): number {
    return this.patients.batchRestore(ids);
  }

  public getDeletedPatients(options?: Parameters<PatientsRepository['getDeletedPatients']>[0]) {
    return this.patients.getDeletedPatients(options);
  }

  public getAllDeletedPatientIds(): number[] {
    return this.patients.getAllDeletedPatientIds();
  }

  public batchPermanentDelete(ids: number[]): number {
    return this.patients.batchPermanentDelete(ids);
  }

  public getPatientById(id: number, includeDeleted = false): Patient | null {
    return this.patients.getPatientById(id, includeDeleted);
  }

  public getPatientFullDetails(id: number): PatientFullDetails | null {
    return this.patients.getPatientFullDetails(id);
  }

  public searchPatients(options: Parameters<PatientsRepository['searchPatients']>[0]) {
    return this.patients.searchPatients(options);
  }

  // --- Documents Facade Methods ---
  public updatePatientDocument(
    patientId: number,
    docType: DocumentType,
    fileName: string,
    fileSize: number
  ): void {
    return this.documents.updatePatientDocument(patientId, docType, fileName, fileSize);
  }

  public removePatientDocument(patientId: number, docType: DocumentType): void {
    return this.documents.removePatientDocument(patientId, docType);
  }

  // --- Videos Facade Methods ---
  public addPatientVideo(patientId: number, data: Parameters<VideosRepository['addPatientVideo']>[1]): PatientVideo {
    return this.videos.addPatientVideo(patientId, data);
  }

  public getVideoById(videoId: number): PatientVideo | null {
    return this.videos.getVideoById(videoId);
  }

  public deletePatientVideo(videoId: number): boolean {
    return this.videos.deletePatientVideo(videoId);
  }

  // --- Stats Facade Methods ---
  public getStats(): PatientStats {
    return this.stats.getStats();
  }

  // --- Backup & Restore ---
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

  public restoreDatabase(sourceBackupPath: string): void {
    if (!fs.existsSync(sourceBackupPath)) {
      throw new Error('Backup file not found');
    }

    const testDb = new DatabaseConstructor(sourceBackupPath, { readonly: true });
    testDb.pragma('quick_check');
    testDb.close();

    this.db.close();
    fs.copyFileSync(sourceBackupPath, this.dbPath);

    const walFile = `${this.dbPath}-wal`;
    const shmFile = `${this.dbPath}-shm`;
    if (fs.existsSync(walFile)) fs.unlinkSync(walFile);
    if (fs.existsSync(shmFile)) fs.unlinkSync(shmFile);

    this.db = createDatabaseConnection(this.dbPath);

    // Rebind repositories to the new connection
    (this as any).patients = new PatientsRepository(this.db);
    (this as any).documents = new DocumentsRepository(this.db);
    (this as any).videos = new VideosRepository(this.db);
    (this as any).stats = new StatsRepository(this.db);
  }

  public close(): void {
    this.db.close();
  }
}
