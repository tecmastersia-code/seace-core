function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseMoney(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const raw = String(value || '').replace(/[^\d,.-]/g, '').trim();
  if (!raw) {
    return 0;
  }

  const hasComma = raw.includes(',');
  const hasDot = raw.includes('.');
  let normalized = raw;

  if (hasComma && hasDot) {
    normalized = raw.lastIndexOf('.') > raw.lastIndexOf(',')
      ? raw.replace(/,/g, '')
      : raw.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    normalized = raw.includes(',') && raw.indexOf(',') !== raw.lastIndexOf(',')
      ? raw.replace(/,/g, '')
      : raw.replace(',', '.');
  } else if (hasDot && raw.indexOf('.') !== raw.lastIndexOf('.')) {
    normalized = raw.replace(/\.(?=.*\.)/g, '');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoDate(value) {
  if (!value && value !== 0) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    excelEpoch.setUTCDate(excelEpoch.getUTCDate() + value);
    return excelEpoch.toISOString();
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const peruFormat = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (peruFormat) {
    const [, day, month, year] = peruFormat;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toISOString();
  }

  const peruDateTime = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (peruDateTime) {
    const [, day, month, year, hours, minutes, seconds = '00'] = peruDateTime;
    return new Date(Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
      Number(seconds),
    )).toISOString();
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function extractEmails(text) {
  return unique((String(text || '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).map(cleanText));
}

function extractPhones(text) {
  return unique(
    (String(text || '').match(/(?:\+?51\s*)?9\d{2}[\s.-]*\d{3}[\s.-]*\d{3}\b/g) || [])
      .map((value) => value.replace(/[^\d+]/g, '')),
  );
}

function extractRucs(text) {
  return unique((String(text || '').match(/\b\d{11}\b/g) || []));
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return null;
}

function scoreConfidence({ email, phone, ruc, winnerName, members }) {
  let score = 0.25;
  if (winnerName) score += 0.2;
  if (ruc) score += 0.2;
  if (email) score += 0.15;
  if (phone) score += 0.15;
  if (members && members.length) score += 0.05;
  return Math.min(1, Number(score.toFixed(2)));
}

module.exports = {
  cleanText,
  extractEmails,
  extractPhones,
  extractRucs,
  normalizeHeader,
  parseMoney,
  pickFirst,
  scoreConfidence,
  toIsoDate,
  unique,
};
