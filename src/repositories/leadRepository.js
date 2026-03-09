const { nowIso } = require('../utils/date');

function createLeadRepository(db) {
  const deleteForProcess = db.prepare('DELETE FROM leads WHERE process_id = ?');
  const insertLead = db.prepare(`
    INSERT INTO leads (
      process_id, entity, fecha_publ, nomenclature, object, description, valor_ref,
      fecha_b_pro, estado, fideicomiso, postor_ruc, postor_nom, telefono, email,
      row_type, source_url, confidence, delivered_at, created_at, updated_at
    ) VALUES (
      @process_id, @entity, @fecha_publ, @nomenclature, @object, @description, @valor_ref,
      @fecha_b_pro, @estado, @fideicomiso, @postor_ruc, @postor_nom, @telefono, @email,
      @row_type, @source_url, @confidence, @delivered_at, @created_at, @updated_at
    )
  `);

  const replaceForProcess = db.transaction((processId, rows) => {
    deleteForProcess.run(processId);
    const timestamp = nowIso();
    for (const row of rows) {
      insertLead.run({
        process_id: processId,
        entity: row.entity,
        fecha_publ: row.fecha_publ,
        nomenclature: row.nomenclature,
        object: row.object,
        description: row.description,
        valor_ref: row.valor_ref,
        fecha_b_pro: row.fecha_b_pro,
        estado: row.estado,
        fideicomiso: row.fideicomiso,
        postor_ruc: row.postor_ruc,
        postor_nom: row.postor_nom,
        telefono: row.telefono,
        email: row.email,
        row_type: row.row_type || 'empresa',
        source_url: row.source_url || null,
        confidence: row.confidence || null,
        delivered_at: row.delivered_at || null,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }
  });

  return {
    replaceForProcess,
    list({ limit = 200 } = {}) {
      return db.prepare(`
        SELECT leads.*, processes.pdf_url, processes.process_url
        FROM leads
        JOIN processes ON processes.id = leads.process_id
        ORDER BY leads.updated_at DESC
        LIMIT ?
      `).all(limit);
    },
    getByProcessId(processId) {
      return db.prepare('SELECT * FROM leads WHERE process_id = ? ORDER BY id ASC').all(processId);
    },
    markDelivered(processId) {
      db.prepare('UPDATE leads SET delivered_at = ?, updated_at = ? WHERE process_id = ?').run(nowIso(), nowIso(), processId);
    },
  };
}

module.exports = { createLeadRepository };
