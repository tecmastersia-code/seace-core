const { addDays, addHours, isFuture, toDisplayDate } = require('../utils/date');
const { extractPdfData } = require('../services/pdfExtractor');
const { savePdf } = require('../services/fileStore');

function createLeadRows(processRow, reviewData, pdfData) {
  const base = {
    entity: processRow.entity,
    fecha_publ: toDisplayDate(processRow.publish_date),
    nomenclature: processRow.nomenclature,
    object: processRow.object,
    description: processRow.description,
    valor_ref: processRow.reference_value,
    fecha_b_pro: toDisplayDate(reviewData.awardDate || processRow.award_date),
    estado: reviewData.status || processRow.status,
    fideicomiso: processRow.fideicomiso,
    source_url: reviewData.pdfUrl || processRow.pdf_url || reviewData.processUrl || processRow.process_url,
    confidence: pdfData.confidence,
  };

  if (pdfData.winnerType === 'consorcio') {
    const rows = [{
      ...base,
      row_type: 'consorcio',
      postor_ruc: 'CONSORCIO',
      postor_nom: pdfData.winnerName || processRow.winner_name,
      telefono: pdfData.phone,
      email: pdfData.email,
    }];

    for (const member of pdfData.members) {
      rows.push({
        ...base,
        row_type: 'integrante',
        postor_ruc: member.ruc,
        postor_nom: member.name,
        telefono: member.phone,
        email: member.email,
      });
    }

    return rows;
  }

  return [{
    ...base,
    row_type: 'empresa',
    postor_ruc: pdfData.winnerRuc || processRow.winner_ruc,
    postor_nom: pdfData.winnerName || processRow.winner_name,
    telefono: pdfData.phone,
    email: pdfData.email,
  }];
}

function createReviewDueProcessesFlow({
  env,
  processRepository,
  leadRepository,
  seaceBrowserClient,
  n8nClient,
  emitEvent,
  logger,
}) {
  async function reviewProcess(processRow) {
    processRepository.markReviewStarted(processRow.id);

    const reviewData = await seaceBrowserClient.reviewProcess(processRow);
    const effectiveAwardDate = reviewData.awardDate || processRow.award_date;

    if (isFuture(effectiveAwardDate)) {
      const nextReviewAt = addDays(effectiveAwardDate, 1);
      processRepository.updateAfterReview(processRow.id, {
        award_date: effectiveAwardDate,
        status: reviewData.status,
        process_url: reviewData.processUrl,
        pdf_url: reviewData.pdfUrl,
        review_state: 'scheduled',
        next_review_at: nextReviewAt,
      });
      emitEvent('info', 'PROCESS_SCHEDULED', 'Proceso programado para revision posterior a Buena Pro', {
        processId: processRow.id,
        nomenclature: processRow.nomenclature,
        nextReviewAt,
      });
      return { processId: processRow.id, scheduled: true };
    }

    const pdfUrl = reviewData.pdfUrl || processRow.pdf_url;
    if (!pdfUrl && !reviewData.pdfBuffer) {
      processRepository.updateAfterReview(processRow.id, {
        award_date: effectiveAwardDate,
        status: reviewData.status,
        process_url: reviewData.processUrl,
        review_state: 'retry',
        next_review_at: addHours(new Date().toISOString(), env.reviewIntervalHours),
        last_error: 'No se encontro PDF ganador',
      });
      emitEvent('warn', 'PDF_PENDING', 'Proceso sin PDF ganador disponible', {
        processId: processRow.id,
        nomenclature: processRow.nomenclature,
      });
      return { processId: processRow.id, scheduled: true, reason: 'pdf_missing' };
    }

    const downloaded = reviewData.pdfBuffer
      ? { fileName: reviewData.pdfFileName || 'oferta.pdf', buffer: reviewData.pdfBuffer }
      : await seaceBrowserClient.downloadPdf(pdfUrl);
    const pdfPath = savePdf(downloaded.fileName, downloaded.buffer);
    const pdfData = await extractPdfData(pdfPath);
    const reviewMembers = (reviewData.members || []).filter(Boolean);
    const resolvedPdfData = {
      ...pdfData,
      winnerName: reviewData.winnerName || processRow.winner_name || pdfData.winnerName,
      winnerRuc: reviewData.winnerRuc || processRow.winner_ruc || pdfData.winnerRuc,
      members: (reviewMembers.length ? reviewMembers : pdfData.members || []).filter(Boolean),
    };

    if ((reviewMembers.length || /consorcio/i.test(reviewData.winnerName || '')) && resolvedPdfData.winnerType !== 'consorcio') {
      resolvedPdfData.winnerType = 'consorcio';
    }

    if (resolvedPdfData.members.length && resolvedPdfData.winnerType !== 'consorcio') {
      resolvedPdfData.winnerType = 'consorcio';
    }

    const leads = createLeadRows(processRow, reviewData, resolvedPdfData);

    leadRepository.replaceForProcess(processRow.id, leads);
    processRepository.updateAfterReview(processRow.id, {
      award_date: effectiveAwardDate,
      status: reviewData.status,
      process_url: reviewData.processUrl,
      pdf_url: pdfUrl,
      winner_name: resolvedPdfData.winnerName,
      winner_ruc: resolvedPdfData.winnerRuc,
      winner_type: resolvedPdfData.winnerType,
      phone: resolvedPdfData.phone,
      email: resolvedPdfData.email,
      pdf_text_excerpt: resolvedPdfData.excerpt,
      review_state: 'completed',
      next_review_at: null,
      last_error: null,
    });

    const delivery = await n8nClient.deliver({
      source: 'seace-core',
      process: {
        id: processRow.id,
        nomenclature: processRow.nomenclature,
        status: reviewData.status || processRow.status,
        awardDate: effectiveAwardDate,
        processUrl: reviewData.processUrl || processRow.process_url,
        pdfUrl,
      },
      leads,
    });

    if (!delivery.skipped) {
      leadRepository.markDelivered(processRow.id);
    }

    emitEvent('info', 'PROCESS_COMPLETED', delivery.skipped ? 'Proceso resuelto y pendiente de webhook n8n' : 'Proceso resuelto y enviado a n8n', {
      processId: processRow.id,
      nomenclature: processRow.nomenclature,
      leads: leads.length,
      delivered: !delivery.skipped,
    });

    return { processId: processRow.id, leads: leads.length, completed: true };
  }

  async function reviewDueProcesses() {
    const dueProcesses = processRepository.findDueForReview(env.maxReviewBatch);
    const results = [];

    for (const processRow of dueProcesses) {
      try {
        results.push(await reviewProcess(processRow));
      } catch (error) {
        logger.error({ err: error, processId: processRow.id }, 'Error revisando proceso');
        processRepository.markError(processRow.id, error.message);
        emitEvent('error', 'PROCESS_REVIEW_FAILED', error.message, {
          processId: processRow.id,
          nomenclature: processRow.nomenclature,
        });
        results.push({ processId: processRow.id, error: error.message });
      }
    }

    return {
      scanned: dueProcesses.length,
      results,
    };
  }

  return {
    reviewDueProcesses,
    reviewProcess,
  };
}

module.exports = { createReviewDueProcessesFlow };
