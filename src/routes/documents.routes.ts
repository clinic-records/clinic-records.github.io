import { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ClinicDatabase } from '../db/database.js';
import { AppConfig } from '../config.js';
import { realtimeManager } from '../utils/realtime.js';
import {
  DocumentType,
  VALID_DOCUMENT_TYPES,
  getDocPath,
  deleteDocFile,
} from '../utils/storage.js';

export function registerDocumentsRoutes(
  app: FastifyInstance,
  db: ClinicDatabase,
  config: AppConfig
) {
  // 1. Upload or replace PDF document
  app.post('/api/patients/:id/documents/:docType', async (req: FastifyRequest<{
    Params: { id: string; docType: string };
    Querystring: { clientId?: string };
  }>, reply) => {
    const patientId = parseInt(req.params.id, 10);
    const docType = req.params.docType as DocumentType;
    const clientId = req.query.clientId;

    if (isNaN(patientId)) return reply.status(400).send({ error: 'Invalid patient ID' });
    if (!VALID_DOCUMENT_TYPES.includes(docType)) {
      return reply.status(400).send({ error: `Invalid document type: ${docType}` });
    }

    const patient = db.getPatientById(patientId);
    if (!patient) return reply.status(404).send({ error: 'Patient not found' });

    const data = await req.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file received' });
    }

    const originalFilename = data.filename || `${docType}.pdf`;
    if (!originalFilename.toLowerCase().endsWith('.pdf')) {
      return reply.status(400).send({ error: 'Only PDF files are allowed' });
    }

    deleteDocFile(config.storagePath, patientId, docType);

    const targetFilePath = getDocPath(config.storagePath, patientId, docType);
    const writeStream = fs.createWriteStream(targetFilePath);

    await pipeline(data.file, writeStream);

    const stats = fs.statSync(targetFilePath);
    db.updatePatientDocument(patientId, docType, originalFilename, stats.size);

    realtimeManager.broadcastPatientUpdate(patientId, clientId, 'document');

    return reply.send({
      success: true,
      message: 'Document uploaded successfully',
      fileName: originalFilename,
      fileSize: stats.size,
    });
  });

  // 2. View or download PDF document
  app.get('/api/patients/:id/documents/:docType', async (req: FastifyRequest<{
    Params: { id: string; docType: string };
    Querystring: { download?: string };
  }>, reply) => {
    const patientId = parseInt(req.params.id, 10);
    const docType = req.params.docType as DocumentType;

    if (isNaN(patientId) || !VALID_DOCUMENT_TYPES.includes(docType)) {
      return reply.status(400).send({ error: 'Invalid request' });
    }

    const filePath = getDocPath(config.storagePath, patientId, docType);
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'Document not found' });
    }

    const isDownload = req.query.download === '1';
    const stream = fs.createReadStream(filePath);

    return reply
      .header('Content-Type', 'application/pdf')
      .header(
        'Content-Disposition',
        `${isDownload ? 'attachment' : 'inline'}; filename="${docType}.pdf"`
      )
      .send(stream);
  });

  // 3. Delete PDF document
  app.delete('/api/patients/:id/documents/:docType', async (req: FastifyRequest<{
    Params: { id: string; docType: string };
    Querystring: { clientId?: string };
  }>, reply) => {
    const patientId = parseInt(req.params.id, 10);
    const docType = req.params.docType as DocumentType;
    const clientId = req.query.clientId;

    if (isNaN(patientId) || !VALID_DOCUMENT_TYPES.includes(docType)) {
      return reply.status(400).send({ error: 'Invalid request' });
    }

    deleteDocFile(config.storagePath, patientId, docType);
    db.removePatientDocument(patientId, docType);

    realtimeManager.broadcastPatientUpdate(patientId, clientId, 'document');

    return reply.send({ success: true, message: 'Document deleted successfully' });
  });
}
