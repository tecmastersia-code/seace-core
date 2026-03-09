const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { env } = require('../config/env');
const { createSchemaSql } = require('./schema');

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createDatabase() {
  ensureParentDir(env.databasePath);
  const raw = new DatabaseSync(env.databasePath);
  raw.exec(createSchemaSql());

  return {
    exec(sql) {
      return raw.exec(sql);
    },
    prepare(sql) {
      return raw.prepare(sql);
    },
    transaction(work) {
      return (...args) => {
        raw.exec('BEGIN');
        try {
          const result = work(...args);
          raw.exec('COMMIT');
          return result;
        } catch (error) {
          raw.exec('ROLLBACK');
          throw error;
        }
      };
    },
    close() {
      return raw.close();
    },
  };
}

module.exports = { createDatabase };
