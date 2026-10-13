import { FastifyInstance, FastifyRequest } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { ClinicDatabase } from '../db/database.js';
import { AppConfig } from '../config.js';

export function registerBackupsRoutes(
  app: FastifyInstance,
  db: ClinicDatabase,
  config: AppConfig
) {
  // 1. Instant database backup
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

  // 2. Download backup file
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

  // 3. List available backups on server
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

  // 4. Restore database from server backup file
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
      // Create a pre-restore safety backup first
      const safetyTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safetyBackupPath = path.join(config.backupPath, `clinic_pre_restore_${safetyTimestamp}.db`);
      await db.backupDatabase(safetyBackupPath);

      // Restore database
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

  // 5. Upload .db file and restore
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

      // Create a pre-restore safety backup
      const safetyBackupPath = path.join(config.backupPath, `clinic_pre_restore_${timestamp}.db`);
      await db.backupDatabase(safetyBackupPath);

      // Restore database
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
