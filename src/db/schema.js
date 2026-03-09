function createSchemaSql() {
  return `
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS processes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nomenclature TEXT NOT NULL UNIQUE,
      entity TEXT,
      publish_date TEXT,
      object TEXT,
      description TEXT,
      reference_value REAL NOT NULL DEFAULT 0,
      award_date TEXT,
      status TEXT,
      fideicomiso TEXT,
      process_url TEXT,
      pdf_url TEXT,
      winner_name TEXT,
      winner_ruc TEXT,
      winner_type TEXT,
      phone TEXT,
      email TEXT,
      pdf_text_excerpt TEXT,
      review_state TEXT NOT NULL DEFAULT 'pending_review',
      next_review_at TEXT,
      last_review_at TEXT,
      last_error TEXT,
      source_file TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_id INTEGER NOT NULL,
      entity TEXT,
      fecha_publ TEXT,
      nomenclature TEXT,
      object TEXT,
      description TEXT,
      valor_ref REAL,
      fecha_b_pro TEXT,
      estado TEXT,
      fideicomiso TEXT,
      postor_ruc TEXT,
      postor_nom TEXT,
      telefono TEXT,
      email TEXT,
      row_type TEXT NOT NULL DEFAULT 'empresa',
      source_url TEXT,
      confidence REAL,
      delivered_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(process_id) REFERENCES processes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      event_name TEXT NOT NULL,
      message TEXT NOT NULL,
      meta_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_processes_next_review ON processes(next_review_at);
    CREATE INDEX IF NOT EXISTS idx_processes_review_state ON processes(review_state);
    CREATE INDEX IF NOT EXISTS idx_leads_process_id ON leads(process_id);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
  `;
}

module.exports = { createSchemaSql };
