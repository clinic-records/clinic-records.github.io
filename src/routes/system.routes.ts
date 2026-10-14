import { FastifyInstance, FastifyRequest } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import QRCode from 'qrcode';
import { ClinicDatabase } from '../db/database.js';
import { AppConfig } from '../config.js';
import { getNetworkDetails } from '../utils/network.js';
import { realtimeManager } from '../utils/realtime.js';
import { systemUpdater } from '../utils/updater.js';

export function registerSystemRoutes(
  app: FastifyInstance,
  db: ClinicDatabase,
  config: AppConfig,
  currentPort: number | (() => number)
) {
  // 1. Real-time Server-Sent Events (SSE) connection
  app.get('/api/realtime', (req: FastifyRequest<{
    Querystring: { clientId?: string; role?: string };
  }>, reply) => {
    const clientId = req.query.clientId || `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const isObserver = req.query.role === 'observer';
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });

    realtimeManager.addClient(clientId, clientIp, reply, isObserver);

    reply.raw.write(`data: ${JSON.stringify({ type: 'connected', clientId, onlineUsers: realtimeManager.getOnlineCount() })}\n\n`);

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
    });
  });

  // 3.5 Lightweight health check for LAN and mDNS client probing
  app.get('/api/health', async () => ({
    status: 'ok',
    domain: 'clinic.local',
    timestamp: Date.now(),
  }));

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

  // 5. System stats
  app.get('/api/stats', async (_req, reply) => {
    const stats = db.getStats();
    return reply.send(stats);
  });

  // 6. Dynamic QR Code generator
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

  // 7. Software updates via GitHub Releases
  app.get('/api/system/update', async (_req, reply) => {
    const info = await systemUpdater.checkForUpdates();
    return reply.send(info);
  });

  // 8. Check in-place update download and installation status
  app.get('/api/system/update/status', async (_req, reply) => {
    return reply.send(systemUpdater.getStatus());
  });

  // 9. Trigger in-place auto update
  app.post('/api/system/update/install', async (_req, reply) => {
    // 1. Synchronously acquire lock to prevent race conditions across multiple clients/launchers
    if (!systemUpdater.acquireUpdateLock()) {
      return reply.status(409).send({
        error: 'عملية التحديث قيد التنفيذ بالفعل حالياً من قبل مستخدم أو شاشة أخرى.',
      });
    }

    try {
      // 2. Notify all connected clients across the LAN that server update is starting
      realtimeManager.broadcastServerUpdating();

      // 3. Launch asynchronous in-place update flow
      systemUpdater.installUpdate(db, config).catch((err) => {
        console.error('In-place update error:', err);
      });
      return reply.send({ success: true, message: 'بدأت عملية التحديث بنجاح' });
    } catch (err: any) {
      systemUpdater.releaseUpdateLock(err?.message);
      return reply.status(400).send({ error: err?.message || 'فشل بدء التحديث' });
    }
  });

  // 10. Open backups folder in native OS file manager
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
}
