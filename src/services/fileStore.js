const fs = require('fs');
const path = require('path');
const { env } = require('../config/env');

function ensureDirs() {
  [env.inboxDir, env.archiveDir, env.downloadDir, env.tmpDir, env.sessionDir].forEach((dirPath) => {
    fs.mkdirSync(dirPath, { recursive: true });
  });
}

function sanitizeFileName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function moveToArchive(filePath) {
  const fileName = path.basename(filePath);
  const archivedName = `${Date.now()}_${sanitizeFileName(fileName)}`;
  const targetPath = path.join(env.archiveDir, archivedName);
  fs.renameSync(filePath, targetPath);
  return targetPath;
}

function saveUpload(fileName, buffer) {
  const targetPath = path.join(env.inboxDir, `${Date.now()}_${sanitizeFileName(fileName)}`);
  fs.writeFileSync(targetPath, buffer);
  return targetPath;
}

function listInboxExcels() {
  return fs.readdirSync(env.inboxDir)
    .filter((fileName) => /\.(xlsx|xls)$/i.test(fileName))
    .map((fileName) => path.join(env.inboxDir, fileName));
}

function savePdf(fileName, buffer) {
  const targetPath = path.join(env.downloadDir, `${Date.now()}_${sanitizeFileName(fileName)}`);
  fs.writeFileSync(targetPath, buffer);
  return targetPath;
}

function cleanupTmpDir(maxAgeMs = 24 * 60 * 60 * 1000) {
  const now = Date.now();
  for (const name of fs.readdirSync(env.tmpDir)) {
    const fullPath = path.join(env.tmpDir, name);
    const stats = fs.statSync(fullPath);
    if (now - stats.mtimeMs > maxAgeMs) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }
}

module.exports = {
  cleanupTmpDir,
  ensureDirs,
  listInboxExcels,
  moveToArchive,
  savePdf,
  saveUpload,
};
