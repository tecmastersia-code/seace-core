const path = require('path');
const fs = require('fs');

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function currentYear() {
  return new Date().getUTCFullYear();
}

function pickExistingPath(candidates, fallback = '') {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return fallback;
}

function defaultWindowsTesseractPath() {
  return pickExistingPath([
    'C:\\Program Files\\Tesseract-OCR\\tesseract.exe',
    'C:\\Users\\Tecmasters\\AppData\\Local\\TesseractOCR\\tesseract.exe',
  ], 'tesseract');
}

function defaultWindowsPdftoppmPath() {
  return pickExistingPath([
    'C:\\Users\\Tecmasters\\AppData\\Local\\Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\\poppler-25.07.0\\Library\\bin\\pdftoppm.exe',
  ], 'pdftoppm');
}

function defaultOcrLanguage(tesseractBin) {
  if (process.platform !== 'win32') {
    return 'spa+eng';
  }

  if (!tesseractBin || !fs.existsSync(tesseractBin)) {
    return 'spa+eng';
  }

  const tessdataDir = path.join(path.dirname(tesseractBin), 'tessdata');
  const hasSpa = fs.existsSync(path.join(tessdataDir, 'spa.traineddata'));
  const hasEng = fs.existsSync(path.join(tessdataDir, 'eng.traineddata'));

  if (hasSpa && hasEng) {
    return 'spa+eng';
  }

  if (hasEng) {
    return 'eng';
  }

  return 'spa+eng';
}

const resolvedOcrTesseractBin = process.env.OCR_TESSERACT_BIN || (process.platform === 'win32' ? defaultWindowsTesseractPath() : 'tesseract');
const resolvedOcrPdftoppmBin = process.env.OCR_PDFTOPPM_BIN || (process.platform === 'win32' ? defaultWindowsPdftoppmPath() : 'pdftoppm');

function resolveFromRoot(relativePath) {
  return path.resolve(process.cwd(), relativePath);
}

function loadEnvFile() {
  const fs = require('fs');
  const envPath = path.resolve(process.cwd(), '.env');

  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const cleanValue = rawValue.replace(/^"|"$/g, '');
    if (process.env[key] === undefined) {
      process.env[key] = cleanValue;
    }
  }
}

loadEnvFile();

const env = {
  appName: 'seace-core',
  host: process.env.HOST || '0.0.0.0',
  port: parseNumber(process.env.PORT, 3000),
  logLevel: process.env.LOG_LEVEL || 'info',
  trustProxy: parseBoolean(process.env.TRUST_PROXY, true),
  requestTimeoutMs: parseNumber(process.env.REQUEST_TIMEOUT_MS, 30000),
  databasePath: resolveFromRoot(process.env.DATABASE_PATH || './data/seace.sqlite'),
  inboxDir: resolveFromRoot(process.env.INBOX_DIR || './data/inbox'),
  archiveDir: resolveFromRoot(process.env.ARCHIVE_DIR || './data/archive'),
  downloadDir: resolveFromRoot(process.env.DOWNLOAD_DIR || './data/downloads'),
  tmpDir: resolveFromRoot(process.env.TMP_DIR || './data/tmp'),
  sessionDir: resolveFromRoot(process.env.SESSION_DIR || './data/sessions/seace'),
  apiToken: process.env.API_TOKEN || '',
  authCookieName: process.env.AUTH_COOKIE_NAME || 'seace_core_auth',
  authCookieSecure: parseBoolean(process.env.AUTH_COOKIE_SECURE, false),
  minReferenceValue: parseNumber(process.env.MIN_REFERENCE_VALUE, 5000000),
  reviewIntervalHours: parseNumber(process.env.REVIEW_INTERVAL_HOURS, 24),
  ingestCron: process.env.INGEST_CRON || '0 * * * *',
  reviewCron: process.env.REVIEW_CRON || '15 */4 * * *',
  enableScheduler: parseBoolean(process.env.ENABLE_SCHEDULER, true),
  seaceBaseUrl: process.env.SEACE_BASE_URL || 'https://www.seace.gob.pe/',
  seacePublicSearchUrl: process.env.SEACE_PUBLIC_SEARCH_URL || 'https://prod2.seace.gob.pe/seacebus-uiwd-pub/buscadorPublico/buscadorPublico.xhtml',
  seaceSearchUrlTemplate: process.env.SEACE_SEARCH_URL_TEMPLATE || '',
  autoFetchPublicExcel: parseBoolean(process.env.AUTO_FETCH_PUBLIC_EXCEL, true),
  publicSearchObjectValue: process.env.PUBLIC_SEARCH_OBJECT_VALUE || '64',
  publicSearchYear: String(parseNumber(process.env.PUBLIC_SEARCH_YEAR, currentYear())),
  seaceNavigationTimeoutMs: parseNumber(process.env.SEACE_NAVIGATION_TIMEOUT_MS, 60000),
  seaceSettleDelayMs: parseNumber(process.env.SEACE_SETTLE_DELAY_MS, 2500),
  seaceResultsTimeoutMs: parseNumber(process.env.SEACE_RESULTS_TIMEOUT_MS, 60000),
  seaceExportDelayMs: parseNumber(process.env.SEACE_EXPORT_DELAY_MS, 15000),
  ocrEnabled: parseBoolean(process.env.OCR_ENABLED, true),
  ocrLang: process.env.OCR_LANG || defaultOcrLanguage(resolvedOcrTesseractBin),
  ocrTesseractBin: resolvedOcrTesseractBin,
  ocrPdftoppmBin: resolvedOcrPdftoppmBin,
  ocrDpi: parseNumber(process.env.OCR_DPI, 200),
  ocrMaxPages: parseNumber(process.env.OCR_MAX_PAGES, 40),
  ocrTimeoutMs: parseNumber(process.env.OCR_TIMEOUT_MS, 600000),
  ocrMinTextLength: parseNumber(process.env.OCR_MIN_TEXT_LENGTH, 1200),
  ocrConfidenceThreshold: parseNumber(process.env.OCR_CONFIDENCE_THRESHOLD, 0.55),
  pdfDownloadTimeoutMs: parseNumber(process.env.PDF_DOWNLOAD_TIMEOUT_MS, 45000),
  pdfDownloadRetries: parseNumber(process.env.PDF_DOWNLOAD_RETRIES, 2),
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL || '',
  n8nTimeoutMs: parseNumber(process.env.N8N_TIMEOUT_MS, 20000),
  n8nMaxRetries: parseNumber(process.env.N8N_MAX_RETRIES, 2),
  playwrightHeadless: parseBoolean(process.env.PLAYWRIGHT_HEADLESS, true),
  maxReviewBatch: parseNumber(process.env.MAX_REVIEW_BATCH, 25),
};

module.exports = { env };
