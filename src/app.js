const Fastify = require('fastify');
const multipart = require('@fastify/multipart');
const { env } = require('./config/env');
const { logger } = require('./utils/logger');
const { createSseBus } = require('./utils/sseBus');
const { createDatabase } = require('./db/database');
const { createProcessRepository } = require('./repositories/processRepository');
const { createLeadRepository } = require('./repositories/leadRepository');
const { createEventRepository } = require('./repositories/eventRepository');
const { ensureDirs } = require('./services/fileStore');
const { SeaceBrowserClient } = require('./services/seaceBrowserClient');
const { N8nClient } = require('./services/n8nClient');
const { createIngestionFlow } = require('./flows/ingestionFlow');
const { createReviewDueProcessesFlow } = require('./flows/reviewDueProcessesFlow');
const { startScheduler } = require('./jobs/scheduler');
const { registerRoutes } = require('./api/routes');

async function createApp({ startJobs = true } = {}) {
  ensureDirs();

  const db = createDatabase();
  const sseBus = createSseBus();
  const processRepository = createProcessRepository(db, env);
  const leadRepository = createLeadRepository(db);
  const eventRepository = createEventRepository(db);
  const seaceBrowserClient = new SeaceBrowserClient(logger);
  const n8nClient = new N8nClient({
    webhookUrl: env.n8nWebhookUrl,
    logger,
    timeoutMs: env.n8nTimeoutMs,
    maxRetries: env.n8nMaxRetries,
  });

  function emitEvent(level, eventName, message, meta = {}) {
    const event = {
      level,
      eventName,
      message,
      meta,
      timestamp: new Date().toISOString(),
    };

    logger[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info']({ event }, message);
    eventRepository.create(level, eventName, message, meta);
    sseBus.publish(event);
  }

  const ingestionFlow = createIngestionFlow({ env, processRepository, emitEvent, logger, seaceBrowserClient });
  const reviewFlow = createReviewDueProcessesFlow({
    env,
    processRepository,
    leadRepository,
    seaceBrowserClient,
    n8nClient,
    emitEvent,
    logger,
  });

  const fastify = Fastify({
    logger: false,
    trustProxy: env.trustProxy,
    requestTimeout: env.requestTimeoutMs,
    bodyLimit: 20 * 1024 * 1024,
  });

  fastify.setErrorHandler((error, request, reply) => {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    const message = statusCode >= 500 ? 'Error interno del servidor' : error.message;
    const logPayload = {
      err: error,
      method: request.method,
      url: request.url,
      statusCode,
    };

    if (statusCode >= 500) {
      logger.error(logPayload, 'Request failed');
    } else {
      logger.warn(logPayload, 'Request rejected');
    }

    if (reply.raw.headersSent) {
      return;
    }

    reply.code(statusCode).send({
      ok: false,
      error: message,
      details: statusCode >= 500 ? undefined : error.details,
    });
  });

  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ ok: false, error: `Ruta no encontrada: ${request.url}` });
  });

  await fastify.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024,
      files: 1,
    },
  });

  const context = {
    env,
    db,
    sseBus,
    processRepository,
    leadRepository,
    eventRepository,
    seaceBrowserClient,
    n8nClient,
    ingestionFlow,
    reviewFlow,
    emitEvent,
  };

  await registerRoutes(fastify, context);

  let scheduler = null;
  if (env.enableScheduler && startJobs) {
    scheduler = startScheduler({ env, emitEvent, ingestionFlow, reviewFlow });
  }

  fastify.addHook('onClose', async () => {
    if (scheduler) {
      scheduler.stop();
    }
    await seaceBrowserClient.close();
    db.close();
  });

  emitEvent('info', 'APP_READY', 'SEACE Core listo', {
    scheduler: Boolean(scheduler),
    databasePath: env.databasePath,
  });

  return { app: fastify, context };
}

module.exports = { createApp };
