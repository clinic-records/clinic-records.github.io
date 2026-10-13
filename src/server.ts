import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import fastifyCors from '@fastify/cors';
import path from 'node:path';
import fs from 'node:fs';
import open from 'open';
import qrcodeTerminal from 'qrcode';
import { loadConfig } from './config.js';
import { ClinicDatabase } from './db/database.js';
import { registerApiRoutes } from './routes/api.js';
import { findAvailablePort, getNetworkDetails } from './utils/network.js';

async function bootstrap() {
  const config = loadConfig();
  const db = new ClinicDatabase(config.dbPath);

  // Find next available port if default port is in use
  const activePort = await findAvailablePort(config.port, config.host);

  const app = fastify({
    logger: false,
    bodyLimit: 10 * 1024 * 1024,
  });

  await app.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Support up to 2GB file upload per request with streaming
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 2 * 1024 * 1024 * 1024,
      files: 5,
    },
  });

  const publicDir = path.resolve(process.cwd(), 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
  });

  registerApiRoutes(app, db, config, activePort);

  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url && req.raw.url.startsWith('/api/')) {
      return reply.status(404).send({ error: 'Endpoint not found' });
    }
    const indexHtml = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexHtml)) {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send('Page not found');
  });

  try {
    await app.listen({ port: activePort, host: config.host });
    const netDetails = await getNetworkDetails(activePort);

    console.log('\n=============================================================');
    console.log('       CLINIC PATIENT RECORDS SERVER RUNNING');
    console.log('=============================================================');
    console.log(`\n  NETWORK ACCESS URL:`);
    console.log(`  \x1b[32m\x1b[1m${netDetails.lanUrl}\x1b[0m`);
    console.log('\n  SCAN QR CODE FROM MOBILE / TABLET:');

    try {
      const qrTerminalStr = await qrcodeTerminal.toString(netDetails.lanUrl, {
        type: 'terminal',
        small: true,
      });
      console.log(qrTerminalStr);
    } catch {
      // ignore
    }

    console.log('=============================================================\n');

    // Auto open the LAN URL in browser (NEVER localhost)
    if (config.autoOpenBrowser) {
      setTimeout(() => {
        open(netDetails.lanUrl).catch(() => {
          // ignore if headless
        });
      }, 500);
    }
  } catch (err) {
    console.error('Fatal error starting server:', err);
    process.exit(1);
  }

  const gracefulShutdown = () => {
    console.log('\nStopping server and closing database...');
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

bootstrap();
