const { addDays, addHours, nowIso } = require('../utils/date');

function createProcessRepository(db, env) {
  const upsertStatement = db.prepare(`
    INSERT INTO processes (
      nomenclature, entity, publish_date, object, description, reference_value,
      award_date, status, fideicomiso, process_url, pdf_url, review_state,
      next_review_at, source_file, raw_json, created_at, updated_at
    ) VALUES (
      @nomenclature, @entity, @publish_date, @object, @description, @reference_value,
      @award_date, @status, @fideicomiso, @process_url, @pdf_url, @review_state,
      @next_review_at, @source_file, @raw_json, @created_at, @updated_at
    )
    ON CONFLICT(nomenclature) DO UPDATE SET
      entity = excluded.entity,
      publish_date = COALESCE(excluded.publish_date, processes.publish_date),
      object = COALESCE(excluded.object, processes.object),
      description = COALESCE(excluded.description, processes.description),
      reference_value = excluded.reference_value,
      award_date = COALESCE(excluded.award_date, processes.award_date),
      status = COALESCE(excluded.status, processes.status),
      fideicomiso = COALESCE(excluded.fideicomiso, processes.fideicomiso),
      process_url = COALESCE(excluded.process_url, processes.process_url),
      pdf_url = COALESCE(excluded.pdf_url, processes.pdf_url),
      review_state = excluded.review_state,
      next_review_at = excluded.next_review_at,
      source_file = excluded.source_file,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `);

  const upsertMany = db.transaction((rows, sourceFile) => {
    const timestamp = nowIso();
    for (const row of rows) {
      const nextReviewAt = row.award_date
        ? (new Date(row.award_date).getTime() > Date.now() ? addDays(row.award_date, 1) : timestamp)
        : timestamp;

      upsertStatement.run({
        nomenclature: row.nomenclature,
        entity: row.entity,
        publish_date: row.publish_date,
        object: row.object,
        description: row.description,
        reference_value: row.reference_value,
        award_date: row.award_date,
        status: row.status,
        fideicomiso: row.fideicomiso,
        process_url: row.process_url,
        pdf_url: row.pdf_url,
        review_state: row.award_date && new Date(row.award_date).getTime() > Date.now() ? 'scheduled' : 'pending_review',
        next_review_at: nextReviewAt,
        source_file: sourceFile,
        raw_json: JSON.stringify(row.raw || row),
        created_at: timestamp,
        updated_at: timestamp,
      });
    }
  });

  return {
    upsertMany,
    list({ limit = 100 } = {}) {
      return db.prepare(`
        SELECT * FROM processes
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(limit);
    },
    getById(id) {
      return db.prepare('SELECT * FROM processes WHERE id = ?').get(id);
    },
    findDueForReview(limit = env.maxReviewBatch) {
      return db.prepare(`
        SELECT * FROM processes
        WHERE review_state IN ('pending_review', 'scheduled', 'retry')
          AND (next_review_at IS NULL OR next_review_at <= ?)
        ORDER BY COALESCE(next_review_at, created_at) ASC
        LIMIT ?
      `).all(nowIso(), limit);
    },
    markScheduled(id, nextReviewAt, state = 'scheduled') {
      db.prepare(`
        UPDATE processes
        SET review_state = ?, next_review_at = ?, updated_at = ?
        WHERE id = ?
      `).run(state, nextReviewAt, nowIso(), id);
    },
    markReviewStarted(id) {
      db.prepare(`
        UPDATE processes
        SET review_state = 'reviewing', last_review_at = ?, updated_at = ?
        WHERE id = ?
      `).run(nowIso(), nowIso(), id);
    },
    markError(id, errorMessage) {
      db.prepare(`
        UPDATE processes
        SET review_state = 'retry', last_error = ?, next_review_at = ?, updated_at = ?
        WHERE id = ?
      `).run(errorMessage, addHours(nowIso(), env.reviewIntervalHours), nowIso(), id);
    },
    updateAfterReview(id, payload) {
      const hasNextReviewAt = Object.prototype.hasOwnProperty.call(payload, 'next_review_at');
      db.prepare(`
        UPDATE processes
        SET
          award_date = COALESCE(@award_date, award_date),
          status = COALESCE(@status, status),
          process_url = COALESCE(@process_url, process_url),
          pdf_url = COALESCE(@pdf_url, pdf_url),
          winner_name = COALESCE(@winner_name, winner_name),
          winner_ruc = COALESCE(@winner_ruc, winner_ruc),
          winner_type = COALESCE(@winner_type, winner_type),
          phone = COALESCE(@phone, phone),
          email = COALESCE(@email, email),
        pdf_text_excerpt = COALESCE(@pdf_text_excerpt, pdf_text_excerpt),
        review_state = @review_state,
        next_review_at = @next_review_at,
          last_error = @last_error,
          updated_at = @updated_at,
          last_review_at = @last_review_at
        WHERE id = @id
      `).run({
        id,
        award_date: payload.award_date || null,
        status: payload.status || null,
        process_url: payload.process_url || null,
        pdf_url: payload.pdf_url || null,
        winner_name: payload.winner_name || null,
        winner_ruc: payload.winner_ruc || null,
        winner_type: payload.winner_type || null,
        phone: payload.phone || null,
        email: payload.email || null,
        pdf_text_excerpt: payload.pdf_text_excerpt || null,
        review_state: payload.review_state || 'pending_review',
        next_review_at: hasNextReviewAt ? payload.next_review_at : addHours(nowIso(), env.reviewIntervalHours),
        last_error: payload.last_error || null,
        last_review_at: nowIso(),
        updated_at: nowIso(),
      });
    },
    countSummary() {
      const processCounts = db.prepare(`
        SELECT review_state, COUNT(*) as total
        FROM processes
        GROUP BY review_state
      `).all();
      const leadCount = db.prepare('SELECT COUNT(*) as total FROM leads').get();
      return { processCounts, leadCount: leadCount.total };
    },
  };
}

module.exports = { createProcessRepository };
