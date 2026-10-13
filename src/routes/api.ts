import { FastifyInstance } from 'fastify';
import { ClinicDatabase } from '../db/database.js';
import { AppConfig } from '../config.js';
import { registerSystemRoutes } from './system.routes.js';
import { registerPatientsRoutes } from './patients.routes.js';
import { registerDocumentsRoutes } from './documents.routes.js';
import { registerVideosRoutes } from './videos.routes.js';
import { registerBackupsRoutes } from './backups.routes.js';

/**
 * Enterprise Route Aggregator
 * Orchestrates domain-specific Fastify route plugins cleanly and modularly.
 */
export function registerApiRoutes(
  app: FastifyInstance,
  db: ClinicDatabase,
  config: AppConfig,
  currentPort: number | (() => number)
) {
  registerSystemRoutes(app, db, config, currentPort);
  registerPatientsRoutes(app, db, config);
  registerDocumentsRoutes(app, db, config);
  registerVideosRoutes(app, db, config);
  registerBackupsRoutes(app, db, config);
}
