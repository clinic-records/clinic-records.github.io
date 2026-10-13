import { Database } from 'better-sqlite3';
import { DocumentType } from '../../utils/storage.js';

export class DocumentsRepository {
  constructor(private db: Database) {}

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
}
