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
import { getNetworkDetails } from './utils/network.js';
import { mdnsService } from './utils/mdns.js';

async function bootstrap() {
  const config = loadConfig();
  const db = new ClinicDatabase(config.dbPath);

  let activePort = config.port;

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

  // Resolve public folder: check next to dist first, fallback to cwd
  const appPublic = path.resolve(import.meta.dirname, '..', 'public');
  const cwdPublic = path.resolve(process.cwd(), 'public');
  const publicDir = fs.existsSync(path.join(appPublic, 'index.html'))
    ? appPublic
    : fs.existsSync(path.join(cwdPublic, 'index.html'))
    ? cwdPublic
    : appPublic;

  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
  });

  registerApiRoutes(app, db, config, () => activePort);

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

  let bound = false;
  const maxPortTries = 30;

  for (let attempt = 0; attempt < maxPortTries; attempt++) {
    try {
      await app.listen({ port: activePort, host: config.host });
      bound = true;
      break;
    } catch (err: any) {
      if (err && err.code === 'EADDRINUSE') {
        activePort++;
      } else {
        console.error('Fatal error starting server:', err);
        process.exit(1);
      }
    }
  }

  if (!bound) {
    console.error(`Fatal error: Could not find an available port starting from ${config.port}`);
    process.exit(1);
  }

  try {
    const netDetails = await getNetworkDetails(activePort);

    // Start in-app mDNS responder to broadcast clinic.local across the LAN
    mdnsService.start(activePort, netDetails.ip, 'clinic.local');

    console.log('\n=============================================================');
    console.log('       CLINIC PATIENT RECORDS SERVER RUNNING');
    console.log('=============================================================');
    console.log(`\n  🌐 PERMANENT LOCAL URL (mDNS / Zero-Config):`);
    console.log(`  \x1b[36m\x1b[1m${netDetails.mdnsUrl}\x1b[0m`);
    console.log(`\n  📶 DIRECT NETWORK IP (LAN):`);
    console.log(`  \x1b[32m\x1b[1m${netDetails.lanUrl}\x1b[0m`);
    console.log('\n  📱 SCAN QR CODE FROM MOBILE / TABLET:');

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

    // Auto open the LAN URL in browser (only if launched standalone, not from companion app)
    const isCompanion = process.env.LAUNCHED_BY_COMPANION === 'true' || process.env.LAUNCHED_BY_COMPANION === '1';
    if (config.autoOpenBrowser && !isCompanion) {
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
    mdnsService.stop();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

bootstrap();
