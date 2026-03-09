const path = require('path');
const { parseExcel } = require('../services/excelParser');
const { listInboxExcels, moveToArchive, saveUpload } = require('../services/fileStore');

function createIngestionFlow({ env, processRepository, emitEvent, logger, seaceBrowserClient }) {
  async function ingestFile(filePath) {
    const rows = parseExcel(filePath, env.minReferenceValue);
    processRepository.upsertMany(rows, path.basename(filePath));
    const archivedPath = moveToArchive(filePath);
    emitEvent('info', 'EXCEL_INGESTED', `Excel procesado: ${rows.length} candidatos`, {
      filePath,
      archivedPath,
      rows: rows.length,
    });
    return { rows: rows.length, archivedPath };
  }

  async function fetchPublicExcel() {
    if (!env.autoFetchPublicExcel) {
      return { skipped: true, reason: 'AUTO_FETCH_PUBLIC_EXCEL deshabilitado' };
    }

    const downloaded = await seaceBrowserClient.downloadPublicSearchExcel({
      objectValue: env.publicSearchObjectValue,
      year: env.publicSearchYear,
    });
    const filePath = saveUpload(downloaded.fileName, downloaded.buffer);

    emitEvent('info', 'SEACE_EXCEL_FETCHED', 'Excel descargado automaticamente desde SEACE', {
      filePath,
      fileName: downloaded.fileName,
      year: downloaded.year,
      objectValue: downloaded.objectValue,
    });

    return {
      skipped: false,
      filePath,
      fileName: downloaded.fileName,
      year: downloaded.year,
      objectValue: downloaded.objectValue,
    };
  }

  async function ingestFiles(filePaths) {
    const results = [];
    for (const filePath of filePaths) {
      try {
        results.push({ filePath, ...(await ingestFile(filePath)) });
      } catch (error) {
        logger.error({ err: error, filePath }, 'Error al ingerir Excel');
        emitEvent('error', 'EXCEL_INGEST_FAILED', error.message, { filePath });
        results.push({ filePath, error: error.message });
      }
    }
    return results;
  }

  async function runIngestionCycle() {
    let fetched = null;

    if (env.autoFetchPublicExcel) {
      try {
        fetched = await fetchPublicExcel();
      } catch (error) {
        logger.error({ err: error }, 'Error descargando Excel desde SEACE');
        emitEvent('error', 'SEACE_EXCEL_FETCH_FAILED', error.message, {
          year: env.publicSearchYear,
          objectValue: env.publicSearchObjectValue,
        });
      }
    }

    const files = listInboxExcels();
    const results = await ingestFiles(files);
    return {
      fetched,
      files: files.length,
      results,
    };
  }

  return {
    fetchPublicExcel,
    ingestFile,
    ingestFiles,
    runIngestionCycle,
  };
}

module.exports = { createIngestionFlow };
