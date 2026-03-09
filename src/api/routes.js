const fs = require('fs');
const { listInboxExcels, saveUpload } = require('../services/fileStore');
const { renderDashboardHtml } = require('./dashboardHtml');
const { assertAuthorized, buildAuthCookie, isAuthorized } = require('../utils/auth');
const { createHttpError } = require('../utils/http');

function parsePositiveInt(value, fallback, max = 5000) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function rowsToCsv(rows) {
  const headers = [
    'ENTIDAD', 'FECHA_PUBL', 'NOMENCLATURA', 'OBJETO', 'DESCRIPCION', 'VALOR_REF',
    'FECHA_B_PRO', 'ESTADO', 'FIDEICOMISO', 'POSTOR_RUC', 'POSTOR_NOM', 'TELEFONO', 'EMAIL', 'ROW_TYPE',
  ];

  const lines = [headers.join(',')];
  for (const row of rows) {
    const values = [
      row.entity,
      row.fecha_publ,
      row.nomenclature,
      row.object,
      row.description,
      row.valor_ref,
      row.fecha_b_pro,
      row.estado,
      row.fideicomiso,
      row.postor_ruc,
      row.postor_nom,
      row.telefono,
      row.email,
      row.row_type,
    ].map((value) => `"${String(value || '').replace(/"/g, '""')}"`);
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

async function registerRoutes(fastify, context) {
  const {
    env,
    processRepository,
    leadRepository,
    eventRepository,
    ingestionFlow,
    reviewFlow,
    sseBus,
    emitEvent,
  } = context;

  async function ensureApiAccess(request) {
    assertAuthorized(request, env);
  }

  function maybePersistDashboardAuth(request, reply) {
    if (env.apiToken && isAuthorized(request, env) && String(request.query?.token || '').trim() === env.apiToken) {
      reply.header('set-cookie', buildAuthCookie(env));
    }
  }

  fastify.get('/', async (_, reply) => reply.redirect('/dashboard'));

  fastify.get('/dashboard', async (request, reply) => {
    ensureApiAccess(request);
    maybePersistDashboardAuth(request, reply);
    reply.type('text/html').send(renderDashboardHtml());
  });

  fastify.get('/health', async () => {
    const summary = processRepository.countSummary();
    const pendingReview = summary.processCounts.find((item) => item.review_state === 'pending_review')?.total || 0;
    const scheduled = summary.processCounts.find((item) => item.review_state === 'scheduled')?.total || 0;
    const retry = summary.processCounts.find((item) => item.review_state === 'retry')?.total || 0;
    const completed = summary.processCounts.find((item) => item.review_state === 'completed')?.total || 0;

    return {
      status: 'ok',
      service: env.appName,
      scheduler: env.enableScheduler,
      summary: {
        totalProcesses: summary.processCounts.reduce((acc, item) => acc + item.total, 0),
        totalLeads: summary.leadCount,
        pendingReview: pendingReview + scheduled + retry,
        completed,
      },
    };
  });

  fastify.get('/api/stream', { preHandler: ensureApiAccess }, async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    const send = (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    for (const event of sseBus.getRecent()) {
      send(event);
    }

    const unsubscribe = sseBus.subscribe(send);
    const keepAlive = setInterval(() => {
      reply.raw.write(': keep-alive\n\n');
    }, 15000);

    request.raw.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  fastify.post('/api/uploads/excel', { preHandler: ensureApiAccess }, async (request) => {
    const part = await request.file();
    if (!part) {
      throw createHttpError(400, 'No se recibio archivo');
    }

    if (!/\.(xlsx|xls)$/i.test(part.filename || '')) {
      throw createHttpError(400, 'Solo se permiten archivos Excel .xlsx o .xls');
    }

    const buffer = await part.toBuffer();
    const filePath = saveUpload(part.filename, buffer);
    const result = await ingestionFlow.ingestFile(filePath);
    return { ok: true, filePath, ...result };
  });

  fastify.post('/api/jobs/ingest', { preHandler: ensureApiAccess }, async () => {
    const result = await ingestionFlow.runIngestionCycle();
    return { ok: true, ...result };
  });

  fastify.post('/api/jobs/fetch-excel', { preHandler: ensureApiAccess }, async () => {
    const result = await ingestionFlow.fetchPublicExcel();
    return { ok: true, ...result };
  });

  fastify.post('/api/jobs/review-due', { preHandler: ensureApiAccess }, async () => {
    const result = await reviewFlow.reviewDueProcesses();
    return { ok: true, ...result };
  });

  fastify.post('/api/processes/:id/review', { preHandler: ensureApiAccess }, async (request) => {
    const processId = parsePositiveInt(request.params.id, NaN, Number.MAX_SAFE_INTEGER);
    if (!Number.isInteger(processId)) {
      throw createHttpError(400, 'Id de proceso invalido');
    }

    const processRow = processRepository.getById(processId);
    if (!processRow) {
      throw createHttpError(404, 'Proceso no encontrado');
    }

    try {
      const result = await reviewFlow.reviewProcess(processRow);
      return { ok: true, result };
    } catch (error) {
      processRepository.markError(processRow.id, error.message);
      emitEvent('error', 'PROCESS_REVIEW_FAILED', error.message, {
        processId: processRow.id,
        nomenclature: processRow.nomenclature,
        source: 'manual_route',
      });
      throw error;
    }
  });

  fastify.get('/api/processes', { preHandler: ensureApiAccess }, async (request) => {
    const limit = parsePositiveInt(request.query.limit, 100, 500);
    return { items: processRepository.list({ limit }) };
  });

  fastify.get('/api/leads', { preHandler: ensureApiAccess }, async (request) => {
    const limit = parsePositiveInt(request.query.limit, 200, 1000);
    return { items: leadRepository.list({ limit }) };
  });

  fastify.get('/api/events', { preHandler: ensureApiAccess }, async (request) => {
    const limit = parsePositiveInt(request.query.limit, 50, 500);
    return { items: eventRepository.recent(limit) };
  });

  fastify.get('/api/exports/leads.csv', { preHandler: ensureApiAccess }, async (_, reply) => {
    const rows = leadRepository.list({ limit: 5000 });
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="leads.csv"');
    reply.send(rowsToCsv(rows));
  });

  fastify.get('/api/files/inbox', { preHandler: ensureApiAccess }, async () => {
    return { items: listInboxExcels().map((filePath) => ({ filePath, size: fs.statSync(filePath).size })) };
  });
}

module.exports = { registerRoutes };
