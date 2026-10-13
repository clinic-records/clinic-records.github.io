import { FastifyInstance, FastifyRequest } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { ClinicDatabase } from '../db/database.js';
import { AppConfig } from '../config.js';
import { realtimeManager } from '../utils/realtime.js';
import {
  savePatientPhoto,
  deletePatientPhoto,
  getPatientPhotoPath,
  deletePatientDirectory,
} from '../utils/storage.js';

export function registerPatientsRoutes(
  app: FastifyInstance,
  db: ClinicDatabase,
  config: AppConfig
) {
  // 1. Search and list patients
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

  // 2. Create new patient
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

  // 3. Get full patient profile
  app.get('/api/patients/:id', async (req: FastifyRequest<{
    Params: { id: string };
  }>, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid patient ID' });

    const fullDetails = db.getPatientFullDetails(id);
    if (!fullDetails) return reply.status(404).send({ error: 'Patient not found' });

    return reply.send(fullDetails);
  });

  // 4. Update patient (with client broadcast)
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

  // 5. Get patient photo
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

  // 6. Upload patient photo (multipart or json base64)
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

  // 7. Delete patient photo
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

  // 8. Move patient to recycle bin (soft delete)
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

  // 9. Batch move patients to recycle bin
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

  // 10. Get deleted patients in recycle bin
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

  // 11. Restore patient from recycle bin
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

  // 12. Batch restore patients from recycle bin
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

  // 13. Permanently delete a patient from recycle bin
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

  // 14. Batch permanently delete patients from recycle bin
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

  // 15. Empty the entire recycle bin
  app.post('/api/recycle-bin/empty', async (_req, reply) => {
    const allIds = db.getAllDeletedPatientIds();
    for (const id of allIds) {
      db.deletePatient(id);
      deletePatientDirectory(config.storagePath, id);
    }

    realtimeManager.broadcastPatientsListChanged();
    return reply.send({ success: true, deletedCount: allIds.length });
  });
}
