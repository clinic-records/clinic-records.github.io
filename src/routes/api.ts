import { FastifyInstance, FastifyRequest } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ClinicDatabase } from '../db/database.js';
import { AppConfig } from '../config.js';
import {
  DocumentType,
  VALID_DOCUMENT_TYPES,
  getDocPath,
  deleteDocFile,
  getVideoFilePath,
  deleteVideoFile,
  deletePatientDirectory,
  getPatientPhotoPath,
  savePatientPhoto,
  deletePatientPhoto,
} from '../utils/storage.js';
import { getNetworkDetails } from '../utils/network.js';
import { realtimeManager } from '../utils/realtime.js';
import QRCode from 'qrcode';

export function registerApiRoutes(
  app: FastifyInstance,
  db: ClinicDatabase,
  config: AppConfig,
  currentPort: number | (() => number)
) {
  // 1. Real-time Server-Sent Events (SSE) connection
  app.get('/api/realtime', (req: FastifyRequest<{
    Querystring: { clientId?: string };
  }>, reply) => {
    const clientId = req.query.clientId || `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });

    reply.raw.write(`data: ${JSON.stringify({ type: 'connected', clientId, onlineUsers: realtimeManager.getOnlineCount() + 1 })}\n\n`);

    realtimeManager.addClient(clientId, clientIp, reply);

    req.raw.on('close', () => {
      realtimeManager.removeClient(clientId);
    });
  });

  // 2. Track current patient being viewed by a client
  app.post('/api/realtime/viewing', async (req: FastifyRequest<{
    Body: { clientId: string; patientId: number | null };
  }>, reply) => {
    const { clientId, patientId } = req.body || {};
    if (clientId) {
      realtimeManager.setViewingPatient(clientId, patientId);
    }
    return reply.send({ success: true });
  });

  // 3. Query other active viewers for a patient
  app.get('/api/patients/:id/viewers', async (req: FastifyRequest<{
    Params: { id: string };
    Querystring: { clientId?: string };
  }>, reply) => {
    const id = parseInt(req.params.id, 10);
    const excludeClientId = req.query.clientId;
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid patient ID' });

    const viewers = realtimeManager.getPatientViewers(id, excludeClientId);
    return reply.send({
      patientId: id,
      viewersCount: viewers.length,
      viewers,
    });
  });

  // 4. Network details, QR code, and companion live stats
  app.get('/api/network', async (_req, reply) => {
    const portNumber = typeof currentPort === 'function' ? currentPort() : currentPort;
    const details = await getNetworkDetails(portNumber);
    const onlineCount = realtimeManager.getOnlineCount();
    const stats = db.getStats();

    let latestBackupTime: string | null = null;
    try {
      if (fs.existsSync(config.backupPath)) {
        const files = fs.readdirSync(config.backupPath).filter(f => f.endsWith('.db') || f.endsWith('.zip'));
        let maxMtime = 0;
        for (const file of files) {
          const stat = fs.statSync(path.join(config.backupPath, file));
          if (stat.mtimeMs > maxMtime) {
            maxMtime = stat.mtimeMs;
            latestBackupTime = stat.mtime.toISOString();
          }
        }
      }
    } catch {
      // ignore
    }

    return reply.send({
      ...details,
      onlineCount,
      stats: {
        totalPatients: stats.totalPatients,
        todayPatients: stats.todayPatients,
        totalVideos: stats.totalVideos,
        totalDocuments: stats.totalDocuments,
      },
      latestBackupTime,
      backupPath: config.backupPath,
    });
  });

  // 4b. Check for software updates via GitHub Releases
  app.get('/api/system/update', async (_req, reply) => {
    const currentVersion = 'v1.0.4';
    try {
      const response = await fetch('https://api.github.com/repos/clinic-records/clinic-records.github.io/releases/latest', {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'ClinicRecords-App',
        },
      });

      if (!response.ok) {
        return reply.send({ hasUpdate: false, currentVersion, error: 'Could not fetch updates' });
      }

      const release: any = await response.json();
      const latestVersion = release.tag_name || currentVersion;
      const hasUpdate = latestVersion.localeCompare(currentVersion, undefined, { numeric: true }) > 0;

      return reply.send({
        hasUpdate,
        currentVersion,
        latestVersion,
        releaseName: release.name,
        releaseNotes: release.body,
        publishedAt: release.published_at,
        htmlUrl: release.html_url,
      });
    } catch (err: any) {
      return reply.send({ hasUpdate: false, currentVersion, error: err?.message || 'Update check failed' });
    }
  });

  // 4c. Open backups folder in native OS file manager
  app.post('/api/system/open-backups-folder', async (_req, reply) => {
    try {
      if (!fs.existsSync(config.backupPath)) {
        fs.mkdirSync(config.backupPath, { recursive: true });
      }
      const openLib = (await import('open')).default;
      await openLib(config.backupPath);
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.status(500).send({ error: err?.message || 'Failed to open directory' });
    }
  });

  // 4b. Dynamic QR Code generator
  app.get('/api/qrcode', async (req: FastifyRequest<{
    Querystring: { text?: string };
  }>, reply) => {
    const text = req.query.text;
    if (!text || !text.trim()) {
      return reply.status(400).send({ error: 'Text query parameter is required' });
    }

    try {
      const qrCodeDataUrl = await QRCode.toDataURL(text.trim(), {
        margin: 2,
        width: 320,
        color: {
          dark: '#0d9488',
          light: '#ffffff',
        },
      });
      return reply.send({ qrCodeDataUrl, text: text.trim() });
    } catch {
      return reply.status(500).send({ error: 'Failed to generate QR code' });
    }
  });

  // 5. System stats
  app.get('/api/stats', async (_req, reply) => {
    const stats = db.getStats();
    return reply.send(stats);
  });

  // 6. Search and list patients
  app.get('/api/patients', async (req: FastifyRequest<{
    Querystring: {
      q?: string;
      gender?: string;
      startDate?: string;
      endDate?: string;
      diagnosis?: string;
      hasFiles?: 'all' | 'with_files' | 'without_files';
      sortBy?: 'created_desc' | 'created_asc' | 'name_asc' | 'file_asc';
      page?: string;
      limit?: string;
    };
  }>, reply) => {
    const { q, gender, startDate, endDate, diagnosis, hasFiles, sortBy, page, limit } = req.query;
    const result = db.searchPatients({
      query: q,
      gender,
      startDate,
      endDate,
      diagnosis,
      hasFiles,
      sortBy,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
    return reply.send(result);
  });

  // 7. Create new patient
  app.post('/api/patients', async (req: FastifyRequest<{
    Body: {
      file_number?: string;
      full_name: string;
      phone?: string;
      national_id?: string;
      gender?: 'male' | 'female';
      birth_date?: string;
      age?: number;
      diagnosis?: string;
      notes?: string;
      photo_base64?: string;
    };
  }>, reply) => {
    const body = req.body;
    if (!body || !body.full_name || !body.full_name.trim()) {
      return reply.status(400).send({ error: 'Patient full name is required' });
    }
    if (!body.gender || (body.gender !== 'male' && body.gender !== 'female')) {
      return reply.status(400).send({ error: 'Gender is required (male or female)' });
    }

    try {
      const patient = db.createPatient(body);

      // Handle photo_base64 if provided
      if (body.photo_base64 && typeof body.photo_base64 === 'string') {
        const matches = body.photo_base64.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
        if (matches) {
          const rawExt = matches[1].toLowerCase() === 'jpeg' ? 'jpg' : matches[1].toLowerCase();
          const ext = rawExt === 'png' || rawExt === 'webp' ? `.${rawExt}` : '.jpg';
          const buf = Buffer.from(matches[2], 'base64');
          savePatientPhoto(config.storagePath, patient.id, buf, ext);
          const photoUrl = `/api/patients/${patient.id}/photo?t=${Date.now()}`;
          db.updatePatientPhoto(patient.id, photoUrl);
          patient.photo_url = photoUrl;
        }
      }

      realtimeManager.broadcastPatientsListChanged();
      return reply.status(201).send(patient);
    } catch (err: any) {
      if (err.message && err.message.includes('UNIQUE constraint failed: patients.file_number')) {
        return reply.status(409).send({ error: 'File number already exists for another patient' });
      }
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to create patient record' });
    }
  });

  // 8. Get full patient profile
  app.get('/api/patients/:id', async (req: FastifyRequest<{
    Params: { id: string };
  }>, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid patient ID' });

    const fullDetails = db.getPatientFullDetails(id);
    if (!fullDetails) return reply.status(404).send({ error: 'Patient not found' });

    return reply.send(fullDetails);
  });

  // 9. Update patient (with client broadcast)
  app.put('/api/patients/:id', async (req: FastifyRequest<{
    Params: { id: string };
    Querystring: { clientId?: string };
    Body: {
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
      photo_base64?: string;
      remove_photo?: boolean;
    };
  }>, reply) => {
    const id = parseInt(req.params.id, 10);
    const clientId = req.query.clientId;
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid patient ID' });

    try {
      if (req.body.remove_photo) {
        deletePatientPhoto(config.storagePath, id);
        req.body.photo_url = null;
      } else if (req.body.photo_base64 && typeof req.body.photo_base64 === 'string') {
        const matches = req.body.photo_base64.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
        if (matches) {
          const rawExt = matches[1].toLowerCase() === 'jpeg' ? 'jpg' : matches[1].toLowerCase();
          const ext = rawExt === 'png' || rawExt === 'webp' ? `.${rawExt}` : '.jpg';
          const buf = Buffer.from(matches[2], 'base64');
          savePatientPhoto(config.storagePath, id, buf, ext);
          req.body.photo_url = `/api/patients/${id}/photo?t=${Date.now()}`;
        }
      }

      const updated = db.updatePatient(id, req.body);
      if (!updated) return reply.status(404).send({ error: 'Patient not found' });

      realtimeManager.broadcastPatientUpdate(id, clientId, 'details');
      realtimeManager.broadcastPatientsListChanged();

      return reply.send(updated);
    } catch (err: any) {
      if (err.message && err.message.includes('UNIQUE constraint failed: patients.file_number')) {
        return reply.status(409).send({ error: 'File number already exists for another patient' });
      }
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to update patient record' });
    }
  });

  // 9b. Get patient photo
  app.get('/api/patients/:id/photo', async (req: FastifyRequest<{
    Params: { id: string };
  }>, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid patient ID' });

    const photoPath = getPatientPhotoPath(config.storagePath, id);
    if (!photoPath || !fs.existsSync(photoPath)) {
      return reply.status(404).send({ error: 'Photo not found' });
    }

    const ext = path.extname(photoPath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    reply.header('Content-Type', mimeType);
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(fs.createReadStream(photoPath));
  });

  // 9c. Upload patient photo (multipart or json base64)
  app.post('/api/patients/:id/photo', async (req: FastifyRequest<{
    Params: { id: string };
    Querystring: { clientId?: string };
    Body?: { photo_base64?: string };
  }>, reply) => {
    const id = parseInt(req.params.id, 10);
    const clientId = req.query.clientId;
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid patient ID' });

    const patient = db.getPatientById(id);
    if (!patient) return reply.status(404).send({ error: 'Patient not found' });

    if (req.isMultipart()) {
      const data = await req.file();
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });
      const buffer = await data.toBuffer();
      const ext = path.extname(data.filename).toLowerCase() || '.jpg';
      savePatientPhoto(config.storagePath, id, buffer, ext);
    } else if (req.body?.photo_base64) {
      const matches = req.body.photo_base64.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
      if (!matches) return reply.status(400).send({ error: 'Invalid image base64 data' });
      const rawExt = matches[1].toLowerCase() === 'jpeg' ? 'jpg' : matches[1].toLowerCase();
      const ext = rawExt === 'png' || rawExt === 'webp' ? `.${rawExt}` : '.jpg';
      const buffer = Buffer.from(matches[2], 'base64');
      savePatientPhoto(config.storagePath, id, buffer, ext);
    } else {
      return reply.status(400).send({ error: 'No image provided' });
    }

    const photoUrl = `/api/patients/${id}/photo?t=${Date.now()}`;
    db.updatePatientPhoto(id, photoUrl);

    realtimeManager.broadcastPatientUpdate(id, clientId, 'details');
    realtimeManager.broadcastPatientsListChanged();

    return reply.send({ success: true, photo_url: photoUrl });
  });

  // 9d. Delete patient photo
  app.delete('/api/patients/:id/photo', async (req: FastifyRequest<{
    Params: { id: string };
    Querystring: { clientId?: string };
  }>, reply) => {
    const id = parseInt(req.params.id, 10);
    const clientId = req.query.clientId;
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid patient ID' });

    deletePatientPhoto(config.storagePath, id);
    db.updatePatientPhoto(id, null);

    realtimeManager.broadcastPatientUpdate(id, clientId, 'details');
    realtimeManager.broadcastPatientsListChanged();

    return reply.send({ success: true, message: 'Photo deleted successfully' });
  });

  // 10. Move patient to recycle bin (soft delete)
  app.delete('/api/patients/:id', async (req: FastifyRequest<{
    Params: { id: string };
  }>, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid patient ID' });

    const patient = db.getPatientById(id);
    if (!patient) return reply.status(404).send({ error: 'Patient not found' });

    db.softDeletePatient(id);

    realtimeManager.broadcastPatientsListChanged();
    realtimeManager.broadcastPatientUpdate(id, undefined, 'details');

    return reply.send({ success: true, message: 'Patient moved to recycle bin successfully' });
  });

  // 10b. Batch move patients to recycle bin
  app.post('/api/patients/batch-delete', async (req: FastifyRequest<{
    Body: { ids: number[] };
  }>, reply) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: 'List of patient IDs is required' });
    }

    const count = db.batchSoftDelete(ids.map(Number).filter((n) => !isNaN(n)));

    realtimeManager.broadcastPatientsListChanged();
    return reply.send({ success: true, deletedCount: count });
  });

  // 10c. Get deleted patients in recycle bin
  app.get('/api/recycle-bin', async (req: FastifyRequest<{
    Querystring: {
      q?: string;
      gender?: string;
      startDate?: string;
      endDate?: string;
      sortBy?: string;
      page?: string;
      limit?: string;
    };
  }>, reply) => {
    const { q, gender, startDate, endDate, sortBy, page, limit } = req.query;
    const result = db.getDeletedPatients({
      query: q,
      gender,
      startDate,
      endDate,
      sortBy,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
    return reply.send(result);
  });

  // 10d. Restore patient from recycle bin
  app.post('/api/recycle-bin/:id/restore', async (req: FastifyRequest<{
    Params: { id: string };
  }>, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid patient ID' });

    const restored = db.restorePatient(id);
    if (!restored) return reply.status(404).send({ error: 'Patient not found in recycle bin' });

    realtimeManager.broadcastPatientsListChanged();
    return reply.send({ success: true, message: 'Patient restored successfully' });
  });

  // 10e. Batch restore patients from recycle bin
  app.post('/api/recycle-bin/batch-restore', async (req: FastifyRequest<{
    Body: { ids: number[] };
  }>, reply) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: 'List of patient IDs is required' });
    }

    const count = db.batchRestore(ids.map(Number).filter((n) => !isNaN(n)));
    realtimeManager.broadcastPatientsListChanged();
    return reply.send({ success: true, restoredCount: count });
  });

  // 10f. Permanently delete a patient from recycle bin
  app.delete('/api/recycle-bin/:id', async (req: FastifyRequest<{
    Params: { id: string };
  }>, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid patient ID' });

    db.deletePatient(id);
    deletePatientDirectory(config.storagePath, id);

    realtimeManager.broadcastPatientsListChanged();
    return reply.send({ success: true, message: 'Patient permanently deleted' });
  });

  // 10g. Batch permanently delete patients from recycle bin
  app.post('/api/recycle-bin/batch-permanent-delete', async (req: FastifyRequest<{
    Body: { ids: number[] };
  }>, reply) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: 'List of patient IDs is required' });
    }

    const validIds = ids.map(Number).filter((n) => !isNaN(n));
    for (const id of validIds) {
      db.deletePatient(id);
      deletePatientDirectory(config.storagePath, id);
    }

    realtimeManager.broadcastPatientsListChanged();
    return reply.send({ success: true, deletedCount: validIds.length });
  });

  // 10h. Empty the entire recycle bin
  app.post('/api/recycle-bin/empty', async (_req, reply) => {
    const allIds = db.getAllDeletedPatientIds();
    for (const id of allIds) {
      db.deletePatient(id);
      deletePatientDirectory(config.storagePath, id);
    }

    realtimeManager.broadcastPatientsListChanged();
    return reply.send({ success: true, deletedCount: allIds.length });
  });

  // 11. Upload or replace PDF document
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

  // 12. View or download PDF document
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

  // 13. Delete PDF document
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

  // 14. Upload video (Direct Stream to Disk)
  app.post('/api/patients/:id/videos', async (req: FastifyRequest<{
    Params: { id: string };
    Querystring: { clientId?: string };
  }>, reply) => {
    const patientId = parseInt(req.params.id, 10);
    const clientId = req.query.clientId;
    if (isNaN(patientId)) return reply.status(400).send({ error: 'Invalid patient ID' });

    const patient = db.getPatientById(patientId);
    if (!patient) return reply.status(404).send({ error: 'Patient not found' });

    const data = await req.file();
    if (!data) {
      return reply.status(400).send({ error: 'No video file provided' });
    }

    const originalFilename = data.filename || 'video.mp4';
    const ext = path.extname(originalFilename) || '.mp4';
    const storedFilename = `vid_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;

    const targetFilePath = getVideoFilePath(config.storagePath, patientId, storedFilename);
    const writeStream = fs.createWriteStream(targetFilePath);

    await pipeline(data.file, writeStream);

    const stats = fs.statSync(targetFilePath);
    const fields = data.fields as Record<string, any>;
    const title = fields?.title?.value || path.parse(originalFilename).name;
    const notes = fields?.notes?.value || null;

    const videoRecord = db.addPatientVideo(patientId, {
      original_name: originalFilename,
      stored_filename: storedFilename,
      file_size: stats.size,
      title,
      notes,
    });

    realtimeManager.broadcastPatientUpdate(patientId, clientId, 'video');

    return reply.status(201).send(videoRecord);
  });

  // 15. Video stream with HTTP 206 Partial Content
  app.get('/api/patients/:id/videos/:videoId/stream', async (req: FastifyRequest<{
    Params: { id: string; videoId: string };
  }>, reply) => {
    const patientId = parseInt(req.params.id, 10);
    const videoId = parseInt(req.params.videoId, 10);

    if (isNaN(patientId) || isNaN(videoId)) {
      return reply.status(400).send({ error: 'Invalid request' });
    }

    const video = db.getVideoById(videoId);
    if (!video || video.patient_id !== patientId) {
      return reply.status(404).send({ error: 'Video not found' });
    }

    const filePath = getVideoFilePath(config.storagePath, patientId, video.stored_filename);
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'Video file missing from storage' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        return reply
          .status(416)
          .header('Content-Range', `bytes */${fileSize}`)
          .send();
      }

      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });

      return reply
        .status(206)
        .header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Length', chunkSize)
        .header('Content-Type', 'video/mp4')
        .send(fileStream);
    } else {
      return reply
        .header('Content-Length', fileSize)
        .header('Content-Type', 'video/mp4')
        .header('Accept-Ranges', 'bytes')
        .send(fs.createReadStream(filePath));
    }
  });

  // 16. Delete video
  app.delete('/api/patients/:id/videos/:videoId', async (req: FastifyRequest<{
    Params: { id: string; videoId: string };
    Querystring: { clientId?: string };
  }>, reply) => {
    const patientId = parseInt(req.params.id, 10);
    const videoId = parseInt(req.params.videoId, 10);
    const clientId = req.query.clientId;

    if (isNaN(patientId) || isNaN(videoId)) {
      return reply.status(400).send({ error: 'Invalid request' });
    }

    const video = db.getVideoById(videoId);
    if (!video || video.patient_id !== patientId) {
      return reply.status(404).send({ error: 'Video not found' });
    }

    deleteVideoFile(config.storagePath, patientId, video.stored_filename);
    db.deletePatientVideo(videoId);

    realtimeManager.broadcastPatientUpdate(patientId, clientId, 'video');

    return reply.send({ success: true, message: 'Video deleted successfully' });
  });

  // 17. Instant database backup
  // 17. Instant database backup
  app.post('/api/backup', async (_req, reply) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `clinic_backup_${timestamp}.db`;
    const destinationPath = path.join(config.backupPath, backupFileName);

    try {
      await db.backupDatabase(destinationPath);
      const stats = fs.statSync(destinationPath);
      return reply.send({
        success: true,
        message: 'Backup created successfully',
        fileName: backupFileName,
        fileSize: stats.size,
        downloadUrl: `/api/backup/download/${backupFileName}`,
      });
    } catch (err: any) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to create backup' });
    }
  });

  // 18. Download backup file
  app.get('/api/backup/download/:filename', async (req: FastifyRequest<{
    Params: { filename: string };
  }>, reply) => {
    const safeName = path.basename(req.params.filename);
    const filePath = path.join(config.backupPath, safeName);

    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'Backup file not found' });
    }

    return reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${safeName}"`)
      .send(fs.createReadStream(filePath));
  });

  // 19. List available backups on server
  app.get('/api/backups', async (_req, reply) => {
    try {
      if (!fs.existsSync(config.backupPath)) {
        return reply.send({ backups: [] });
      }
      const files = fs.readdirSync(config.backupPath);
      const backups = files
        .filter((f) => f.endsWith('.db') && !f.startsWith('.'))
        .map((fileName) => {
          const filePath = path.join(config.backupPath, fileName);
          const stats = fs.statSync(filePath);
          return {
            fileName,
            fileSize: stats.size,
            createdAt: stats.mtime.toISOString(),
            downloadUrl: `/api/backup/download/${encodeURIComponent(fileName)}`,
          };
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return reply.send({ backups });
    } catch (err: any) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to list backups' });
    }
  });

  // 20. Restore database from server backup file
  app.post('/api/backup/restore', async (req: FastifyRequest<{
    Body: { fileName?: string };
  }>, reply) => {
    const { fileName } = req.body || {};
    if (!fileName) {
      return reply.status(400).send({ error: 'Filename is required' });
    }

    const safeName = path.basename(fileName);
    const backupFilePath = path.join(config.backupPath, safeName);
    if (!fs.existsSync(backupFilePath)) {
      return reply.status(404).send({ error: 'Backup file not found' });
    }

    try {
      // 1. Create a pre-restore safety backup first
      const safetyTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safetyBackupPath = path.join(config.backupPath, `clinic_pre_restore_${safetyTimestamp}.db`);
      await db.backupDatabase(safetyBackupPath);

      // 2. Restore database
      db.restoreDatabase(backupFilePath);

      return reply.send({
        success: true,
        message: 'Database restored successfully',
      });
    } catch (err: any) {
      app.log.error(err);
      return reply.status(500).send({ error: err.message || 'Failed to restore database' });
    }
  });

  // 21. Upload .db file and restore
  app.post('/api/backup/upload-restore', async (req, reply) => {
    try {
      const data = await req.file();
      if (!data) {
        return reply.status(400).send({ error: 'No backup file provided' });
      }

      if (!data.filename.endsWith('.db') && !data.filename.endsWith('.sqlite')) {
        return reply.status(400).send({ error: 'File must have .db or .sqlite extension' });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const uploadedBackupName = `clinic_uploaded_${timestamp}.db`;
      const uploadedPath = path.join(config.backupPath, uploadedBackupName);

      // Stream upload to disk
      const writeStream = fs.createWriteStream(uploadedPath);
      await new Promise((resolve, reject) => {
        data.file.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      // 1. Create a pre-restore safety backup
      const safetyBackupPath = path.join(config.backupPath, `clinic_pre_restore_${timestamp}.db`);
      await db.backupDatabase(safetyBackupPath);

      // 2. Restore database
      db.restoreDatabase(uploadedPath);

      return reply.send({
        success: true,
        message: 'Uploaded backup restored successfully',
      });
    } catch (err: any) {
      app.log.error(err);
      return reply.status(500).send({ error: err.message || 'Failed to restore uploaded database' });
    }
  });
}
