import './loadEnv';
import './patchAsyncRoutes';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import type { ServeStaticOptions } from 'serve-static';

import { initRuntimeDb, queryOne } from './dbRuntime';
import { logger, flushErrorMonitoring } from './observability/logger';
import { requestLogging, errorLogging } from './observability/http';
import { validateStartupConfig } from './config';
import { ensureAiSettingsDefaults } from './services/aiSettings';
import reportsRouter from './routes/reports';
import adminRouter from './routes/admin';
import exportRouter from './routes/export';
import usersRouter from './routes/users';
import pdfRouter from './routes/pdf';
import alertsRouter from './routes/alerts';
import formBuilderRouter from './routes/form-builder';
import aiRouter from './routes/ai';
import contributorsRouter from './routes/contributors';
import consentRouter from './routes/consent';
import whatsappIntegrationRouter from './routes/whatsappIntegration';
import footprintsRouter from './routes/footprints';
import contentRouter, { publicRouter as publicContentRouter } from './routes/content';
import { startAiBackgroundWorkers } from './routes/ai';
import { startReportBackgroundWorkers } from './routes/reports';
import { backfillReportVersioning } from './versioningBackfill';
import { getLegacyLocalUploadsDir, getPrimaryLocalUploadsDir } from './media';

const app = express();
const PORT = process.env.PORT || 3001;
const STRICT_INTEGRATIONS = process.env.NODE_ENV === 'production' || process.env.STRICT_INTEGRATIONS === 'true';
const DATABASE_URL = process.env.DATABASE_URL || '';

app.disable('x-powered-by');
app.set('trust proxy', STRICT_INTEGRATIONS ? 1 : false);
app.use(requestLogging);

if (STRICT_INTEGRATIONS && !DATABASE_URL) {
  logger.error('api.config.invalid', { reason: 'DATABASE_URL is required' });
  process.exit(1);
}

const DOMAIN = process.env.DOMAIN || 'crisis-platform.com';
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:4173',
    'http://localhost:3000',
    `https://${DOMAIN}`,
    `https://www.${DOMAIN}`,
  ],
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10'),
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '30'),
  message: { error: 'Too many submissions. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadsStaticOptions: ServeStaticOptions = {
  dotfiles: 'deny',
  fallthrough: false,
  index: false,
  immutable: true,
  maxAge: '30d',
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data: blob:; media-src 'self'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
};

const reportsWriteLimiter: express.RequestHandler = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  submitLimiter(req, res, next);
};

const PRIMARY_UPLOADS_DIR = getPrimaryLocalUploadsDir();
const LEGACY_UPLOADS_DIR = getLegacyLocalUploadsDir();
app.use('/uploads', express.static(PRIMARY_UPLOADS_DIR, uploadsStaticOptions));
if (LEGACY_UPLOADS_DIR !== PRIMARY_UPLOADS_DIR) {
  app.use('/uploads', express.static(LEGACY_UPLOADS_DIR, uploadsStaticOptions));
}

app.get('/api/health', async (_req, res) => {
  try { await queryOne('SELECT 1'); }
  catch (error) { logger.error('db.health.failed', { error }); res.status(503).json({ status: 'unavailable' }); return; }
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    features: ['reports', 'field-teams', 'pdf-export', 'urgent-alerts', 'offline-pwa', 'deferred-ai-classification'],
  });
});

app.use('/api/reports', reportsWriteLimiter, reportsRouter);
app.use('/api/admin/login', authLimiter);
app.use('/api/admin', adminRouter);
app.use('/api/export', exportRouter);
app.use('/api/users', usersRouter);
app.use('/api/pdf', pdfRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/form-builder', formBuilderRouter);
app.use('/api/ai', aiRouter);
app.use('/api/contributors', contributorsRouter);
app.use('/api/consent', consentRouter);
app.use('/api/whatsapp', whatsappIntegrationRouter);
app.use('/api/footprints', footprintsRouter);
app.use('/api/content', contentRouter);
app.use('/api/public', publicContentRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorLogging);

async function start() {
  validateStartupConfig();
  await initRuntimeDb();
  await backfillReportVersioning();
  await ensureAiSettingsDefaults();
  startReportBackgroundWorkers();
  startAiBackgroundWorkers();
  app.listen(PORT, () => {
    logger.info('api.started', { port: PORT, version: '1.0.0', database: 'postgresql' });
  });
}
start().catch(async (err: unknown) => {
  logger.error('api.startup.failed', { error: err });
  await flushErrorMonitoring();
  process.exit(1);
});

process.on('unhandledRejection', async (error: unknown) => {
  logger.error('process.unhandled_rejection', { error });
  await flushErrorMonitoring();
  process.exit(1);
});
process.on('uncaughtException', async (error: Error) => {
  logger.error('process.uncaught_exception', { error });
  await flushErrorMonitoring();
  process.exit(1);
});

export default app;
