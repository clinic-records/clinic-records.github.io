import path from 'node:path';
import fs from 'node:fs';

export type DocumentType = 'separate' | 'program' | 'tests' | 'behavioral_plan';

export const VALID_DOCUMENT_TYPES: DocumentType[] = [
  'separate',
  'program',
  'tests',
  'behavioral_plan',
];

/**
 * Calculates sharded path to prevent thousands of directories in a single folder.
 * Example for patient ID 123456:
 * storage/patients/12/34/patient_123456/
 */
export function getPatientStorageDir(baseStoragePath: string, patientId: number): string {
  const shard1 = String(Math.floor(patientId / 10000)).padStart(2, '0');
  const shard2 = String(Math.floor((patientId % 10000) / 100)).padStart(2, '0');
  return path.join(baseStoragePath, 'patients', shard1, shard2, `patient_${patientId}`);
}

export function ensurePatientDirs(baseStoragePath: string, patientId: number): {
  patientDir: string;
  pdfDir: string;
  videoDir: string;
} {
  const patientDir = getPatientStorageDir(baseStoragePath, patientId);
  const pdfDir = path.join(patientDir, 'pdfs');
  const videoDir = path.join(patientDir, 'videos');

  if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
  if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

  return { patientDir, pdfDir, videoDir };
}

export function getDocPath(
  baseStoragePath: string,
  patientId: number,
  docType: DocumentType
): string {
  const { pdfDir } = ensurePatientDirs(baseStoragePath, patientId);
  return path.join(pdfDir, `${docType}.pdf`);
}

export function deleteDocFile(
  baseStoragePath: string,
  patientId: number,
  docType: DocumentType
): boolean {
  const filePath = getDocPath(baseStoragePath, patientId, docType);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (err) {
      console.error(`Error deleting ${docType} file for patient ${patientId}:`, err);
    }
  }
  return false;
}

export function getVideoFilePath(
  baseStoragePath: string,
  patientId: number,
  storedFilename: string
): string {
  const { videoDir } = ensurePatientDirs(baseStoragePath, patientId);
  return path.join(videoDir, storedFilename);
}

export function deleteVideoFile(
  baseStoragePath: string,
  patientId: number,
  storedFilename: string
): boolean {
  const filePath = getVideoFilePath(baseStoragePath, patientId, storedFilename);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (err) {
      console.error(`Error deleting video ${storedFilename} for patient ${patientId}:`, err);
    }
  }
  return false;
}

export function deletePatientDirectory(baseStoragePath: string, patientId: number): boolean {
  const patientDir = getPatientStorageDir(baseStoragePath, patientId);
  if (fs.existsSync(patientDir)) {
    try {
      fs.rmSync(patientDir, { recursive: true, force: true });
      return true;
    } catch (err) {
      console.error(`Error removing patient directory for patient ${patientId}:`, err);
    }
  }
  return false;
}
