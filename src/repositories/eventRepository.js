const { nowIso } = require('../utils/date');

function createEventRepository(db) {
  const insertStatement = db.prepare(`
    INSERT INTO events (level, event_name, message, meta_json, created_at)
    VALUES (@level, @event_name, @message, @meta_json, @created_at)
  `);

  return {
    create(level, eventName, message, meta) {
      insertStatement.run({
        level,
        event_name: eventName,
        message,
        meta_json: meta ? JSON.stringify(meta) : null,
        created_at: nowIso(),
      });
    },
    recent(limit = 50) {
      return db.prepare(`
        SELECT * FROM events
        ORDER BY id DESC
        LIMIT ?
      `).all(limit);
    },
  };
}

module.exports = { createEventRepository };
