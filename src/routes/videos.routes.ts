import { FastifyInstance, FastifyRequest } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ClinicDatabase } from '../db/database.js';
import { AppConfig } from '../config.js';
import { realtimeManager } from '../utils/realtime.js';
import {
  getVideoFilePath,
  deleteVideoFile,
} from '../utils/storage.js';

export function registerVideosRoutes(
  app: FastifyInstance,
  db: ClinicDatabase,
  config: AppConfig
) {
  // 1. Upload video (Direct Stream to Disk)
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

  // 2. Video stream with HTTP 206 Partial Content
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

  // 3. Delete video
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
}
